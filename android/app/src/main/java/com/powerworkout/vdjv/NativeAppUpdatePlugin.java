package com.powerworkout.vdjv;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallState;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

@CapacitorPlugin(name = "NativeAppUpdate")
public class NativeAppUpdatePlugin extends Plugin {
  private static final int REQUEST_CODE_APP_UPDATE = 9304;

  private AppUpdateManager appUpdateManager;
  private InstallStateUpdatedListener installStateListener;
  private JSObject lastState;

  @Override
  public void load() {
    super.load();
    appUpdateManager = AppUpdateManagerFactory.create(getContext());
    lastState = buildState(false, "disabled", "Play in-app updates are unavailable on this build.", null);
    installStateListener = this::handleInstallStateUpdated;
    appUpdateManager.registerListener(installStateListener);
    refreshState(false, false, null);
  }

  @Override
  protected void handleOnResume() {
    super.handleOnResume();
    refreshState(false, true, null);
  }

  @Override
  protected void handleOnDestroy() {
    if (appUpdateManager != null && installStateListener != null) {
      try {
        appUpdateManager.unregisterListener(installStateListener);
      } catch (Exception ignored) {
      }
    }
    super.handleOnDestroy();
  }

  @Override
  protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
    super.handleOnActivityResult(requestCode, resultCode, data);
    if (requestCode != REQUEST_CODE_APP_UPDATE) {
      return;
    }

    if (resultCode == Activity.RESULT_CANCELED) {
      pushState(buildState(true, "idle", "Update canceled.", null));
      return;
    }

