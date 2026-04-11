package com.powerworkout.vdjv;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.spec.KeySpec;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

@CapacitorPlugin(name = "NativeBankImport")
public class NativeBankImportPlugin extends Plugin {
  private static final int BUFFER_SIZE = 128 * 1024;
  private static final long MAX_IMPORT_ARCHIVE_ENTRY_COUNT = 2000;
  private static final long MAX_IMPORT_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES = 2L * 1024L * 1024L * 1024L;
  private static final long MAX_IMPORT_ARCHIVE_ENTRY_UNCOMPRESSED_BYTES = 512L * 1024L * 1024L;
  private static final byte[] ENCRYPTION_MAGIC = "VDJVENC2".getBytes(StandardCharsets.UTF_8);
  private static final int ENCRYPTION_VERSION = 1;
  private static final String SHARED_EXPORT_DISABLED_PASSWORD = "vdjv-export-disabled-2024-secure";
  private static final String MEDIA_ROOT = "VDJV-Export/_media";
  private static final long PROGRESS_EMIT_MIN_INTERVAL_MS = 400L;

  private final ExecutorService executor = Executors.newCachedThreadPool();
  private final Map<String, ImportJob> activeJobs = new ConcurrentHashMap<>();

  private static final class ImportJob {
    final String jobId;
    final AtomicBoolean cancelled = new AtomicBoolean(false);
    final List<String> createdStorageKeys = Collections.synchronizedList(new ArrayList<>());
    String lastProgressStage = null;
    int lastProgressValue = Integer.MIN_VALUE;
    String lastProgressMessage = null;
    int lastPadProgressCurrent = -1;
    int lastPadProgressTotal = -1;
    long lastProgressEmitAtMs = 0L;

    ImportJob(String jobId) {
      this.jobId = jobId;
    }
  }

  private static final class EnvelopeHeader {
    final int iterations;
    final long headerLength;
    final byte[] salt;
    final byte[] iv;
    final byte[] verifier;

    EnvelopeHeader(int iterations, long headerLength, byte[] salt, byte[] iv, byte[] verifier) {
      this.iterations = iterations;
      this.headerLength = headerLength;
      this.salt = salt;
      this.iv = iv;
      this.verifier = verifier;
    }
  }

  private static final class DerivedKeyMaterial {
    final byte[] aesKey;
    final byte[] verifier;

    DerivedKeyMaterial(byte[] aesKey, byte[] verifier) {
      this.aesKey = aesKey;
      this.verifier = verifier;
    }
  }

  private static final class FailureInfo {
    final String reason;
    final String message;
    final String errorClass;
    final String causeClass;
    final String causeMessage;

    FailureInfo(String reason, String message, String errorClass, String causeClass, String causeMessage) {
      this.reason = reason;
      this.message = message;
      this.errorClass = errorClass;
      this.causeClass = causeClass;
      this.causeMessage = causeMessage;
    }
  }

  private static final class BankPadEntry {
    final int index;
    final String sourcePadId;
    final String sourcePadName;
    final String audioPath;
    final String imagePath;
    final long inferredDurationMs;

    BankPadEntry(int index, String sourcePadId, String sourcePadName, String audioPath, String imagePath, long inferredDurationMs) {
      this.index = index;
      this.sourcePadId = sourcePadId;
      this.sourcePadName = sourcePadName;
      this.audioPath = audioPath;
      this.imagePath = imagePath;
      this.inferredDurationMs = inferredDurationMs;
    }
  }

