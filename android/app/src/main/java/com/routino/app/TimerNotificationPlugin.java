package com.routino.app;

import android.content.Intent;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "TimerNotification")
public class TimerNotificationPlugin extends Plugin {
    @PluginMethod
    public void sync(PluginCall call) {
        JSObject snapshot = call.getObject("timer");
        if (snapshot == null) {
            call.reject("Missing timer snapshot");
            return;
        }
        Intent intent = new Intent(getContext(), TimerNotificationService.class);
        if (snapshot.optBoolean("running") || snapshot.optBoolean("active")) {
            intent.setAction(TimerNotificationService.ACTION_SYNC);
            intent.putExtra(TimerNotificationService.EXTRA_SNAPSHOT, snapshot.toString());
            try {
                ContextCompat.startForegroundService(getContext(), intent);
            } catch (RuntimeException error) {
                call.reject("Could not start timer notification", error);
                return;
            }
        } else {
            getContext().getSharedPreferences("routino_timer_notification", android.content.Context.MODE_PRIVATE)
                .edit().remove(TimerNotificationService.EXTRA_SNAPSHOT).apply();
            getContext().stopService(intent);
        }
        call.resolve();
    }

    /** Atomically returns and clears one action chosen from the native timer notification. */
    @PluginMethod
    public void getPendingCommand(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(
            TimerNotificationService.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(TimerNotificationService.EXTRA_COMMAND, null);
        android.content.SharedPreferences.Editor editor = prefs.edit()
            .remove(TimerNotificationService.EXTRA_COMMAND);
        if (shouldClearSnapshotAfterReadingCommand(raw)) {
            editor.remove(TimerNotificationService.EXTRA_SNAPSHOT);
        }
        editor.apply();
        if (raw == null) {
            call.resolve();
            return;
        }
        try {
            call.resolve(new JSObject(raw));
        } catch (org.json.JSONException error) {
            // A malformed stale command is consumed rather than replayed forever.
            call.resolve();
        }
    }

    static boolean shouldClearSnapshotAfterReadingCommand(String raw) {
        if (raw == null) return false;
        return raw.contains("\"action\":\"finish\"") || raw.contains("\"action\":\"cancel\"");
    }

    /** Opens this app's Android notification page after an explicit user tap. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", getContext().getPackageName(), null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Could not open notification settings", error);
        }
    }
}
