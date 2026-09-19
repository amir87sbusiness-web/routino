package com.routino.app;

import android.content.Intent;

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
        if (snapshot.optBoolean("running")) {
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
}
