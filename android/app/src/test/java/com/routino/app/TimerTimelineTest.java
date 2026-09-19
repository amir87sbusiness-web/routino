package com.routino.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TimerTimelineTest {
    @Test
    public void countdownKeepsElapsedTimeWhileAppIsAway() {
        TimerTimeline timer = new TimerTimeline("free", 60_000, 0, 60_000, 10_000, 1, 1, false, 1_000);
        timer.advance(31_000);
        assertEquals(30_000, timer.remainingMs);
        assertEquals(61_000, timer.deadlineMs());
        assertTrue(timer.running);
    }

    @Test
    public void pomodoroAdvancesAcrossBreakAndFinishes() {
        TimerTimeline timer = new TimerTimeline("pomodoro", 60_000, 0, 60_000, 60_000, 2, 1, false, 1_000);
        timer.advance(121_000);
        assertEquals(2, timer.round);
        assertFalse(timer.onBreak);
        assertEquals(60_000, timer.remainingMs);
        timer.advance(181_000);
        assertFalse(timer.running);
    }

    @Test
    public void stopwatchCountsUp() {
        TimerTimeline timer = new TimerTimeline("stopwatch", 0, 5_000, 60_000, 10_000, 1, 1, false, 1_000);
        timer.advance(11_000);
        assertEquals(15_000, timer.elapsedMs);
        assertEquals(11_000, timer.anchorAt);
    }
}
