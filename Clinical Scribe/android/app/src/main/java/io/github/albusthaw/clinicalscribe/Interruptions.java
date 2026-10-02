package io.github.albusthaw.clinicalscribe;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;

/**
 * Notices what should pause a recording: a call (ringing, a phone call or an
 * internet call) and other sound (music, video, an alarm or voice commands taking
 * the audio focus). Short notification sounds only lower other sound, so they do
 * not pause. Events arrive on the main thread.
 */
final class Interruptions {

    interface Callback {
        void onInterrupted(String reason);
    }

    private static final long MODE_CHECK_MS = 1000;

    private final AudioManager audio;
    private final Callback callback;
    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AudioManager.OnAudioFocusChangeListener focusListener;
    private AudioFocusRequest focusRequest;
    private ModeWatcher modeWatcher;
    private boolean watching;
    private boolean holdingFocus;

    private final Runnable modeCheck = new Runnable() {
        @Override
        public void run() {
            if (!watching) return;
            if (inCall()) callback.onInterrupted(PauseRules.CALL);
            handler.postDelayed(this, MODE_CHECK_MS);
        }
    };

    Interruptions(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.audio = (AudioManager) this.context.getSystemService(Context.AUDIO_SERVICE);
        this.callback = callback;
        this.focusListener = change -> {
            String reason = PauseRules.forFocusChange(change, audio.getMode());
            if (reason != null) {
                holdingFocus = false;
                callback.onInterrupted(reason);
            }
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
            requestFocus();
            if (watching) return;
            watching = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                modeWatcher = new ModeWatcher(context, audio, callback);
            } else {
                handler.postDelayed(modeCheck, MODE_CHECK_MS);
            }
        });
    }

    /** While paused or stopped: lets other apps play again and stops watching. */
    void end() {
        handler.post(() -> {
            watching = false;
            handler.removeCallbacks(modeCheck);
            if (modeWatcher != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                modeWatcher.close();
            }
            modeWatcher = null;
            abandonFocus();
        });
    }

    @SuppressWarnings("deprecation")
    private void requestFocus() {
        if (holdingFocus) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(focusListener, handler)
                .build();
            holdingFocus = audio.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            holdingFocus = audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    @SuppressWarnings("deprecation")
    private void abandonFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audio.abandonAudioFocus(focusListener);
        }
        holdingFocus = false;
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
