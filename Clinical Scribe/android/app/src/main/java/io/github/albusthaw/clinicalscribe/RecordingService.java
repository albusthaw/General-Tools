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
 * Runs while a recording is in progress. It shows the recording notification,
 * which tells Android that the app is using the microphone, so the recording
 * keeps going when the screen turns off or another app is opened. Pause and
 * Resume in the notification are passed on to the page.
 */
public final class RecordingService extends Service {

    static final String ACTION_START = "io.github.albusthaw.clinicalscribe.recording.START";
    static final String ACTION_PAUSE = "io.github.albusthaw.clinicalscribe.recording.PAUSE";
    static final String ACTION_RESUME = "io.github.albusthaw.clinicalscribe.recording.RESUME";
    private static final String EXTRA_STARTED_AT = "startedAt";

    private static volatile boolean running;

    static void start(Context context, long startedAt) {
        Intent intent = new Intent(context, RecordingService.class).setAction(ACTION_START).putExtra(EXTRA_STARTED_AT, startedAt);
        ContextCompat.startForegroundService(context, intent);
    }

    static void update(Context context, boolean paused, long elapsedMs) {
        if (!running) return;
        RecordingNotification.show(context, RecordingNotification.build(context, paused, elapsedMs));
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, RecordingService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_START.equals(action)) {
            long now = System.currentTimeMillis();
            long elapsedMs = Math.max(0, now - intent.getLongExtra(EXTRA_STARTED_AT, now));
            ServiceCompat.startForeground(this, RecordingNotification.ID, RecordingNotification.build(this, false, elapsedMs), microphoneType());
            running = true;
        } else if (running && ACTION_PAUSE.equals(action)) {
            ScribeNativePlugin.sendRecordingAction("pause");
        } else if (running && ACTION_RESUME.equals(action)) {
            ScribeNativePlugin.sendRecordingAction("resume");
        } else if (!running) {
            stopSelf(startId);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
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