  @PluginMethod
  public void pickSharedBankFile(PluginCall call) {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/octet-stream", "application/zip", "*/*"});
    startActivityForResult(call, intent, "handlePickSharedBankFile");
  }

  @ActivityCallback
  private void handlePickSharedBankFile(PluginCall call, ActivityResult activityResult) {
    if (call == null) {
      return;
    }
    if (activityResult == null || activityResult.getResultCode() != Activity.RESULT_OK || activityResult.getData() == null) {
      call.reject("No bank file selected.");
      return;
    }
    Uri uri = activityResult.getData().getData();
    if (uri == null) {
      call.reject("Selected file URI is missing.");
      return;
    }
    JSObject result = new JSObject();
    result.put("uri", uri.toString());
    result.put("displayName", queryDisplayName(uri));
    Long size = querySize(uri);
    if (size != null) {
      result.put("size", size);
    }
    call.resolve(result);
  }

  @PluginMethod
  public void startStoreImportJob(PluginCall call) {
    final String signedUrl = trimToNull(call.getString("signedUrl"));
    final String bankId = trimToNull(call.getString("bankId"));
    final String fileName = firstNonBlank(trimToNull(call.getString("fileName")), bankId != null ? bankId + ".bank" : null, "store-download.bank");
    final String expectedSha256 = trimToNull(call.getString("expectedSha256"));
    if (signedUrl == null) {
      call.reject("Missing signedUrl.");
      return;
    }

    final String jobId = UUID.randomUUID().toString();
    final ImportJob job = new ImportJob(jobId);
    activeJobs.put(jobId, job);
    JSObject response = new JSObject();
    response.put("jobId", jobId);
    call.resolve(response);

    final List<String> candidateKeys = buildCandidateKeys(call);
    executor.execute(() -> {
      File inputFile = null;
      try {
        emitProgress(job, "download-start", 4, "Downloading bank archive...", null);
        inputFile = createTempFile("bankstore-", ".bank");
        downloadToFile(signedUrl, inputFile, jobId, job);
        if (expectedSha256 != null) {
          String actualSha256 = sha256Hex(inputFile);
          if (!expectedSha256.equalsIgnoreCase(actualSha256)) {
            throw new IOException("Integrity check failed");
          }
        }
        NativeImportResult result = processArchiveFile(job, inputFile, fileName, candidateKeys);
        emitFinished(jobId, result.toJSObject());
        job.createdStorageKeys.clear();
      } catch (Throwable error) {
        cleanupCreatedStorageKeys(job);
        emitFailed(jobId, error, job);
      } finally {
        deleteQuietly(inputFile);
        activeJobs.remove(jobId);
      }
    });
  }

  @PluginMethod
  public void startSharedImportJob(PluginCall call) {
    final String uriString = trimToNull(call.getString("uri"));
    if (uriString == null) {
      call.reject("Missing file uri.");
      return;
    }
    final String fileName = firstNonBlank(trimToNull(call.getString("displayName")), "shared-import.bank");

    final String jobId = UUID.randomUUID().toString();
    final ImportJob job = new ImportJob(jobId);
    activeJobs.put(jobId, job);
    JSObject response = new JSObject();
    response.put("jobId", jobId);
    call.resolve(response);

    final List<String> candidateKeys = buildCandidateKeys(call);
    executor.execute(() -> {
      File inputFile = null;
      try {
        emitProgress(job, "validate-file", 5, "Reading selected bank file...", null);
        inputFile = createTempFile("shared-bank-", ".bank");
        copyUriToFile(Uri.parse(uriString), inputFile, jobId, job);
        NativeImportResult result = processArchiveFile(job, inputFile, fileName, candidateKeys);
        emitFinished(jobId, result.toJSObject());
        job.createdStorageKeys.clear();
      } catch (Throwable error) {
        cleanupCreatedStorageKeys(job);
        emitFailed(jobId, error, job);
      } finally {
        deleteQuietly(inputFile);
        activeJobs.remove(jobId);
      }
    });
  }

  @PluginMethod
  public void cancelImportJob(PluginCall call) {
    String jobId = trimToNull(call.getString("jobId"));
    if (jobId != null) {
      ImportJob job = activeJobs.get(jobId);
      if (job != null) {
        job.cancelled.set(true);
      }
    }
    call.resolve();
  }

  @PluginMethod
  public void cleanupImportedAssets(PluginCall call) {
    JSArray storageKeys = call.getArray("storageKeys");
    if (storageKeys != null) {
      for (int i = 0; i < storageKeys.length(); i += 1) {
        String storageKey = trimToNull(storageKeys.optString(i, null));
        if (storageKey == null) {
          continue;
        }
        File target = resolveStorageFile(storageKey);
        if (target != null) {
          deleteQuietly(target);
        }
      }
    }
    call.resolve();
  }

  private NativeImportResult processArchiveFile(
    ImportJob job,
    File inputFile,
    String sourceFileName,
    List<String> candidateKeys
  ) throws Exception {
    ensureNotCancelled(job);
    emitProgress(job, "validate-file", 8, "Validating bank archive...", null);

    File zipFile = null;
    boolean encrypted = false;
    try {
      if (hasZipMagic(inputFile)) {
        zipFile = inputFile;
      } else if (hasEncryptionMagic(inputFile)) {
        encrypted = true;
        emitProgress(job, "decrypt-start", 12, "Decrypting bank archive...", null);
        zipFile = createTempFile("bank-decrypted-", ".zip");
        decryptToZipFile(inputFile, zipFile, candidateKeys, job);
      } else {
        throw new IOException("This file is not a valid bank file.");
      }

      ensureNotCancelled(job);
      emitProgress(job, "metadata-start", 20, "Reading bank metadata...", null);
      return extractArchive(job, zipFile, sourceFileName, inputFile.length(), encrypted);
    } finally {
      if (zipFile != null && zipFile != inputFile) {
        deleteQuietly(zipFile);
      }
    }
  }

  private NativeImportResult extractArchive(
    ImportJob job,
    File zipPath,
    String sourceFileName,
    long sourceFileBytes,
    boolean encrypted
  ) throws Exception {
    Map<String, ZipEntry> entryMap = new LinkedHashMap<>();
    String bankJsonText;
    String metadataJsonText = null;
    String thumbnailAssetPath = null;

    try (ZipFile zipFile = new ZipFile(zipPath)) {
      long entryCount = 0;
      long totalUncompressedBytes = 0;
      Enumeration<? extends ZipEntry> entries = zipFile.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (entry.isDirectory()) {
          continue;
        }
        entryCount += 1;
        if (entryCount > MAX_IMPORT_ARCHIVE_ENTRY_COUNT) {
          throw new IOException("Bank archive has too many files.");
        }
        long entrySize = entry.getSize();
        if (entrySize > MAX_IMPORT_ARCHIVE_ENTRY_UNCOMPRESSED_BYTES) {
          throw new IOException("Bank archive contains an oversized file.");
        }
        if (entrySize > 0) {
          totalUncompressedBytes += entrySize;
          if (totalUncompressedBytes > MAX_IMPORT_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES) {
            throw new IOException("Bank archive is too large after extraction.");
          }
        }
        entryMap.put(normalizeArchivePath(entry.getName()), entry);
      }

      ZipEntry bankJsonEntry = entryMap.get("bank.json");
      if (bankJsonEntry == null) {
        throw new IOException("Invalid bank file: bank.json not found.");
      }
      bankJsonText = readZipText(zipFile, bankJsonEntry);

      ZipEntry metadataEntry = entryMap.get("metadata.json");
      if (metadataEntry != null) {
        metadataJsonText = readZipText(zipFile, metadataEntry);
        try {
          JSONObject metadataJson = new JSONObject(metadataJsonText);
          thumbnailAssetPath = normalizeArchivePath(metadataJson.optString("thumbnailAssetPath", ""));
          if (thumbnailAssetPath.isEmpty()) {
            thumbnailAssetPath = null;
          }
        } catch (Exception ignored) {
          metadataJsonText = null;
        }
      }

      JSONObject bankJson = new JSONObject(bankJsonText);
      JSONArray padsArray = bankJson.optJSONArray("pads");
      if (padsArray == null) {
        throw new IOException("Invalid bank file: Missing pads.");
      }

      emitProgress(job, "pads-start", 30, "Extracting bank media...", null);

      List<NativePadImportResult> padResults = new ArrayList<>(Math.max(0, padsArray.length()));
      for (int index = 0; index < padsArray.length(); index += 1) {
        ensureNotCancelled(job);
        JSONObject padJson = padsArray.optJSONObject(index);
        if (padJson == null) {
          padResults.add(new NativePadImportResult(index, null, null));
          continue;
        }
        BankPadEntry padEntry = parsePadEntry(index, padJson);
        NativePadImportResult padResult = extractPad(zipFile, entryMap, padEntry, job);
        padResults.add(padResult);

        JSObject extra = new JSObject();
        extra.put("currentPad", index + 1);
        extra.put("totalPads", padsArray.length());
        emitProgress(
          job,
          "pads-progress",
          30 + Math.min(60, Math.round(((index + 1) * 60.0f) / Math.max(1, padsArray.length()))),
          String.format(Locale.US, "Importing pads... %d/%d", index + 1, padsArray.length()),
          extra
        );
      }

      String thumbnailStorageKey = null;
      String thumbnailFilePath = null;
      if (thumbnailAssetPath != null) {
        ZipEntry thumbEntry = entryMap.get(thumbnailAssetPath);
        if (thumbEntry != null) {
          NativeStoredAsset thumbnailAsset = extractAsset(zipFile, thumbEntry, "image", "bank-thumbnail-" + UUID.randomUUID(), job, 0);
          thumbnailStorageKey = thumbnailAsset.storageKey;
          thumbnailFilePath = thumbnailAsset.filePath;
        }
      }

      emitProgress(job, "finalize", 96, "Finalizing import payload...", null);
      return new NativeImportResult(job.jobId, sourceFileName, sourceFileBytes, encrypted, bankJsonText, metadataJsonText, thumbnailStorageKey, thumbnailFilePath, padResults);
    }
  }

  private NativePadImportResult extractPad(
    ZipFile zipFile,
    Map<String, ZipEntry> entryMap,
    BankPadEntry padEntry,
    ImportJob job
  ) throws Exception {
    ZipEntry audioEntry = padEntry.audioPath != null ? entryMap.get(padEntry.audioPath) : null;
    ZipEntry imageEntry = padEntry.imagePath != null ? entryMap.get(padEntry.imagePath) : null;

    if (audioEntry == null) {
      NativePadImportResult missing = new NativePadImportResult(padEntry.index, padEntry.sourcePadId, padEntry.sourcePadName);
      missing.audioRejectedReason = "missing_audio";
      return missing;
    }

    NativeStoredAsset audioAsset = extractAsset(zipFile, audioEntry, "audio", "pad-audio-" + UUID.randomUUID(), job, padEntry.inferredDurationMs);
    NativePadImportResult result = new NativePadImportResult(padEntry.index, padEntry.sourcePadId, padEntry.sourcePadName);
    result.audioStorageKey = audioAsset.storageKey;
    result.audioFilePath = audioAsset.filePath;
    result.audioBytes = audioAsset.bytes;
    result.audioDurationMs = audioAsset.durationMs;

    if (imageEntry != null) {
      NativeStoredAsset imageAsset = extractAsset(zipFile, imageEntry, "image", "pad-image-" + UUID.randomUUID(), job, 0);
      result.imageStorageKey = imageAsset.storageKey;
      result.imageFilePath = imageAsset.filePath;
      result.hasImageAsset = true;
    }
    return result;
  }

  private NativeStoredAsset extractAsset(
    ZipFile zipFile,
    ZipEntry entry,
    String kind,
    String baseName,
    ImportJob job,
    long inferredDurationMs
  ) throws Exception {
    String ext = guessExtension(entry.getName(), kind);
    String storageKey = kind + "/" + baseName + "." + ext;
    File outputFile = resolveStorageFile(storageKey);
    if (outputFile == null) {
      throw new IOException("Failed to resolve media storage path.");
    }
    ensureParentDirectory(outputFile);

    try (InputStream in = new BufferedInputStream(zipFile.getInputStream(entry));
         OutputStream out = new BufferedOutputStream(new FileOutputStream(outputFile))) {
      copyStream(in, out, job, null);
    } catch (Exception e) {
      deleteQuietly(outputFile);
      throw e;
    }

    job.createdStorageKeys.add(storageKey);

    NativeStoredAsset asset = new NativeStoredAsset();
    asset.storageKey = storageKey;
    asset.filePath = outputFile.getAbsolutePath();
    asset.bytes = Math.max(0, outputFile.length());
    asset.durationMs = "audio".equals(kind) ? resolveAudioDurationMs(outputFile, inferredDurationMs) : 0;
    return asset;
  }

  private void downloadToFile(String signedUrl, File target, String jobId, ImportJob job) throws Exception {
    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection) new URL(signedUrl).openConnection();
      connection.setRequestMethod("GET");
      connection.setInstanceFollowRedirects(true);
      connection.setConnectTimeout(30_000);
      connection.setReadTimeout(120_000);
      connection.connect();
      int statusCode = connection.getResponseCode();
      if (statusCode < 200 || statusCode >= 300) {
        throw new IOException("Download failed with HTTP " + statusCode);
      }
      long totalBytes = connection.getContentLengthLong();
      try (InputStream in = new BufferedInputStream(connection.getInputStream());
           OutputStream out = new BufferedOutputStream(new FileOutputStream(target))) {
        final long[] transferred = new long[]{0};
        copyStream(in, out, job, bytesWritten -> {
          transferred[0] += bytesWritten;
          JSObject extra = new JSObject();
          extra.put("downloadedBytes", transferred[0]);
          if (totalBytes > 0) {
            extra.put("totalBytes", totalBytes);
          }
          int progress = totalBytes > 0
            ? 4 + Math.min(14, (int) Math.round((transferred[0] * 14.0d) / totalBytes))
            : 12;
          emitProgress(job, "download-progress", progress, "Downloading bank archive...", extra);
        });
      }
    } finally {
      if (connection != null) {
        connection.disconnect();
      }
    }
  }

  private void copyUriToFile(Uri uri, File target, String jobId, ImportJob job) throws Exception {
    ContentResolver resolver = getContext().getContentResolver();
    Long totalBytes = querySize(uri);
    try (InputStream in = resolver.openInputStream(uri);
         OutputStream out = new BufferedOutputStream(new FileOutputStream(target))) {
      if (in == null) {
        throw new IOException("Cannot open selected bank file.");
      }
      final long[] transferred = new long[]{0};
      copyStream(in, out, job, bytesWritten -> {
        transferred[0] += bytesWritten;
        JSObject extra = new JSObject();
        extra.put("downloadedBytes", transferred[0]);
        if (totalBytes != null && totalBytes > 0) {
          extra.put("totalBytes", totalBytes);
        }
        emitProgress(job, "download-progress", 12, "Reading selected bank file...", extra);
      });
    }
  }

  private void decryptToZipFile(File encryptedFile, File outputZip, List<String> candidateKeys, ImportJob job) throws Exception {
    EnvelopeHeader header = parseEnvelopeHeader(encryptedFile);
    String matchingPassword = null;

    for (String candidate : candidateKeys) {
      ensureNotCancelled(job);
      if (candidate == null || candidate.isEmpty()) {
        continue;
      }
      DerivedKeyMaterial material = deriveEncryptionMaterial(candidate, header.salt, header.iterations);
      if (constantTimeEquals(material.verifier, header.verifier)) {
        matchingPassword = candidate;
        break;
      }
    }

    if (matchingPassword == null) {
      throw new IOException("Cannot decrypt bank file. Please ensure you have access to this bank.");
    }

    DerivedKeyMaterial material = deriveEncryptionMaterial(matchingPassword, header.salt, header.iterations);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    SecretKeySpec keySpec = new SecretKeySpec(material.aesKey, "AES");
    GCMParameterSpec gcmSpec = new GCMParameterSpec(128, header.iv);
    cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec);

    try (InputStream rawIn = new BufferedInputStream(new FileInputStream(encryptedFile));
         OutputStream out = new BufferedOutputStream(new FileOutputStream(outputZip))) {
      skipFully(rawIn, header.headerLength);
      final long encryptedBytes = Math.max(0L, encryptedFile.length() - header.headerLength);
      final long[] transferred = new long[]{0L};
      byte[] buffer = new byte[BUFFER_SIZE];
      int read;
      while ((read = rawIn.read(buffer)) >= 0) {
        ensureNotCancelled(job);
        if (read == 0) {
          continue;
        }
        transferred[0] += read;
        byte[] plainChunk = cipher.update(buffer, 0, read);
        if (plainChunk != null && plainChunk.length > 0) {
          out.write(plainChunk);
        }
        int progress = encryptedBytes > 0
          ? 18 + Math.min(8, (int) Math.round((transferred[0] * 8.0d) / encryptedBytes))
          : 24;
        emitProgress(job, "decrypt-start", progress, "Decrypting bank archive...", null);
      }
      byte[] finalChunk = cipher.doFinal();
      if (finalChunk != null && finalChunk.length > 0) {
        out.write(finalChunk);
      }
      out.flush();
    }
  }

  private EnvelopeHeader parseEnvelopeHeader(File encryptedFile) throws Exception {
    try (InputStream in = new BufferedInputStream(new FileInputStream(encryptedFile))) {
      byte[] magic = readExactly(in, ENCRYPTION_MAGIC.length);
      if (!constantTimeEquals(magic, ENCRYPTION_MAGIC)) {
        throw new IOException("Unsupported encrypted bank format.");
      }
      int version = readSingleByte(in);
      if (version != ENCRYPTION_VERSION) {
        throw new IOException("Unsupported encrypted bank version.");
      }
      int saltLength = readSingleByte(in);
      int ivLength = readSingleByte(in);
      int verifierLength = readSingleByte(in);
      int iterations = readInt32(in);
      byte[] salt = readExactly(in, saltLength);
      byte[] iv = readExactly(in, ivLength);
      byte[] verifier = readExactly(in, verifierLength);
      long headerLength = ENCRYPTION_MAGIC.length + 1L + 1L + 1L + 1L + 4L + saltLength + ivLength + verifierLength;
      return new EnvelopeHeader(iterations, headerLength, salt, iv, verifier);
    }
  }

  private DerivedKeyMaterial deriveEncryptionMaterial(String password, byte[] salt, int iterations) throws Exception {
    SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
    KeySpec spec = new PBEKeySpec(password.toCharArray(), salt, iterations, 384);
    byte[] material = factory.generateSecret(spec).getEncoded();
    byte[] aesKey = new byte[32];
    byte[] verifier = new byte[16];
    System.arraycopy(material, 0, aesKey, 0, 32);
    System.arraycopy(material, 32, verifier, 0, 16);
    return new DerivedKeyMaterial(aesKey, verifier);
  }

  private List<String> buildCandidateKeys(PluginCall call) {
    LinkedHashSet<String> values = new LinkedHashSet<>();
    values.add(SHARED_EXPORT_DISABLED_PASSWORD);
    String preferredDerivedKey = trimToNull(call.getString("preferredDerivedKey"));
    if (preferredDerivedKey != null) {
      values.add(preferredDerivedKey);
    }
    JSArray candidateArray = call.getArray("candidateDerivedKeys");
    if (candidateArray != null) {
      for (int i = 0; i < candidateArray.length(); i += 1) {
        String key = trimToNull(candidateArray.optString(i, null));
        if (key != null) {
          values.add(key);
        }
      }
    }
    return new ArrayList<>(values);
  }

  private void cleanupCreatedStorageKeys(ImportJob job) {
    synchronized (job.createdStorageKeys) {
      for (String storageKey : job.createdStorageKeys) {
        File target = resolveStorageFile(storageKey);
        if (target != null) {
          deleteQuietly(target);
        }
      }
      job.createdStorageKeys.clear();
    }
  }

  private File resolveStorageFile(String storageKey) {
    String normalized = normalizeArchivePath(storageKey);
    if (normalized.isEmpty() || normalized.contains("..")) {
      return null;
    }
    File mediaRoot = new File(getContext().getFilesDir(), MEDIA_ROOT);
    File file = new File(mediaRoot, normalized);
    try {
      String rootPath = mediaRoot.getCanonicalPath();
      String filePath = file.getCanonicalPath();
      return filePath.startsWith(rootPath) ? file : null;
    } catch (IOException e) {
      return null;
    }
  }

  private void ensureParentDirectory(File file) throws IOException {
    File parent = file.getParentFile();
    if (parent != null && !parent.exists() && !parent.mkdirs()) {
      throw new IOException("Failed to create media directory.");
    }
  }

  private long resolveAudioDurationMs(File file, long inferredDurationMs) {
    if (inferredDurationMs > 0) {
      return inferredDurationMs;
    }
    MediaMetadataRetriever retriever = new MediaMetadataRetriever();
    try {
      retriever.setDataSource(file.getAbsolutePath());
      String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
      if (duration == null) {
        return 0;
      }
      return Math.max(0, Long.parseLong(duration));
    } catch (Exception ignored) {
      return 0;
    } finally {
      try {
        retriever.release();
      } catch (Exception ignored) {
      }
    }
  }

  private BankPadEntry parsePadEntry(int index, JSONObject padJson) {
    String sourcePadId = trimToNull(padJson.optString("id", null));
    String sourcePadName = trimToNull(padJson.optString("name", null));
    String audioPath = normalizeArchivePath(padJson.optString("audioUrl", ""));
    String imagePath = normalizeArchivePath(padJson.optString("imageUrl", ""));
    long inferredDurationMs = 0;
    if (padJson.has("endTimeMs")) {
      double raw = padJson.optDouble("endTimeMs", 0);
      if (Double.isFinite(raw) && raw > 0) {
        inferredDurationMs = Math.round(raw);
      }
    }
    return new BankPadEntry(
      index,
      sourcePadId,
      sourcePadName,
      audioPath.isEmpty() ? null : audioPath,
      imagePath.isEmpty() ? null : imagePath,
      inferredDurationMs
    );
  }

  private String readZipText(ZipFile zipFile, ZipEntry entry) throws IOException {
    try (InputStream in = new BufferedInputStream(zipFile.getInputStream(entry))) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[BUFFER_SIZE];
      int read;
      while ((read = in.read(buffer)) >= 0) {
        out.write(buffer, 0, read);
      }
      return out.toString(StandardCharsets.UTF_8.name());
    }
  }

  private void emitProgress(ImportJob job, String stage, int progress, String message, JSObject extra) {
    if (!shouldEmitProgress(job, stage, progress, message, extra)) {
      return;
    }
    JSObject payload = new JSObject();
    payload.put("jobId", job.jobId);
    payload.put("stage", stage);
    payload.put("progress", progress);
    payload.put("message", message);
    if (extra != null) {
      java.util.Iterator<String> keys = extra.keys();
      while (keys.hasNext()) {
        String key = keys.next();
        try {
          payload.put(key, extra.get(key));
        } catch (Exception ignored) {
        }
      }
    }
    notifyListeners("nativeImportProgress", payload);
  }

  private boolean shouldEmitProgress(ImportJob job, String stage, int progress, String message, JSObject extra) {
    long now = System.currentTimeMillis();
    boolean stageChanged = !stage.equals(job.lastProgressStage);
    boolean progressChanged = progress != job.lastProgressValue;
    boolean messageChanged = message != null ? !message.equals(job.lastProgressMessage) : job.lastProgressMessage != null;

    int currentPad = extra != null ? extra.optInt("currentPad", -1) : -1;
    int totalPads = extra != null ? extra.optInt("totalPads", -1) : -1;
    boolean padChanged = currentPad != job.lastPadProgressCurrent || totalPads != job.lastPadProgressTotal;
    boolean enoughTimeElapsed = (now - job.lastProgressEmitAtMs) >= PROGRESS_EMIT_MIN_INTERVAL_MS;

    boolean highFrequencyStage =
      "pads-progress".equals(stage) ||
      "download-progress".equals(stage) ||
      "decrypt-start".equals(stage);

    boolean shouldEmit;
    if (stageChanged || (!highFrequencyStage && messageChanged)) {
      shouldEmit = true;
    } else if ("pads-progress".equals(stage)) {
      boolean milestonePad = currentPad > 0 && totalPads > 0 &&
        (currentPad == totalPads || currentPad == 1 || currentPad % 6 == 0);
      shouldEmit = padChanged && (milestonePad || enoughTimeElapsed);
    } else if ("download-progress".equals(stage) || "decrypt-start".equals(stage)) {
      shouldEmit = progressChanged || enoughTimeElapsed;
    } else {
      shouldEmit = progressChanged || enoughTimeElapsed;
    }

    if (!shouldEmit) {
      return false;
    }

    job.lastProgressStage = stage;
    job.lastProgressValue = progress;
    job.lastProgressMessage = message;
    job.lastPadProgressCurrent = currentPad;
    job.lastPadProgressTotal = totalPads;
    job.lastProgressEmitAtMs = now;
    return true;
  }

  private void emitFinished(String jobId, JSObject result) {
    JSObject payload = new JSObject();
    payload.put("jobId", jobId);
    payload.put("result", result);
    notifyListeners("nativeImportFinished", payload);
  }

  private FailureInfo classifyFailure(Throwable error, String stage) {
    Throwable cause = error.getCause();
    String errorClass = error.getClass().getSimpleName();
    String causeClass = cause != null ? cause.getClass().getSimpleName() : null;
    String causeMessage = cause != null ? trimToNull(cause.getMessage()) : null;
    String message = trimToNull(error.getMessage());
    String reason = "native_import_failed";

    if (error instanceof OutOfMemoryError) {
      reason = "out_of_memory";
      if (message == null) {
        message = "Android ran out of memory while importing this bank.";
      }
    } else if ("decrypt-start".equals(stage)) {
      if (message != null && message.contains("Cannot decrypt bank file")) {
        reason = "decrypt_access_denied";
      } else if ("AEADBadTagException".equals(errorClass) || "AEADBadTagException".equals(causeClass)) {
        reason = "decrypt_auth_tag_failed";
      } else if ("Unsupported encrypted bank format.".equals(message)) {
        reason = "decrypt_unsupported_format";
      } else if ("Unsupported encrypted bank version.".equals(message)) {
        reason = "decrypt_unsupported_version";
      } else {
        reason = "decrypt_native_failure";
      }
    } else if ("metadata-start".equals(stage)) {
      reason = "metadata_parse_failed";
    } else if ("pads-start".equals(stage) || "pads-progress".equals(stage)) {
      reason = "media_extract_failed";
    } else if ("download-start".equals(stage) || "download-progress".equals(stage)) {
      reason = "download_failed";
    }

    if (message == null) {
      message = "Native import failed.";
    }

    return new FailureInfo(reason, message, errorClass, causeClass, causeMessage);
  }

  private void emitFailed(String jobId, Throwable error, ImportJob job) {
    String stage = job != null ? job.lastProgressStage : null;
    FailureInfo info = classifyFailure(error, stage);
    JSObject payload = new JSObject();
    payload.put("jobId", jobId);
    payload.put("message", info.message);
    if (stage != null) {
      payload.put("stage", stage);
    }
    payload.put("reason", info.reason);
    payload.put("errorClass", info.errorClass);
    if (info.causeClass != null) {
      payload.put("causeClass", info.causeClass);
    }
    if (info.causeMessage != null) {
      payload.put("causeMessage", info.causeMessage);
    }
    notifyListeners("nativeImportFailed", payload);
  }

  private void copyStream(InputStream in, OutputStream out, ImportJob job, CopyProgressListener listener) throws IOException {
    byte[] buffer = new byte[BUFFER_SIZE];
    int read;
    while ((read = in.read(buffer)) >= 0) {
      ensureNotCancelled(job);
      out.write(buffer, 0, read);
      if (listener != null && read > 0) {
        listener.onBytes(read);
      }
    }
    out.flush();
  }

  private void ensureNotCancelled(ImportJob job) throws IOException {
    if (job.cancelled.get()) {
      throw new IOException("Import cancelled.");
    }
  }

  private File createTempFile(String prefix, String suffix) throws IOException {
    File cacheDir = getContext().getCacheDir();
    if (cacheDir == null) {
      throw new IOException("App cache directory is unavailable.");
    }
    return File.createTempFile(prefix, suffix, cacheDir);
  }

  private boolean hasZipMagic(File file) throws IOException {
    try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
      byte[] header = readExactly(in, 4);
      return header[0] == 0x50 && header[1] == 0x4b &&
        ((header[2] == 0x03 && header[3] == 0x04) ||
          (header[2] == 0x05 && header[3] == 0x06) ||
          (header[2] == 0x07 && header[3] == 0x08));
    }
  }

  private boolean hasEncryptionMagic(File file) throws IOException {
    try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
      byte[] header = readExactly(in, ENCRYPTION_MAGIC.length);
      return constantTimeEquals(header, ENCRYPTION_MAGIC);
    }
  }

  private byte[] readExactly(InputStream in, int byteCount) throws IOException {
    byte[] bytes = new byte[byteCount];
    int offset = 0;
    while (offset < byteCount) {
      int read = in.read(bytes, offset, byteCount - offset);
      if (read < 0) {
        throw new IOException("Unexpected end of file.");
      }
      offset += read;
    }
    return bytes;
  }

  private int readSingleByte(InputStream in) throws IOException {
    int value = in.read();
    if (value < 0) {
      throw new IOException("Unexpected end of encrypted header.");
    }
    return value;
  }

  private int readInt32(InputStream in) throws IOException {
    byte[] raw = readExactly(in, 4);
    return ((raw[0] & 0xff) << 24) | ((raw[1] & 0xff) << 16) | ((raw[2] & 0xff) << 8) | (raw[3] & 0xff);
  }

  private void skipFully(InputStream in, long bytesToSkip) throws IOException {
    long remaining = bytesToSkip;
    while (remaining > 0) {
      long skipped = in.skip(remaining);
      if (skipped <= 0) {
        if (in.read() < 0) {
          throw new IOException("Unexpected end of file.");
        }
        skipped = 1;
      }
      remaining -= skipped;
    }
  }

  private String normalizeArchivePath(String value) {
    if (value == null) {
      return "";
    }
    return value.replace('\\', '/').replaceAll("^/+", "").trim();
  }

  private String guessExtension(String sourceName, String kind) {
    String normalized = normalizeArchivePath(sourceName);
    int dotIndex = normalized.lastIndexOf('.');
    if (dotIndex >= 0 && dotIndex < normalized.length() - 1) {
      String ext = normalized.substring(dotIndex + 1).toLowerCase(Locale.US);
      if (!ext.isEmpty() && ext.length() <= 8) {
        return ext;
      }
    }
    return "image".equals(kind) ? "png" : "bin";
  }

  private String firstNonBlank(String... values) {
    if (values == null) {
      return null;
    }
    for (String value : values) {
      if (value != null && !value.trim().isEmpty()) {
        return value.trim();
      }
    }
    return null;
  }

  private String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private boolean constantTimeEquals(byte[] left, byte[] right) {
    if (left == null || right == null || left.length != right.length) {
      return false;
    }
    int diff = 0;
    for (int i = 0; i < left.length; i += 1) {
      diff |= left[i] ^ right[i];
    }
    return diff == 0;
  }

  private String sha256Hex(File file) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
      byte[] buffer = new byte[BUFFER_SIZE];
      int read;
      while ((read = in.read(buffer)) >= 0) {
        if (read > 0) {
          digest.update(buffer, 0, read);
        }
      }
    }
    byte[] hash = digest.digest();
    StringBuilder builder = new StringBuilder(hash.length * 2);
    for (byte value : hash) {
      builder.append(String.format(Locale.US, "%02x", value));
    }
    return builder.toString();
  }

  private String queryDisplayName(Uri uri) {
    ContentResolver resolver = getContext().getContentResolver();
    try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
        if (index >= 0) {
          return trimToNull(cursor.getString(index));
        }
      }
    } catch (Exception ignored) {
    }
    return null;
  }

  private Long querySize(Uri uri) {
    ContentResolver resolver = getContext().getContentResolver();
    try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        int index = cursor.getColumnIndex(OpenableColumns.SIZE);
        if (index >= 0 && !cursor.isNull(index)) {
          return cursor.getLong(index);
        }
      }
    } catch (Exception ignored) {
    }
    return null;
  }

  private void deleteQuietly(File file) {
    if (file == null) {
      return;
    }
    if (file.isDirectory()) {
      File[] children = file.listFiles();
      if (children != null) {
        for (File child : children) {
          deleteQuietly(child);
        }
      }
    }
    if (file.exists()) {
      //noinspection ResultOfMethodCallIgnored
      file.delete();
    }
  }

  private interface CopyProgressListener {
    void onBytes(int bytesWritten);
  }

  private static final class NativeStoredAsset {
    String storageKey;
    String filePath;
    long bytes;
    long durationMs;
  }

  private static final class NativePadImportResult {
    final int index;
    final String sourcePadId;
    final String sourcePadName;
    String audioStorageKey;
    String audioFilePath;
    String imageStorageKey;
    String imageFilePath;
    long audioBytes;
    long audioDurationMs;
    boolean hasImageAsset;
    String audioRejectedReason;

    NativePadImportResult(int index, String sourcePadId, String sourcePadName) {
      this.index = index;
      this.sourcePadId = sourcePadId;
      this.sourcePadName = sourcePadName;
    }

    JSObject toJSObject() {
      JSObject result = new JSObject();
      result.put("index", index);
      result.put("sourcePadId", sourcePadId);
      result.put("sourcePadName", sourcePadName);
      result.put("audioStorageKey", audioStorageKey);
      result.put("audioFilePath", audioFilePath);
      result.put("imageStorageKey", imageStorageKey);
      result.put("imageFilePath", imageFilePath);
      result.put("audioBytes", audioBytes);
      result.put("audioDurationMs", audioDurationMs);
      result.put("hasImageAsset", hasImageAsset);
      result.put("audioRejectedReason", audioRejectedReason);
      return result;
    }
  }

  private static final class NativeImportResult {
    final String jobId;
    final String sourceFileName;
    final long sourceFileBytes;
    final boolean encrypted;
    final String bankJsonText;
    final String metadataJsonText;
    final String thumbnailStorageKey;
    final String thumbnailFilePath;
    final List<NativePadImportResult> pads;

    NativeImportResult(
      String jobId,
      String sourceFileName,
      long sourceFileBytes,
      boolean encrypted,
      String bankJsonText,
      String metadataJsonText,
      String thumbnailStorageKey,
      String thumbnailFilePath,
      List<NativePadImportResult> pads
    ) {
      this.jobId = jobId;
      this.sourceFileName = sourceFileName;
      this.sourceFileBytes = sourceFileBytes;
      this.encrypted = encrypted;
      this.bankJsonText = bankJsonText;
      this.metadataJsonText = metadataJsonText;
      this.thumbnailStorageKey = thumbnailStorageKey;
      this.thumbnailFilePath = thumbnailFilePath;
      this.pads = pads;
    }

    JSObject toJSObject() {
      JSObject result = new JSObject();
      result.put("jobId", jobId);
      result.put("sourceFileName", sourceFileName);
      result.put("sourceFileBytes", sourceFileBytes);
      result.put("encrypted", encrypted);
      result.put("bankJsonText", bankJsonText);
      result.put("metadataJsonText", metadataJsonText);
      result.put("thumbnailStorageKey", thumbnailStorageKey);
      result.put("thumbnailFilePath", thumbnailFilePath);
      JSArray padsArray = new JSArray();
      for (NativePadImportResult pad : pads) {
        padsArray.put(pad.toJSObject());
      }
      result.put("pads", padsArray);
      return result;
    }
  }
}
