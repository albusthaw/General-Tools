package io.github.albusthaw.clinicalscribe;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.IOException;
import java.util.List;

/**
 * The recorder side of ScribeNativePlugin: checks every value from the page and
 * turns the recorder's state and parts into answers for it.
 */
final class RecorderCalls {

    /** The most bytes of a part sent in one answer (768 KB, about 1 MB as base64). */
    static final int MAX_READ = 768 * 1024;

    private RecorderCalls() {}

    static JSObject state(RecorderHub.Snapshot state) {
        JSObject answer = new JSObject();
        answer.put("phase", state.phase);
        answer.put("scribeId", state.scribeId);
        answer.put("reason", state.reason);
        answer.put("activeMs", state.activeMs);
        answer.put("limitReached", state.limitReached);
        return answer;
    }

    static JSObject part(String scribeId, int seq, long durationMs) {
        JSObject answer = new JSObject();
        answer.put("scribeId", scribeId);
        answer.put("seq", seq);
        answer.put("durationMs", durationMs);
        return answer;
    }

    static JSObject parts(List<PartFiles.Part> parts) {
        JSArray list = new JSArray();
        for (PartFiles.Part part : parts) {
            JSObject item = new JSObject();
            item.put("seq", part.seq);
            item.put("bytes", part.bytes);
            item.put("durationMs", part.durationMs);
            list.put(item);
        }
        JSObject answer = new JSObject();
        answer.put("parts", list);
        return answer;
    }

    static JSObject recordings(List<String> ids) {
        JSArray list = new JSArray();
        for (String id : ids) list.put(id);
        JSObject answer = new JSObject();
        answer.put("recordings", list);
        return answer;
    }

    static JSObject chunk(byte[] data) {
        JSObject answer = new JSObject();
        answer.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        answer.put("size", data.length);
        return answer;
    }

    /** The recording id from the page, or null after rejecting the call. */
    static String scribeId(PluginCall call) {
        String id = call.getString("scribeId");
        if (!PartFiles.isScribeId(id)) {
            call.reject("Recording not accepted", "bad_request");
            return null;
        }
        return id;
    }

    /** The part number from the page, or 0 after rejecting the call. */
    static int seq(PluginCall call) {
        int seq = call.getData().optInt("seq", 0);
        if (!PartFiles.isSeq(seq)) {
            call.reject("Part not accepted", "bad_request");
            return 0;
        }
        return seq;
    }

    static int clamp(long value, int min, int max) {
        return (int) Math.max(min, Math.min(max, value));
    }

    /** The part the recorder is writing now must not be read or removed yet. */
    static boolean isBeingWritten(String scribeId, int seq) {
        RecorderHub.Snapshot state = RecorderHub.get().snapshot();
        return scribeId.equals(state.scribeId) && state.writingSeq == seq;
    }

    static void readPart(PluginCall call, PartFiles files) {
        String id = scribeId(call);
        if (id == null) return;
        int seq = seq(call);
        if (seq == 0) return;
        long offset = call.getData().optLong("offset", 0);
        int length = clamp(call.getData().optLong("length", MAX_READ), 0, MAX_READ);
        if (isBeingWritten(id, seq)) {
            call.reject("The part is still being recorded", "busy");
            return;
        }
        try {
            call.resolve(chunk(files.read(id, seq, offset, length)));
        } catch (IOException | RuntimeException e) {
            call.reject("The part could not be read", "read_failed");
        }
    }
}
