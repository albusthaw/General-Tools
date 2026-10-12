package io.github.albusthaw.clinicalscribe;

import android.media.AudioManager;

/**
 * Why a recording pauses by itself, and when it starts again by itself. A call or
 * other sound never ends a recording: it pauses with one of these reasons, and the
 * recording starts again by itself once the call or the sound has ended. A pause the
 * person made never ends by itself.
 */
final class PauseRules {

    static final String USER = "user";
    static final String NOTIFICATION = "notification";
    static final String CALL = "call";
    static final String OTHER_AUDIO = "other_audio";
    static final String MIC_LOST = "mic_lost";
    static final String MIC_BUSY = "mic_busy";
    /** The system silenced the microphone; the reason is a call or a busy microphone. */
    static final String SILENCED = "silenced";
    static final String LIMIT = "limit";

    /** What to do while waiting to start again by itself. */
    static final String WAIT = "wait";
    static final String RESUME = "resume";
    static final String GIVE_UP = "give_up";

    /** The quiet needed after a call or other sound before recording starts again. */
    static final long SETTLE_MS = 2_000;
    /**
     * Another app that borrowed the sound for a moment gives it back when done. When
     * that never comes, this much quiet is enough to start again.
     */
    static final long LONG_QUIET_MS = 10_000;
    /** The longest a recording waits to start again by itself; then the person resumes. */
    static final long MAX_WAIT_MS = 60 * 60_000L;

    private PauseRules() {}

    /** Ringing, a phone call, an internet call, or a call being screened or redirected. */
    static boolean isCallMode(int mode) {
        return mode >= 1 && mode <= 6; // MODE_RINGTONE .. MODE_COMMUNICATION_REDIRECT
    }

    /**
     * The pause reason for a change of audio focus, or null when the recording carries
     * on: gaining focus back, or a short sound that only lowers others' volume.
     */
    static String forFocusChange(int change, int mode) {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            return isCallMode(mode) ? CALL : OTHER_AUDIO;
        }
        return null;
    }

    /** What a silenced microphone means right now. */
    static String forSilenced(int mode) {
        return isCallMode(mode) ? CALL : MIC_BUSY;
    }

    /** A pause Android made by itself, which ends by itself when the call or sound ends. */
    static boolean resumesByItself(String reason) {
        return CALL.equals(reason) || OTHER_AUDIO.equals(reason) || MIC_LOST.equals(reason) || MIC_BUSY.equals(reason);
    }

    /**
     * What to do while a paused recording waits to start again by itself.
     * busy: a call, other sound or another app using the microphone right now.
     * soundComingBack: another app borrowed the sound for a moment and gives it back when done.
     * quietMs: how long nothing has been busy. waitedMs: how long the recording has waited.
     * settleMs: the quiet needed before starting again.
     */
    static String nextStep(boolean busy, boolean soundComingBack, long quietMs, long waitedMs, long settleMs) {
        if (waitedMs >= MAX_WAIT_MS) return GIVE_UP;
        if (busy) return WAIT;
        if (soundComingBack && quietMs < LONG_QUIET_MS) return WAIT;
        return quietMs >= settleMs ? RESUME : WAIT;
    }

    /** The quiet to wait for: twice as long after each try that found the microphone busy, up to half a minute. */
    static long settleFor(int failedTries) {
        return Math.min(30_000, SETTLE_MS << Math.max(0, Math.min(failedTries, 4)));
    }

    /** The kind of message shown in the notification for a pause reason. */
    static String messageKind(String reason) {
        if (CALL.equals(reason)) return "call";
        if (OTHER_AUDIO.equals(reason)) return "other";
        if (MIC_LOST.equals(reason) || MIC_BUSY.equals(reason)) return "mic";
        return "plain";
    }
}
