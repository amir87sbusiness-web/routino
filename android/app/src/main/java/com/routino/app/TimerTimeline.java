package com.routino.app;

/** A wall-clock snapshot of the running timer, independent of the WebView lifecycle. */
final class TimerTimeline {
    final String mode;
    final long focusDurationMs;
    final long breakDurationMs;
    final int cycles;
    long remainingMs;
    long elapsedMs;
    long anchorAt;
    int round;
    boolean onBreak;
    boolean running = true;

    TimerTimeline(String mode, long remainingMs, long elapsedMs, long focusDurationMs,
                  long breakDurationMs, int cycles, int round, boolean onBreak, long anchorAt) {
        this.mode = mode;
        this.remainingMs = Math.max(0, remainingMs);
        this.elapsedMs = Math.max(0, elapsedMs);
        this.focusDurationMs = Math.max(1, focusDurationMs);
        this.breakDurationMs = Math.max(1, breakDurationMs);
        this.cycles = Math.max(1, cycles);
        this.round = Math.max(1, round);
        this.onBreak = onBreak;
        this.anchorAt = anchorAt;
    }

    long deadlineMs() {
        return anchorAt + remainingMs;
    }

    static String formatClock(long millis) {
        long seconds = Math.max(0, millis) / 1_000;
        long hours = seconds / 3_600;
        long minutes = (seconds % 3_600) / 60;
        long remainder = seconds % 60;
        if (hours > 0) return String.format(java.util.Locale.ROOT, "%d:%02d:%02d", hours, minutes, remainder);
        return String.format(java.util.Locale.ROOT, "%02d:%02d", minutes, remainder);
    }

    void advance(long now) {
        if (!running || now <= anchorAt) return;
        long delta = now - anchorAt;
        if ("stopwatch".equals(mode)) {
            elapsedMs += delta;
            anchorAt = now;
            return;
        }
        while (running && remainingMs > 0 && delta >= remainingMs) {
            long boundary = anchorAt + remainingMs;
            delta -= remainingMs;
            anchorAt = boundary;
            if (!"pomodoro".equals(mode) || (round >= cycles && !onBreak)) {
                remainingMs = 0;
                running = false;
            } else if (onBreak) {
                onBreak = false;
                round++;
                remainingMs = focusDurationMs;
            } else {
                onBreak = true;
                remainingMs = breakDurationMs;
            }
        }
        if (running && remainingMs == 0) running = false;
        if (running) {
            remainingMs -= delta;
            anchorAt = now;
        }
    }
}
