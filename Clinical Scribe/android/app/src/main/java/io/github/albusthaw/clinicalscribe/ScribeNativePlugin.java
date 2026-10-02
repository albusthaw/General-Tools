package io.github.albusthaw.clinicalscribe;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
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
import java.security.GeneralSecurityException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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

    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private SecureStore store;
    private FileSaver files;
    private RecorderHub hub;
    private final RecorderHub.Observer events = new RecorderHub.Observer() {
        @Override
        public void onState(RecorderHub.Snapshot state) {
            notifyListeners("recorderState", RecorderCalls.state(state));
        }

        @Override
        public void onPart(String scribeId, int seq, long durationMs) {
            notifyListeners("recorderPart", RecorderCalls.part(scribeId, seq, durationMs));
        }

        @Override
        public void onLevel(float level) {
            // The level only feeds the sound ring, so it is not sent while the app is hidden.
            if (!getBridge().getApp().isActive()) return;
            JSObject data = new JSObject();
            data.put("level", level);
            notifyListeners("recorderLevel", data);
        }
    };

    @Override
    public void load() {
        store = new SecureStore(getContext());
        files = new FileSaver(getContext().getContentResolver());
        hub = RecorderHub.get();
        hub.init(getContext());
        hub.addObserver(events);
    }

    @Override
    protected void handleOnDestroy() {
        if (files != null) files.cancelAll();
        if (hub != null) hub.removeObserver(events);
    }

    /** Web links open in the phone's browser; any other kind of link is ignored. */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url.getScheme();
        if ("https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) return null;
        return true;
    }

    // Recording (RecorderHub records by itself, so it carries on with the screen off)

    @PluginMethod
    public void recorderStart(PluginCall call) {
        String id = RecorderCalls.scribeId(call);
        if (id == null) return;
        int segmentSeconds = RecorderCalls.clamp(call.getData().optLong("segmentSeconds", 600), 5, 3600);
        int maxSeconds = RecorderCalls.clamp(call.getData().optLong("maxSeconds", 4 * 3600), 1, 24 * 3600);
        // Android only lets the microphone work with the screen off when the
        // recording starts while the app is open and the microphone is allowed.
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("The microphone is not allowed", "mic_denied");
            return;
        }
        if (!getBridge().getApp().isActive()) {
            call.reject("Recording can only start while the app is open", "not_allowed");
            return;
        }
        String problem = hub.start(id, segmentSeconds, maxSeconds);
        if (problem != null) call.reject("Recording could not start", problem);
        else call.resolve(RecorderCalls.state(hub.snapshot()));
    }

    @PluginMethod
    public void recorderPause(PluginCall call) {
        hub.pause(PauseRules.USER);
        call.resolve(RecorderCalls.state(hub.snapshot()));
    }

    @PluginMethod
    public void recorderResume(PluginCall call) {
        hub.resume();
        call.resolve(RecorderCalls.state(hub.snapshot()));
    }

    @PluginMethod
    public void recorderStop(PluginCall call) {
        work.execute(() -> call.resolve(RecorderCalls.state(hub.stop())));
    }

    @PluginMethod
    public void recorderDiscard(PluginCall call) {
        work.execute(() -> {
            hub.discard();
            call.resolve(RecorderCalls.state(hub.snapshot()));
        });
    }

    @PluginMethod
    public void recorderStatus(PluginCall call) {
        call.resolve(RecorderCalls.state(hub.snapshot()));
    }

    @PluginMethod
    public void recorderDone(PluginCall call) {
        String id = RecorderCalls.scribeId(call);
        if (id == null) return;
        hub.done(id);
        call.resolve();
    }

    @PluginMethod
    public void pendingParts(PluginCall call) {
        String id = RecorderCalls.scribeId(call);
        if (id == null) return;
        RecorderHub.Snapshot state = hub.snapshot();
        int writing = id.equals(state.scribeId) ? state.writingSeq : 0;
        try {
            call.resolve(RecorderCalls.parts(hub.files().list(id, writing)));
        } catch (IOException | RuntimeException e) {
            call.reject("The parts could not be read", "read_failed");
        }
    }

    @PluginMethod
    public void recordingsOnPhone(PluginCall call) {
        call.resolve(RecorderCalls.recordings(hub.files().recordings()));
    }

    @PluginMethod
    public void readPart(PluginCall call) {
        RecorderCalls.readPart(call, hub.files());
    }

    @PluginMethod
    public void deletePart(PluginCall call) {
        String id = RecorderCalls.scribeId(call);
        if (id == null) return;
        int seq = RecorderCalls.seq(call);
        if (seq == 0) return;
        if (!RecorderCalls.isBeingWritten(id, seq)) hub.files().delete(id, seq);
        call.resolve();
    }

    @PluginMethod
    public void deleteParts(PluginCall call) {
        String id = RecorderCalls.scribeId(call);
        if (id == null) return;
        RecorderHub.Snapshot state = hub.snapshot();
        if (!(id.equals(state.scribeId) && state.live())) hub.files().deleteAll(id);
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
