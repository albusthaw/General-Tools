package io.github.albusthaw.clinicalscribe;

import android.Manifest;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * The notification shown while recording: the time, and Pause or Resume. When the
 * recording paused by itself, it says why in short. It never shows the recording
 * label or anything else about the patient.
 */
final class RecordingNotification {

    static final int ID = 4108;
    private static final String CHANNEL = "recording";
    private static final int OPEN_REQUEST = 1;
    private static final int PAUSE_REQUEST = 2;
    private static final int RESUME_REQUEST = 3;

    private RecordingNotification() {}

    static Notification build(Context context, RecorderHub.Snapshot state) {
        createChannel(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_recording)
            .setColor(ContextCompat.getColor(context, R.color.brand_blue))
            .setContentIntent(openApp(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        if (RecorderHub.PAUSED.equals(state.phase)) {
            String kind = PauseRules.messageKind(state.reason);
            String title = context.getString("call".equals(kind) ? R.string.recording_paused_call : R.string.recording_paused);
            builder
                .setContentTitle(RecordingText.pausedText(title, state.activeMs))
                .setContentText(context.getString(pausedTextFor(kind)))
                .setShowWhen(false)
                .addAction(R.drawable.ic_action_resume, context.getString(R.string.recording_resume), action(context, RecordingService.ACTION_RESUME, RESUME_REQUEST));
        } else {
            builder
                .setContentTitle(context.getString(R.string.recording_title))
                .setContentText(context.getString(R.string.recording_text))
                .setWhen(System.currentTimeMillis() - state.activeMs)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .addAction(R.drawable.ic_action_pause, context.getString(R.string.recording_pause), action(context, RecordingService.ACTION_PAUSE, PAUSE_REQUEST));
        }
        return builder.build();
    }

    private static int pausedTextFor(String kind) {
        if ("call".equals(kind)) return R.string.recording_paused_call_text;
        if ("other".equals(kind)) return R.string.recording_paused_other_text;
        if ("mic".equals(kind)) return R.string.recording_paused_mic_text;
        return R.string.recording_paused_text;
    }

    /** Replaces the shown notification. Skipped when notifications are not allowed (it is hidden then anyway). */
    static void show(Context context, Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManagerCompat.from(context).notify(ID, notification);
    }

    private static void createChannel(Context context) {
        NotificationChannelCompat channel = new NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
            .setName(context.getString(R.string.recording_channel))
            .setShowBadge(false)
            .build();
        NotificationManagerCompat.from(context).createNotificationChannel(channel);
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, OPEN_REQUEST, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent action(Context context, String action, int request) {
        Intent intent = new Intent(context, RecordingService.class).setAction(action);
        return PendingIntent.getService(context, request, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
