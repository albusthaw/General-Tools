package io.github.albusthaw.clinicalscribe;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;
import java.util.List;

/**
 * Notices what should pause a recording: a call (ringing, a phone call or an
 * internet call) and other sound (music, video, an alarm or voice commands taking
 * the audio focus). Short notification sounds only lower other sound, so they do
 * not pause. After such a pause it watches for the end of the call or the sound and
 * says when the recording can start again by itself. Events arrive on the main thread.
 */
final class Interruptions {

    interface Callback {
        void onInterrupted(String reason);

        /** The call or other sound has ended: the recording can start again. */
        void onOver();

        /** The recording waited as long as it may; the person resumes when ready. */
        void onGaveUp();
    }

    private static final long MODE_CHECK_MS = 1000;
    private static final long WAIT_CHECK_MS = 500;

    // Who has the sound: this app, another app for a moment (it gives it back), or
    // another app for good (this app must ask again).
    private static final int FOCUS_NONE = 0;
    private static final int FOCUS_HELD = 1;
    private static final int FOCUS_LENT = 2;
    private static final int FOCUS_LOST = 3;

    private final AudioManager audio;
    private final Callback callback;
    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AudioManager.OnAudioFocusChangeListener focusListener;
    private AudioFocusRequest focusRequest;
    private ModeWatcher modeWatcher;
    private boolean watching;
    private int focus = FOCUS_NONE;
    private boolean waiting;
    private long waitingSince;
    private long quietSince;
    private long settleMs = PauseRules.SETTLE_MS;

    private final Runnable modeCheck = new Runnable() {
        @Override
        public void run() {
            if (!watching) return;
            if (inCall()) callback.onInterrupted(PauseRules.CALL);
            handler.postDelayed(this, MODE_CHECK_MS);
        }
    };

    // While paused by a call or other sound: is everything quiet again?
    private final Runnable waitCheck = new Runnable() {
        @Override
        public void run() {
            if (!waiting) return;
            long now = SystemClock.elapsedRealtime();
            boolean busy = inCall() || audio.isMusicActive() || micUsedElsewhere();
            if (busy) quietSince = 0;
            else if (quietSince == 0) quietSince = now;
            long quiet = quietSince == 0 ? 0 : now - quietSince;
            String step = PauseRules.nextStep(busy, focus == FOCUS_LENT, quiet, now - waitingSince, settleMs);
            if (PauseRules.RESUME.equals(step)) {
                waiting = false;
                callback.onOver();
            } else if (PauseRules.GIVE_UP.equals(step)) {
                waiting = false;
                callback.onGaveUp();
            } else {
                handler.postDelayed(this, WAIT_CHECK_MS);
            }
        }
    };

    Interruptions(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.audio = (AudioManager) this.context.getSystemService(Context.AUDIO_SERVICE);
        this.callback = callback;
        this.focusListener = change -> {
            if (change == AudioManager.AUDIOFOCUS_GAIN) focus = FOCUS_HELD;
            else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) focus = FOCUS_LENT;
            else if (change == AudioManager.AUDIOFOCUS_LOSS) focus = FOCUS_LOST;
            String reason = PauseRules.forFocusChange(change, audio.getMode());
            if (reason != null) callback.onInterrupted(reason);
        };
    }

    /** The phone's audio mode: normal, ringing, or one of the call modes. */
    int mode() {
        return audio.getMode();
    }

    /** True while the phone rings or a call is going on. */
    boolean inCall() {
        return PauseRules.isCallMode(mode());
    }

    /** While recording: holds the audio focus and watches for calls. */
    void begin() {
        handler.post(() -> {
            stopWaiting();
            requestFocus();
            startWatching();
        });
    }

    /**
     * After a call or other sound paused the recording: keeps its place for the audio
     * focus, so it is given back, and says when everything is quiet again (onOver), or
     * that it waited too long (onGaveUp). since: when the recording paused (the
     * elapsed-time clock); settle: the quiet needed before starting again.
     */
    void waitForEnd(long since, long settle) {
        handler.post(() -> {
            startWatching();
            waiting = true;
            waitingSince = since;
            settleMs = settle;
            quietSince = 0;
            handler.removeCallbacks(waitCheck);
            handler.postDelayed(waitCheck, WAIT_CHECK_MS);
        });
    }

    /** While paused by the person or stopped: lets other apps play again and stops watching. */
    void end() {
        handler.post(() -> {
            stopWaiting();
            watching = false;
            handler.removeCallbacks(modeCheck);
            if (modeWatcher != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                modeWatcher.close();
            }
            modeWatcher = null;
            abandonFocus();
        });
    }

    private void startWatching() {
        if (watching) return;
        watching = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            modeWatcher = new ModeWatcher(context, audio, callback);
        } else {
            handler.postDelayed(modeCheck, MODE_CHECK_MS);
        }
    }

    private void stopWaiting() {
        waiting = false;
        handler.removeCallbacks(waitCheck);
    }

    // Another app is recording, for example voice commands. This app's own
    // microphone is stopped while paused, so it is not counted.
    private boolean micUsedElsewhere() {
        try {
            List<AudioRecordingConfiguration> active = audio.getActiveRecordingConfigurations();
            return active != null && !active.isEmpty();
        } catch (RuntimeException e) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private void requestFocus() {
        if (focus == FOCUS_HELD) return;
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                    .setWillPauseWhenDucked(false)
                    .setOnAudioFocusChangeListener(focusListener, handler)
                    .build();
            }
            granted = audio.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            granted = audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        if (granted) focus = FOCUS_HELD;
    }

    @SuppressWarnings("deprecation")
    private void abandonFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audio.abandonAudioFocus(focusListener);
        }
        focus = FOCUS_NONE;
    }

    /** Android 12 and newer report changes of the call state directly. */
    @RequiresApi(Build.VERSION_CODES.S)
    private static final class ModeWatcher {
        private final AudioManager audio;
        private final AudioManager.OnModeChangedListener listener;

        ModeWatcher(Context context, AudioManager audio, Callback callback) {
            this.audio = audio;
            this.listener = mode -> {
                if (PauseRules.isCallMode(mode)) callback.onInterrupted(PauseRules.CALL);
            };
            audio.addOnModeChangedListener(ContextCompat.getMainExecutor(context), listener);
            if (PauseRules.isCallMode(audio.getMode())) callback.onInterrupted(PauseRules.CALL);
        }

        void close() {
            audio.removeOnModeChangedListener(listener);
        }
    }
}
