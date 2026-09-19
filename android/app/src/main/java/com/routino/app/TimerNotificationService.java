package com.routino.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONException;
import org.json.JSONObject;

/** User-started foreground service; the system chronometer renders without a WebView tick. */
public class TimerNotificationService extends Service {
    static final String ACTION_SYNC = "com.routino.app.timer.SYNC";
    static final String ACTION_STOP = "com.routino.app.timer.STOP";
    static final String EXTRA_SNAPSHOT = "snapshot";
    private static final String PREFS = "routino_timer_notification";
    private static final String CHANNEL_RUNNING = "routino_running_timer";
    private static final String CHANNEL_DONE = "routino_timer_done";
    private static final int RUNNING_ID = 7001;
    private static final int DONE_ID = 7002;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TimerTimeline timer;
    private final Runnable boundary = () -> refresh(true);

    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_RUNNING, "تایمر در حال اجرا", NotificationManager.IMPORTANCE_LOW));
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_DONE, "پایان تایمر", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTimer();
            return START_NOT_STICKY;
        }
        String snapshot = intent == null ? null : intent.getStringExtra(EXTRA_SNAPSHOT);
        if (snapshot == null) snapshot = getPrefs().getString(EXTRA_SNAPSHOT, null);
        try {
            if (snapshot == null) throw new JSONException("Missing timer snapshot");
            JSONObject value = new JSONObject(snapshot);
            if (!value.optBoolean("running") || value.optLong("anchorAt") <= 0) {
                stopTimer();
                return START_NOT_STICKY;
            }
            String mode = value.getString("mode");
            if (!mode.equals("free") && !mode.equals("pomodoro") && !mode.equals("stopwatch")) {
                throw new JSONException("Unknown timer mode");
            }
            timer = new TimerTimeline(mode, value.getLong("remainingMs"),
                value.getLong("elapsedMs"), value.getLong("focusMinutes") * 60_000L,
                value.getLong("breakMinutes") * 60_000L, value.getInt("cycles"),
                value.getInt("round"), value.getBoolean("onBreak"), value.getLong("anchorAt"));
            getPrefs().edit().putString(EXTRA_SNAPSHOT, snapshot).apply();
            getSystemService(NotificationManager.class).cancel(DONE_ID);
            // Android requires foreground promotion immediately after startForegroundService.
            startForeground(RUNNING_ID, buildRunningNotification());
            refresh(true);
            return START_STICKY;
        } catch (JSONException | IllegalArgumentException error) {
            stopTimer();
            return START_NOT_STICKY;
        }
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildRunningNotification() {
        boolean stopwatch = "stopwatch".equals(timer.mode);
        String title = stopwatch ? "کرونومتر روتینو" :
            timer.onBreak ? "استراحت روتینو" : "تایمر تمرکز روتینو";
        String detail = "pomodoro".equals(timer.mode)
            ? "دور " + timer.round + " از " + timer.cycles
            : "برای بازگشت به تایمر، اینجا بزنید";
        long when = stopwatch
            ? System.currentTimeMillis() - timer.elapsedMs
            : timer.deadlineMs();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat_routino)
            .setContentTitle(title)
            .setContentText(detail)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setWhen(when)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        if (!stopwatch && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.setChronometerCountDown(true);
        }
        return builder.build();
    }

    private void refresh(boolean updateNotification) {
        handler.removeCallbacks(boundary);
        if (timer == null) return;
        boolean wasRunning = timer.running;
        timer.advance(System.currentTimeMillis());
        if (!timer.running) {
            if (wasRunning) showCompleted();
            stopTimer();
            return;
        }
        if (updateNotification) {
            getSystemService(NotificationManager.class).notify(RUNNING_ID, buildRunningNotification());
        }
        persistAdvancedSnapshot();
        if (!"stopwatch".equals(timer.mode)) {
            long waitMs = Math.max(1, timer.deadlineMs() - System.currentTimeMillis());
            handler.postDelayed(boundary, waitMs);
        }
    }

    private void persistAdvancedSnapshot() {
        try {
            JSONObject value = new JSONObject(getPrefs().getString(EXTRA_SNAPSHOT, "{}"));
            value.put("remainingMs", timer.remainingMs);
            value.put("elapsedMs", timer.elapsedMs);
            value.put("anchorAt", timer.anchorAt);
            value.put("round", timer.round);
            value.put("onBreak", timer.onBreak);
            getPrefs().edit().putString(EXTRA_SNAPSHOT, value.toString()).apply();
        } catch (JSONException ignored) {
            // The live in-memory timer remains authoritative until the next bridge sync.
        }
    }

    private void showCompleted() {
        Notification done = new NotificationCompat.Builder(this, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_routino)
            .setContentTitle("تایمر روتینو تمام شد")
            .setContentText("برای دیدن نتیجه، به روتینو برگردید")
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .build();
        getSystemService(NotificationManager.class).notify(DONE_ID, done);
    }

    private void stopTimer() {
        handler.removeCallbacks(boundary);
        timer = null;
        getPrefs().edit().remove(EXTRA_SNAPSHOT).apply();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        handler.removeCallbacks(boundary);
        super.onDestroy();
    }
}
