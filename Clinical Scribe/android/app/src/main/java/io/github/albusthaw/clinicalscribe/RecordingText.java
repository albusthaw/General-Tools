package io.github.albusthaw.clinicalscribe;

import java.util.Locale;

/** Text shown in the recording notification. No recording label is ever shown there. */
final class RecordingText {

    private RecordingText() {}

    /** Elapsed time as 4:05 or 1:02:03. */
    static String elapsed(long milliseconds) {
        long seconds = Math.max(0, milliseconds / 1000);
        long hours = seconds / 3600;
        long minutes = (seconds % 3600) / 60;
        long rest = seconds % 60;
        if (hours > 0) return String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, rest);
        return String.format(Locale.ROOT, "%d:%02d", minutes, rest);
    }

    /** "Paused · 4:05" while paused; while recording the system clock in the notification counts up. */
    static String pausedText(String paused, long elapsedMs) {
        return paused + " · " + elapsed(elapsedMs);
    }
}
