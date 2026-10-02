package io.github.albusthaw.clinicalscribe;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Window;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.security.GeneralSecurityException;
import java.util.regex.Pattern;

/**
 * The app's own Android features, used by the app pages (web/src/app/native/plugin.js).
 * Every value that arrives from the page is checked here before it is used.
 */
@CapacitorPlugin(
    name = "ScribeNative",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class ScribeNativePlugin extends Plugin {

    private static final Pattern STORAGE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,200}");
    private static final int MAX_STORED_LENGTH = 256 * 1024;
    private static final long MAX_RECORDING_MS = 24L * 60 * 60 * 1000;

    private static volatile WeakReference<ScribeNativePlugin> current = new WeakReference<>(null);

    private SecureStore store;
    private FileSaver files;

    @Override
    public void load() {
        store = new SecureStore(getContext());
        files = new FileSaver(getContext().getContentResolver());
        current = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        if (files != null) files.cancelAll();
    }

    /** Pause or Resume pressed in the recording notification. */
    static void sendRecordingAction(String action) {
        ScribeNativePlugin plugin = current.get();
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        plugin.notifyListeners("recordingAction", data);
    }

    /** Web links open in the phone's browser; any other kind of link is ignored. */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url.getScheme();
        if ("https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) return null;
        return true;
    }

    // Screen and recording

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    @PluginMethod
    public void startRecording(PluginCall call) {
        long now = System.currentTimeMillis();
        long startedAt = call.getData().optLong("startedAt", now);
        if (startedAt > now || startedAt < now - MAX_RECORDING_MS) startedAt = now;
        // Android only lets the microphone work with the screen off when the
        // recording starts while the app is open and the microphone is allowed.
        if (getPermissionState("microphone") != PermissionState.GRANTED || !getBridge().getApp().isActive()) {
            call.reject("Not allowed now");
            return;
        }
        try {
            RecordingService.start(getContext(), startedAt);
            call.resolve();
        } catch (IllegalStateException | SecurityException e) {
            call.reject("Not allowed now");
        }
    }

    @PluginMethod
    public void updateRecording(PluginCall call) {
        boolean paused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        long elapsedMs = Math.max(0, Math.min(call.getData().optLong("elapsedMs", 0), MAX_RECORDING_MS));
        RecordingService.update(getContext(), paused, elapsedMs);
        call.resolve();
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        RecordingService.stop(getContext());
        call.resolve();
    }

    // Permissions

    @PluginMethod
    public void permissionStatus(PluginCall call) {
        call.resolve(permissions());
    }

    @PluginMethod
    public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve(permissions());
            return;
        }
        requestPermissionForAlias("microphone", call, "permissionAnswered");
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(permissions());
            return;
        }
        requestPermissionForAlias("notifications", call, "permissionAnswered");
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        call.resolve(permissions());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Settings could not open");
        }
    }

    private JSObject permissions() {
        JSObject result = new JSObject();
        result.put("microphone", stateText(getPermissionState("microphone")));
        result.put("notifications", notificationState());
        return result;
    }

    private String notificationState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
        }
        return stateText(getPermissionState("notifications"));
    }

    private static String stateText(PermissionState state) {
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    // Sign-in storage

    @PluginMethod
    public void secureGet(PluginCall call) {
        String name = storageName(call);
        if (name == null) return;
        JSObject result = new JSObject();
        String value = store.get(name);
        if (value != null) result.put("value", value);
        call.resolve(result);
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String name = storageName(call);
        if (name == null) return;
        String value = call.getString("value");
        if (value == null || value.length() > MAX_STORED_LENGTH) {
            call.reject("Value not accepted");
            return;
        }
        try {
            store.set(name, value);
            call.resolve();
        } catch (GeneralSecurityException | IOException e) {
            call.reject("Could not keep the sign-in");
        }
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String name = storageName(call);
        if (name == null) return;
        store.remove(name);
        call.resolve();
    }

    private static String storageName(PluginCall call) {
        String name = call.getString("key");
        if (name == null || !STORAGE_NAME.matcher(name).matches()) {
            call.reject("Name not accepted");
            return null;
        }
        return name;
    }

    // Saving files: the person picks the place, then the page sends the file in parts.

    @PluginMethod
    public void saveFileStart(PluginCall call) {
        String name = call.getString("name");
        String type = call.getString("mimeType");
        if (!FileSaver.isNameAccepted(name) || !FileSaver.isTypeAccepted(type)) {
            call.reject("File not accepted");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(type)
            .putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(call, intent, "placeChosen");
        } catch (ActivityNotFoundException e) {
            call.reject("Saving files is not available on this phone");
        }
    }

    @ActivityCallback
    private void placeChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri place = result.getResultCode() == Activity.RESULT_OK && data != null ? data.getData() : null;
        JSObject answer = new JSObject();
        if (place == null) {
            answer.put("saved", false);
            call.resolve(answer);
            return;
        }
        try {
            answer.put("token", files.open(place));
            answer.put("saved", true);
            call.resolve(answer);
        } catch (IOException | SecurityException e) {
            call.reject("The file could not be saved");
        }
    }

    @PluginMethod
    public void saveFileWrite(PluginCall call) {
        String token = call.getString("token");
        try {
            files.write(token, call.getString("data"));
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            files.cancel(token);
            call.reject("The file could not be saved");
        }
    }

    @PluginMethod
    public void saveFileFinish(PluginCall call) {
        try {
            files.finish(call.getString("token"));
            call.resolve();
        } catch (IOException e) {
            call.reject("The file could not be saved");
        }
    }

    @PluginMethod
    public void saveFileCancel(PluginCall call) {
        files.cancel(call.getString("token"));
        call.resolve();
    }
}
