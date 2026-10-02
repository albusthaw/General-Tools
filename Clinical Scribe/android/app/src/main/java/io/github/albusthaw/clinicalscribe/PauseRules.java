package io.github.albusthaw.clinicalscribe;

import android.media.AudioManager;

/**
 * Why a recording pauses by itself. A call or other sound never ends a recording:
 * it pauses with one of these reasons, and the person resumes when ready.
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

    /** The kind of message shown in the notification for a pause reason. */
    static String messageKind(String reason) {
        if (CALL.equals(reason)) return "call";
        if (OTHER_AUDIO.equals(reason)) return "other";
        if (MIC_LOST.equals(reason) || MIC_BUSY.equals(reason)) return "mic";
        return "plain";
    }
}
