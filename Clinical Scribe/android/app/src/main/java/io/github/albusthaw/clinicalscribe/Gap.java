package io.github.albusthaw.clinicalscribe;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A time when nothing was recorded because the recording paused by itself, for a
 * call or other sound, and then started again. The part recorded after it carries
 * it in a small file next to the audio (0003.gap holds "call 81234"), so the server
 * can mark the place in the transcript and the note.
 */
final class Gap {

    /** The longest gap kept: a day. */
    static final long MAX_MS = 24L * 3600 * 1000;
    private static final Pattern TEXT = Pattern.compile("([a-z_]{1,20}) (\\d{1,9})");

    /** Why the recording paused: a pause reason from PauseRules. */
    final String reason;
    /** How long nothing was recorded. */
    final long ms;
    /** The time recorded before the gap, or -1 when it is not known. */
    final long atMs;

    Gap(String reason, long ms, long atMs) {
        this.reason = reason;
        this.ms = Math.max(0, Math.min(MAX_MS, ms));
        this.atMs = atMs;
    }

    /** The text kept next to the part: the reason and the length in milliseconds. */
    String fileText() {
        return reason + " " + ms;
    }

    /** The gap kept next to a part, or null when the text is not one. */
    static Gap fromFileText(String text) {
        if (text == null) return null;
        Matcher match = TEXT.matcher(text.trim());
        if (!match.matches()) return null;
        long ms = Long.parseLong(match.group(2));
        if (ms > MAX_MS) return null;
        return new Gap(match.group(1), ms, -1);
    }
}