    refreshState(false, true, null);
  }

  @PluginMethod
  public void getState(PluginCall call) {
    refreshState(false, false, call);
  }

  @PluginMethod
  public void checkForUpdate(PluginCall call) {
    final boolean autoStart = call.getBoolean("autoStart", false);
    refreshState(true, autoStart, call);
  }

  @PluginMethod
  public void completeUpdate(PluginCall call) {
    if (appUpdateManager == null) {
      call.reject("App update manager is unavailable.");
      return;
    }

    pushState(buildState(true, "installing", "Installing update...", null));
    appUpdateManager.completeUpdate()
      .addOnSuccessListener(unused -> call.resolve(lastState))
      .addOnFailureListener(error -> {
        String errorMessage = error == null ? "Update install failed." : error.getMessage();
        JSObject state = buildState(true, "error", "Update install failed.", errorMessage);
        pushState(state);
        call.reject(errorMessage, error);
      });
  }

  private void handleInstallStateUpdated(@NonNull InstallState installState) {
    JSObject state = buildState(true, mapInstallStatus(installState.installStatus()), messageForInstallState(installState), null);
    if (installState.totalBytesToDownload() > 0L) {
      double percent = (double) installState.bytesDownloaded() * 100.0d / (double) installState.totalBytesToDownload();
      state.put("downloadPercent", percent);
    }
    state.put("installStatus", installState.installStatus());
    pushState(state);
  }

  private void refreshState(boolean markChecking, boolean autoStart, PluginCall call) {
    if (appUpdateManager == null) {
      JSObject disabled = buildState(false, "disabled", "Play in-app updates are unavailable on this build.", null);
      pushState(disabled);
      if (call != null) {
        call.resolve(disabled);
      }
      return;
    }

    if (markChecking) {
      JSObject checking = buildState(true, "checking", "Checking for updates...", null);
      checking.put("lastCheckedAt", isoNow());
      pushState(checking);
    }

    appUpdateManager.getAppUpdateInfo()
      .addOnSuccessListener(info -> {
        JSObject state = buildStateFromInfo(info);
        if (markChecking) {
          state.put("lastCheckedAt", isoNow());
        }
        pushState(state);

        if (autoStart) {
          maybeStartUpdateFlow(info, call);
          return;
        }

        if (call != null) {
          call.resolve(state);
        }
      })
      .addOnFailureListener(error -> {
        String errorMessage = error == null ? "Play in-app updates are unavailable on this build." : error.getMessage();
        JSObject disabled = buildState(false, "disabled", "Play in-app updates are unavailable on this build.", errorMessage);
        if (markChecking) {
          disabled.put("lastCheckedAt", isoNow());
        }
        pushState(disabled);
        if (call != null) {
          call.resolve(disabled);
        }
      });
  }

  private void maybeStartUpdateFlow(AppUpdateInfo info, PluginCall call) {
    try {
      if (info.installStatus() == InstallStatus.DOWNLOADED) {
        JSObject state = buildState(true, "downloaded", "Update downloaded. Restart to install.", null);
        pushState(state);
        if (call != null) {
          call.resolve(state);
        }
        return;
      }

      if (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
        && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
        boolean started = startUpdateFlow(info, AppUpdateType.IMMEDIATE);
        if (call != null) {
          call.resolve(lastState);
        }
        if (!started) {
          JSObject state = buildState(true, "available", "Update is available.", null);
          pushState(state);
        }
        return;
      }

      if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) {
        if (call != null) {
          call.resolve(lastState);
        }
        return;
      }

      int preferredType = info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
        ? AppUpdateType.FLEXIBLE
        : (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE) ? AppUpdateType.IMMEDIATE : -1);

      if (preferredType < 0) {
        if (call != null) {
          call.resolve(lastState);
        }
        return;
      }

      boolean started = startUpdateFlow(info, preferredType);
      if (!started) {
        JSObject state = buildState(true, "available", "Update is available.", null);
        pushState(state);
      }
      if (call != null) {
        call.resolve(lastState);
      }
    } catch (Exception error) {
      String errorMessage = error.getMessage();
      JSObject state = buildState(true, "error", "Could not start the update flow.", errorMessage);
      pushState(state);
      if (call != null) {
        call.resolve(state);
      }
    }
  }

  private boolean startUpdateFlow(AppUpdateInfo info, int updateType) throws IntentSender.SendIntentException {
    Activity activity = getActivity();
    if (activity == null || appUpdateManager == null) {
      return false;
    }
    boolean started = appUpdateManager.startUpdateFlowForResult(
      info,
      activity,
      AppUpdateOptions.defaultOptions(updateType),
      REQUEST_CODE_APP_UPDATE
    );
    if (started) {
      String message = updateType == AppUpdateType.IMMEDIATE
        ? "Starting immediate update..."
        : "Starting flexible update...";
      pushState(buildState(true, "available", message, null));
    }
    return started;
  }

  private JSObject buildStateFromInfo(AppUpdateInfo info) {
    boolean enabled = true;
    String status = "idle";
    String message = "You already have the latest version.";

    if (info.installStatus() == InstallStatus.DOWNLOADED) {
      status = "downloaded";
      message = "Update downloaded. Restart to install.";
    } else if (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
      status = "downloading";
      message = "Update is already in progress.";
    } else if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE) {
      status = "available";
      if (info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
        message = "An app update is available.";
      } else if (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
        message = "An urgent app update is available.";
      } else {
        enabled = false;
        status = "disabled";
        message = "An update exists, but this build cannot start it here.";
      }
    } else if (info.updateAvailability() == UpdateAvailability.UNKNOWN) {
      enabled = false;
      status = "disabled";
      message = "Play in-app updates are unavailable on this build.";
    }

    JSObject state = buildState(enabled, status, message, null);
    String nextVersion = info.availableVersionCode() > 0 ? String.valueOf(info.availableVersionCode()) : null;
    putNullable(state, "nextVersion", nextVersion);
    state.put("updateAvailability", info.updateAvailability());
    state.put("installStatus", info.installStatus());
    state.put("flexibleAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
    state.put("immediateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
    return state;
  }

  private JSObject buildState(boolean enabled, String status, String message, String lastError) {
    JSObject state = new JSObject();
    state.put("enabled", enabled);
    state.put("status", status);
    state.put("message", message);
    putNullable(state, "currentVersion", getCurrentVersionName());
    putNullable(state, "lastError", lastError);
    return state;
  }

  private void pushState(JSObject state) {
    lastState = state;
    notifyListeners("appUpdateState", state);
  }

  private void putNullable(JSObject target, String key, String value) {
    if (value == null || value.trim().isEmpty()) {
      return;
    }
    target.put(key, value);
  }

  private String getCurrentVersionName() {
    try {
      PackageManager packageManager = getContext().getPackageManager();
      String packageName = getContext().getPackageName();
      PackageInfo packageInfo;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageInfo = packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0));
      } else {
        packageInfo = packageManager.getPackageInfo(packageName, 0);
      }
      return packageInfo.versionName;
    } catch (Exception ignored) {
      return null;
    }
  }

  private String mapInstallStatus(int installStatus) {
    if (installStatus == InstallStatus.DOWNLOADING || installStatus == InstallStatus.PENDING) {
      return "downloading";
    }
    if (installStatus == InstallStatus.DOWNLOADED) {
      return "downloaded";
    }
    if (installStatus == InstallStatus.INSTALLING) {
      return "installing";
    }
    if (installStatus == InstallStatus.FAILED || installStatus == InstallStatus.CANCELED) {
      return "error";
    }
    return "idle";
  }

  private String messageForInstallState(InstallState installState) {
    int status = installState.installStatus();
    if (status == InstallStatus.DOWNLOADING && installState.totalBytesToDownload() > 0L) {
      double percent = (double) installState.bytesDownloaded() * 100.0d / (double) installState.totalBytesToDownload();
      return String.format(Locale.US, "Downloading update... %d%%", Math.round(percent));
    }
    if (status == InstallStatus.PENDING) {
      return "Update download is pending...";
    }
    if (status == InstallStatus.DOWNLOADED) {
      return "Update downloaded. Restart to install.";
    }
    if (status == InstallStatus.INSTALLING) {
      return "Installing update...";
    }
    if (status == InstallStatus.FAILED) {
      return "Update failed.";
    }
    if (status == InstallStatus.CANCELED) {
      return "Update canceled.";
    }
    return "Checking update status...";
  }

  private String isoNow() {
    SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
    return formatter.format(new Date());
  }
}
