package io.github.albusthaw.clinicalscribe;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Runs while a recording is live. Its notification tells Android that the app is
 * using the microphone, which lets RecorderHub keep recording when the screen is
 * off, another app is open, or the app is swiped away. Pause and Resume in the
 * notification act on the recording directly.
 */
public final class RecordingService extends Service {

    static final String ACTION_START = "io.github.albusthaw.clinicalscribe.recording.START";
    static final String ACTION_PAUSE = "io.github.albusthaw.clinicalscribe.recording.PAUSE";
    static final String ACTION_RESUME = "io.github.albusthaw.clinicalscribe.recording.RESUME";

    private static volatile boolean foreground;
    private static volatile boolean stopRequested;

    static void start(Context context) {
        stopRequested = false;
        ContextCompat.startForegroundService(context, new Intent(context, RecordingService.class).setAction(ACTION_START));
    }

    /** Stops the service, but never before it has shown its notification (Android requires that). */
    static void stop(Context context) {
        stopRequested = true;
        if (foreground) context.stopService(new Intent(context, RecordingService.class));
    }

    static void update(Context context, RecorderHub.Snapshot state) {
        if (!foreground || !state.live()) return;
        RecordingNotification.show(context, RecordingNotification.build(context, state));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        RecorderHub.get().init(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        RecorderHub hub = RecorderHub.get();
        if (ACTION_START.equals(action)) {
            RecorderHub.Snapshot state = hub.snapshot();
            ServiceCompat.startForeground(this, RecordingNotification.ID, RecordingNotification.build(this, state), microphoneType());
            foreground = true;
            if (stopRequested || !state.live()) stopSelf();
        } else if (ACTION_PAUSE.equals(action)) {
            hub.pause(PauseRules.NOTIFICATION);
        } else if (ACTION_RESUME.equals(action)) {
            hub.resume();
        }
        if (!foreground) stopSelf(startId);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        foreground = false;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static int microphoneType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
    }
}
