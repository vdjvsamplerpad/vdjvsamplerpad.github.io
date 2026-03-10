type SaveExportFileResult = {
  success: boolean;
  message?: string;
  savedPath?: string;
};

type OperationDiagnosticsLike = {
  operation: string;
  operationId: string;
  endedAt?: string;
  error?: {
    message: string;
    stack?: string;
  };
};

export interface ReadNativeExportBackupFileDeps {
  isNativeCapacitorPlatform: () => boolean;
  isNativeAndroid: () => boolean;
  normalizeBase64Data: (input: string) => string;
  androidDownloadRoot: string;
  exportFolderName: string;
}

export const readNativeExportBackupFileByNamePipeline = async (
  fileName: string,
  deps: ReadNativeExportBackupFileDeps
): Promise<File | null> => {
  const {
    isNativeCapacitorPlatform,
    isNativeAndroid,
    normalizeBase64Data,
    androidDownloadRoot,
    exportFolderName,
  } = deps;

  if (!isNativeCapacitorPlatform()) return null;

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    const readAsFile = async (
      read: () => Promise<{ data: string | Blob }>,
      label: string
    ): Promise<File | null> => {
      try {
        const result = await read();
        if (result.data instanceof Blob) {
          return new File([result.data], fileName, { type: 'application/octet-stream' });
        }
        const base64 = normalizeBase64Data(String(result.data || ''));
        if (!base64) return null;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new File([bytes], fileName, { type: 'application/octet-stream' });
      } catch {
        if (label === 'android-download' || label === 'documents') {
          return null;
        }
        return null;
      }
    };

    if (isNativeAndroid()) {
      const androidAbsolutePath = `${androidDownloadRoot}/${exportFolderName}/${fileName}`;
      const fromDownload = await readAsFile(
        () => Filesystem.readFile({ path: androidAbsolutePath }),
        'android-download'
      );
      if (fromDownload) return fromDownload;
    }

    const fromDocuments = await readAsFile(
      () => Filesystem.readFile({ path: `${exportFolderName}/${fileName}`, directory: Directory.Documents }),
      'documents'
    );
    if (fromDocuments) return fromDocuments;
  } catch {
    return null;
  }

  return null;
};

export interface EnsureExportPermissionDeps {
  isNativeAndroid: () => boolean;
}

export const ensureExportPermissionPipeline = async (
  deps: EnsureExportPermissionDeps
): Promise<void> => {
  const { isNativeAndroid } = deps;
  if (!isNativeAndroid()) return;
  const { Filesystem } = await import('@capacitor/filesystem');
  const permissionStatus = await Filesystem.checkPermissions();
  if (permissionStatus.publicStorage === 'granted') return;
  const requested = await Filesystem.requestPermissions();
  if (requested.publicStorage !== 'granted') {
    throw new Error('Storage permission was denied. Please allow storage access and try again.');
  }
};

export interface SaveExportFileDeps {
  normalizeFolderPath: (path: string) => string;
  isNativeCapacitorPlatform: () => boolean;
  isNativeAndroid: () => boolean;
  isMobileBrowserRuntime: () => boolean;
  ensureExportPermission: () => Promise<void>;
  blobToBase64: (blob: Blob) => Promise<string>;
  androidDownloadRoot: string;
  capacitorExportSingleWriteBytes: number;
  capacitorExportChunkBytes: number;
  exportFolderName: string;
}

export const saveExportFilePipeline = async (
  blob: Blob,
  fileName: string,
  relativeFolder: string | undefined,
  deps: SaveExportFileDeps
): Promise<SaveExportFileResult> => {
  const {
    normalizeFolderPath,
    isNativeCapacitorPlatform,
    isNativeAndroid,
    isMobileBrowserRuntime,
    ensureExportPermission,
    blobToBase64,
    androidDownloadRoot,
    capacitorExportSingleWriteBytes,
    capacitorExportChunkBytes,
    exportFolderName,
  } = deps;

  const normalizedFolder = normalizeFolderPath(relativeFolder || exportFolderName);
  if (isNativeCapacitorPlatform()) {
    try {
      await ensureExportPermission();
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Storage permission denied.',
      };
    }

    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const writeBlobInChunks = async (
        path: string,
        directory?: typeof Directory[keyof typeof Directory]
      ): Promise<void> => {
        const writeOptions = directory ? { path, directory, recursive: true } : { path, recursive: true };
        if (blob.size <= capacitorExportSingleWriteBytes) {
          const base64Data = await blobToBase64(blob);
          await Filesystem.writeFile({
            ...writeOptions,
            data: base64Data,
          });
          return;
        }

        let offset = 0;
        let isFirstChunk = true;
        while (offset < blob.size) {
          const nextOffset = Math.min(blob.size, offset + capacitorExportChunkBytes);
          const chunk = blob.slice(offset, nextOffset);
          const base64Data = await blobToBase64(chunk);

          if (isFirstChunk) {
            await Filesystem.writeFile({
              ...writeOptions,
              data: base64Data,
            });
            isFirstChunk = false;
          } else {
            if (directory) {
              await Filesystem.appendFile({
                path,
                directory,
                data: base64Data,
              });
            } else {
              await Filesystem.appendFile({
                path,
                data: base64Data,
              });
            }
          }

          offset = nextOffset;
          if (offset < blob.size) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      };

      if (isNativeAndroid()) {
        const downloadRelativePath = `Download/${normalizedFolder}/${fileName}`;
        const downloadAbsolutePath = `${androidDownloadRoot}/${normalizedFolder}/${fileName}`;
        try {
          await writeBlobInChunks(downloadAbsolutePath);
          return {
            success: true,
            message: `Successfully saved to ${downloadRelativePath}`,
            savedPath: downloadRelativePath,
          };
        } catch {
          // Fall through to documents path.
        }
      }

      await writeBlobInChunks(`${normalizedFolder}/${fileName}`, Directory.Documents);
      return {
        success: true,
        message: `Successfully saved to Documents/${normalizedFolder}/${fileName}`,
        savedPath: `Documents/${normalizedFolder}/${fileName}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save file.',
      };
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    if (isMobileBrowserRuntime()) {
      a.target = '_blank';
    }
    document.body.appendChild(a);
    try {
      a.click();
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    const cleanupDelayMs = isMobileBrowserRuntime() ? 120000 : 15000;
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      } catch {
        // Ignore cleanup errors.
      }
    }, cleanupDelayMs);
    return {
      success: true,
      message: `Successfully downloaded ${fileName}`,
      savedPath: fileName,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to trigger download.',
    };
  }
};

export interface WriteOperationDiagnosticsLogDeps {
  sanitizeOperationError: (error: unknown) => { message: string; stack?: string };
  saveExportFile: (blob: Blob, fileName: string, relativeFolder: string) => Promise<SaveExportFileResult>;
  exportLogsFolder: string;
}

export const writeOperationDiagnosticsLogPipeline = async (
  diagnostics: OperationDiagnosticsLike,
  error: unknown,
  deps: WriteOperationDiagnosticsLogDeps
): Promise<string | null> => {
  const { sanitizeOperationError, saveExportFile, exportLogsFolder } = deps;
  try {
    diagnostics.endedAt = new Date().toISOString();
    diagnostics.error = sanitizeOperationError(error);
    const payload = JSON.stringify(diagnostics, null, 2);
    const fileName = `vdjv-${diagnostics.operation}-${diagnostics.operationId}.json`;
    const result = await saveExportFile(
      new Blob([payload], { type: 'application/json' }),
      fileName,
      exportLogsFolder
    );
    return result.success ? result.savedPath || fileName : null;
  } catch {
    return null;
  }
};
