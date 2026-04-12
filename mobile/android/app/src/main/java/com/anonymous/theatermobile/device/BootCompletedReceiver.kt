package com.anonymous.theatermobile.device

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.anonymous.theatermobile.MainActivity

class BootCompletedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return

    if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_LOCKED_BOOT_COMPLETED) {
      val launchIntent = Intent(context, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      context.startActivity(launchIntent)
      return
    }

    if (action == DeviceControlModule.ACTION_SILENT_INSTALL_STATUS) {
      // Install status callback is intentionally fire-and-forget.
      return
    }
  }
}
