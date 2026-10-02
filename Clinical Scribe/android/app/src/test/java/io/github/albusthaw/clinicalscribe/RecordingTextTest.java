package io.github.albusthaw.clinicalscribe;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class RecordingTextTest {

    @Test
    public void showsMinutesAndSeconds() {
        assertEquals("0:00", RecordingText.elapsed(0));
        assertEquals("0:09", RecordingText.elapsed(9_999));
        assertEquals("4:05", RecordingText.elapsed(245_000));
        assertEquals("59:59", RecordingText.elapsed(3_599_000));
    }

    @Test
    public void showsHoursForLongRecordings() {
        assertEquals("1:00:00", RecordingText.elapsed(3_600_000));
        assertEquals("1:02:03", RecordingText.elapsed(3_723_000));
    }

    @Test
    public void neverShowsANegativeTime() {
        assertEquals("0:00", RecordingText.elapsed(-5_000));
    }

    @Test
    public void showsThePausedTime() {
        assertEquals("Paused · 4:05", RecordingText.pausedText("Paused", 245_000));
    }
}
