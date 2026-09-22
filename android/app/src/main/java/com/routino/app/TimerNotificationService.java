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

import java.util.UUID;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONException;
import org.json.JSONObject;

/** User-started foreground service; the system chronometer renders without a WebView tick. */
public class TimerNotificationService extends Service {
    static final String ACTION_SYNC = "com.routino.app.timer.SYNC";
    static final String ACTION_STOP = "com.routino.app.timer.STOP";
    static final String ACTION_PAUSE = "com.routino.app.timer.PAUSE";
    static final String ACTION_FINISH = "com.routino.app.timer.FINISH";
    static final String ACTION_CANCEL = "com.routino.app.timer.CANCEL";
    static final String EXTRA_SNAPSHOT = "snapshot";
    static final String EXTRA_COMMAND = "command";
    static final String PREFS = "routino_timer_notification";
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
        if (intent != null && isTimerAction(intent.getAction())) {
            if (timer == null) {
                try {
                    timer = timerFromSnapshot(getPrefs().getString(EXTRA_SNAPSHOT, null));
                } catch (JSONException | IllegalArgumentException error) {
                    return START_NOT_STICKY;
                }
            }
            recordAction(intent.getAction());
            return START_NOT_STICKY;
        }
        String snapshot = intent == null ? null : intent.getStringExtra(EXTRA_SNAPSHOT);
        if (snapshot == null) snapshot = getPrefs().getString(EXTRA_SNAPSHOT, null);
        try {
            if (snapshot == null) throw new JSONException("Missing timer snapshot");
            timer = timerFromSnapshot(snapshot);
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

    static TimerTimeline timerFromSnapshot(String snapshot) throws JSONException {
        if (snapshot == null) throw new JSONException("Missing timer snapshot");
        JSONObject value = new JSONObject(snapshot);
        return timerFromValues(value.getString("mode"), value.optBoolean("running"),
            value.getLong("remainingMs"), value.getLong("elapsedMs"),
            value.getLong("focusMinutes"), value.getLong("breakMinutes"), value.getInt("cycles"),
            value.getInt("round"), value.getBoolean("onBreak"), value.getLong("anchorAt"));
    }

    static TimerTimeline timerFromValues(String mode, boolean running, long remainingMs, long elapsedMs,
            long focusMinutes, long breakMinutes, int cycles, int round, boolean onBreak, long anchorAt) {
        if (!running || anchorAt <= 0) {
            throw new IllegalArgumentException("Inactive timer snapshot");
        }
        if (!mode.equals("free") && !mode.equals("pomodoro") && !mode.equals("stopwatch")) {
            throw new IllegalArgumentException("Unknown timer mode");
        }
        return new TimerTimeline(mode, remainingMs, elapsedMs, focusMinutes * 60_000L,
            breakMinutes * 60_000L, cycles, round, onBreak, anchorAt);
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private boolean isTimerAction(String action) {
        return ACTION_PAUSE.equals(action) || ACTION_FINISH.equals(action) || ACTION_CANCEL.equals(action);
    }

    private PendingIntent timerAction(String action, int requestCode) {
        Intent intent = new Intent(this, TimerNotificationService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildRunningNotification() {
        boolean stopwatch = "stopwatch".equals(timer.mode);
        String title = stopwatch ? "کرونومتر روتینو" :
            timer.onBreak ? "استراحت روتینو" : "تایمر تمرکز روتینو";
        String detail = "pomodoro".equals(timer.mode)
            ? "دور " + timer.round + " از " + timer.cycles
            : "برای بازگشت به تایمر، اینجا بزنید";
        String time = stopwatch
            ? "زمان سپری‌شده: " + TimerTimeline.formatClock(timer.elapsedMs)
            : "زمان باقی‌مانده: " + TimerTimeline.formatClock(timer.remainingMs);
        long when = stopwatch
            ? System.currentTimeMillis() - timer.elapsedMs
            : timer.deadlineMs();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat_routino)
            .setContentTitle(title)
            .setContentText(time)
            .setSubText(detail)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setWhen(when)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        builder.addAction(new NotificationCompat.Action.Builder(
            R.drawable.ic_stat_routino, "مکث", timerAction(ACTION_PAUSE, 7101)).build());
        builder.addAction(new NotificationCompat.Action.Builder(
            R.drawable.ic_stat_routino, "پایان و ثبت", timerAction(ACTION_FINISH, 7102)).build());
        builder.addAction(new NotificationCompat.Action.Builder(
            R.drawable.ic_stat_routino, "لغو", timerAction(ACTION_CANCEL, 7103)).build());
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
        // The system chronometer moves continuously; this refresh also keeps the explicit
        // remaining-time text correct for launchers that do not render a chronometer.
        handler.postDelayed(boundary, 1_000);
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

    private void recordAction(String nativeAction) {
        refresh(false);
        if (timer == null) return;
        String action = ACTION_PAUSE.equals(nativeAction) ? "pause"
            : ACTION_FINISH.equals(nativeAction) ? "finish" : "cancel";
        String snapshot = getPrefs().getString(EXTRA_SNAPSHOT, null);
        if (snapshot == null) return;
        try {
            JSONObject command = new JSONObject();
            command.put("id", UUID.randomUUID().toString());
            command.put("action", action);
            command.put("actedAt", System.currentTimeMillis());
            command.put("timer", new JSONObject(snapshot));
            getPrefs().edit().putString(EXTRA_COMMAND, command.toString()).apply();
            stopTimer(false);
        } catch (JSONException ignored) {
            // Do not stop an active timer when the snapshot cannot be persisted safely.
        }
    }

    private void stopTimer() {
        stopTimer(true);
    }

    private void stopTimer(boolean clearSnapshot) {
        handler.removeCallbacks(boundary);
        timer = null;
        if (clearSnapshot) getPrefs().edit().remove(EXTRA_SNAPSHOT).apply();
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
