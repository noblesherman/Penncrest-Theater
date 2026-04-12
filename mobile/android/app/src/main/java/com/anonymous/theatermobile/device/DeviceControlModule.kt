package com.anonymous.theatermobile.device

import android.app.Activity
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class DeviceControlModule(private val appContext: ReactApplicationContext) : ReactContextBaseJavaModule(appContext) {
  companion object {
    private const val PREFS = "device_control_prefs"
    private const val KEY_KIOSK_LOCKED = "kiosk_locked"
    const val ACTION_SILENT_INSTALL_STATUS = "com.anonymous.theatermobile.SILENT_INSTALL_STATUS"

    fun applyKioskLockIfNeeded(activity: Activity?) {
      if (activity == null) {
        return
      }

      val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val shouldLock = prefs.getBoolean(KEY_KIOSK_LOCKED, false)
      if (!shouldLock) {
        return
      }

      try {
        activity.startLockTask()
      } catch (_: IllegalArgumentException) {
        // Lock task not permitted on this device/profile.
      } catch (_: IllegalStateException) {
        // Ignore if lock task cannot start right now.
      }
    }

    fun persistKioskLock(context: Context, locked: Boolean) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_KIOSK_LOCKED, locked)
        .apply()
    }
  }

  override fun getName(): String = "DeviceControlModule"

  @ReactMethod
  fun isDeviceOwner(promise: Promise) {
    try {
      val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
      promise.resolve(dpm.isDeviceOwnerApp(appContext.packageName))
    } catch (error: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun setKioskLock(locked: Boolean, promise: Promise) {
    persistKioskLock(appContext, locked)

    val activity = currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }

    activity.runOnUiThread {
      try {
        if (locked) {
          activity.startLockTask()
        } else {
          activity.stopLockTask()
        }
        promise.resolve(true)
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun openWifiSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_WIFI_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      appContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("OPEN_WIFI_FAILED", error)
    }
  }

  @ReactMethod
  fun openAppSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${appContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      appContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("OPEN_APP_SETTINGS_FAILED", error)
    }
  }

  @ReactMethod
  fun restartApp(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.resolve(null)
      return
    }

    activity.runOnUiThread {
      try {
        activity.recreate()
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("RESTART_APP_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    val map = Arguments.createMap().apply {
      putString("model", Build.MODEL ?: "unknown")
      putString("manufacturer", Build.MANUFACTURER ?: "unknown")
      putString("osVersion", Build.VERSION.RELEASE ?: "unknown")
      putString("deviceName", Build.DEVICE ?: Build.MODEL ?: "unknown")
    }

    promise.resolve(map)
  }

  @ReactMethod
  fun downloadAndInstallApk(apkUrl: String, expectedSha256: String, promise: Promise) {
    Thread {
      try {
        val updatesDir = File(appContext.filesDir, "managed-updates")
        if (!updatesDir.exists()) {
          updatesDir.mkdirs()
        }

        val apkFile = File(updatesDir, "latest.apk")
        downloadFile(apkUrl, apkFile)

        val digest = sha256(apkFile)
        if (!digest.equals(expectedSha256.lowercase(), ignoreCase = true)) {
          throw IllegalStateException("APK checksum verification failed")
        }

        val mode = if (trySilentInstallIfAllowed(apkFile)) {
          "silent"
        } else {
          launchInstallerIntent(apkFile)
          "installer_intent"
        }

        val payload = Arguments.createMap().apply {
          putBoolean("installed", true)
          putString("mode", mode)
          putString("message", "Install flow started")
        }

        promise.resolve(payload)
      } catch (error: Exception) {
        promise.reject("APK_INSTALL_FAILED", error)
      }
    }.start()
  }

  private fun downloadFile(fileUrl: String, targetFile: File) {
    val connection = URL(fileUrl).openConnection() as HttpURLConnection
    connection.requestMethod = "GET"
    connection.connectTimeout = 20_000
    connection.readTimeout = 60_000

    try {
      val status = connection.responseCode
      if (status !in 200..299) {
        throw IllegalStateException("Failed to download APK (HTTP $status)")
      }

      connection.inputStream.use { input ->
        FileOutputStream(targetFile).use { output ->
          input.copyTo(output)
          output.flush()
        }
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { stream ->
      val buffer = ByteArray(8 * 1024)
      while (true) {
        val bytesRead = stream.read(buffer)
        if (bytesRead <= 0) {
          break
        }
        digest.update(buffer, 0, bytesRead)
      }
    }

    return digest.digest().joinToString("") { b -> "%02x".format(b) }
  }

  private fun trySilentInstallIfAllowed(apkFile: File): Boolean {
    val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!dpm.isDeviceOwnerApp(appContext.packageName)) {
      return false
    }

    return try {
      val packageInstaller = appContext.packageManager.packageInstaller
      val params = android.content.pm.PackageInstaller.SessionParams(
        android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL
      )
      val sessionId = packageInstaller.createSession(params)
      val session = packageInstaller.openSession(sessionId)

      session.use {
        FileInputStream(apkFile).use { input ->
          session.openWrite("base.apk", 0, apkFile.length()).use { output ->
            input.copyTo(output)
            session.fsync(output)
          }
        }

        val statusIntent = Intent(appContext, BootCompletedReceiver::class.java).apply {
          action = ACTION_SILENT_INSTALL_STATUS
        }

        val pendingIntent = PendingIntent.getBroadcast(
          appContext,
          sessionId,
          statusIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        session.commit(pendingIntent.intentSender)
      }

      true
    } catch (_: Exception) {
      false
    }
  }

  private fun launchInstallerIntent(apkFile: File) {
    val apkUri = FileProvider.getUriForFile(
      appContext,
      "${appContext.packageName}.fileprovider",
      apkFile
    )

    val installIntent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(apkUri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    appContext.startActivity(installIntent)
  }
}
