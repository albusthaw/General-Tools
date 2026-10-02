package io.github.albusthaw.clinicalscribe;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioRecordingConfiguration;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * Records the microphone in parts. Sound is read with AudioRecord, encoded to AAC
 * and written frame by frame to ADTS files (Adts), so each part is usable up to its
 * last frame even after a crash. A new part starts at a frame boundary, so nothing
 * is lost between parts. All the work happens on one thread; pause, resume and
 * stop only set flags that the thread acts on.
 */
final class AudioPartRecorder implements Runnable {

    interface Listener {
        /** A part is complete and closed. */
        void onPart(int seq, long durationMs);

        /** The sound level (0 to 1), about ten times a second while recording. */
        void onLevel(float level);

        /** The microphone stopped or was silenced; the recording should pause. */
        void onInterrupted(String reason);

        /** The thread has finished; failure is null after a normal stop. */
        void onStopped(String failure);
    }

    static final int SAMPLE_RATE = 44100;
    private static final int BIT_RATE = 48000;
    private static final int READ_BYTES = 4096;
    private static final long TIMEOUT_US = 10_000;
    private static final long LEVEL_EVERY_MS = 100;
    private static final long SILENCE_CHECK_MS = 1000;

    private final Context context;
    private final PartFiles files;
    private final String scribeId;
    private final int framesPerPart;
    private final Listener listener;
    private final Object lock = new Object();
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

    private volatile boolean paused;
    private volatile boolean stopping;
    private volatile int writingSeq;
    private AudioRecord record;
    private MediaCodec encoder;
    private FileOutputStream out;
    private int seq;
    private int partFrames;
    private long samplesQueued;
    private long lastLevelAt;
    private long lastSilenceCheckAt;
    private int silencedChecks;

    AudioPartRecorder(Context context, PartFiles files, String scribeId, int segmentSeconds, Listener listener) {
        this.context = context;
        this.files = files;
        this.scribeId = scribeId;
        this.framesPerPart = Math.max(1, Adts.framesFor(segmentSeconds, SAMPLE_RATE));
        this.listener = listener;
    }

    /**
     * Opens the microphone and the encoder and starts listening. Returns null when
     * ready, or why it could not. Nothing is written until begin().
     */
    String open() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return "mic_denied";
        }
        if (!openMicrophone()) return "mic_busy";
        try {
            MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1);
            format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            format.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE);
            format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();
        } catch (IOException | RuntimeException e) {
            release();
            return "failed";
        }
        if (!startCapture()) {
            release();
            return "mic_busy";
        }
        return null;
    }

    /** Starts recording on its own thread. Call once, after open() returned null. */
    void begin() {
        new Thread(this, "clinical-scribe-recorder").start();
    }

    /** Closes what open() opened, when the recording will not begin after all. */
    void cancel() {
        release();
    }

    void pause() {
        paused = true;
    }

    void resume() {
        synchronized (lock) {
            paused = false;
            lock.notifyAll();
        }
    }

    void stop() {
        synchronized (lock) {
            stopping = true;
            lock.notifyAll();
        }
    }

    /** The part being written now, or 0. */
    int writingSeq() {
        return writingSeq;
    }

    @Override
    public void run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        byte[] pcm = new byte[READ_BYTES];
        String failure = null;
        try {
            while (!stopping) {
                if (paused) {
                    holdWhilePaused();
                    continue;
                }
                int read = record.read(pcm, 0, pcm.length);
                if (read < 0) {
                    // The microphone went away (for example the audio system restarted).
                    closeMicrophone();
                    paused = true;
                    listener.onInterrupted(PauseRules.MIC_LOST);
                    continue;
                }
                if (read == 0) continue;
                reportLevel(pcm, read);
                queue(pcm, read, false);
                drain(false);
                checkSilenced();
            }
            queue(pcm, 0, true);
            drain(true);
        } catch (IOException | RuntimeException e) {
            failure = "write_failed";
        } finally {
            try {
                closePart();
            } catch (IOException e) {
                if (failure == null) failure = "write_failed";
            }
            release();
            listener.onStopped(failure);
        }
    }

    private void holdWhilePaused() throws IOException {
        stopCapture();
        drain(false);
        synchronized (lock) {
            while (paused && !stopping) {
                try {
                    lock.wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    stopping = true;
                }
            }
        }
        if (stopping) return;
        if (!startCapture()) {
            paused = true;
            listener.onInterrupted(PauseRules.MIC_BUSY);
        }
    }

    private boolean openMicrophone() {
        int minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) return false;
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false;
        try {
            // Half a second of room, so a busy moment never drops sound.
            record = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 4, SAMPLE_RATE));
        } catch (IllegalArgumentException | SecurityException e) {
            record = null;
            return false;
        }
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
            closeMicrophone();
            return false;
        }
        return true;
    }

    private boolean startCapture() {
        if (record == null && !openMicrophone()) return false;
        try {
            record.startRecording();
        } catch (IllegalStateException e) {
            return false;
        }
        silencedChecks = 0;
        return record.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING;
    }

    private void stopCapture() {
        if (record == null) return;
        try {
            if (record.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) record.stop();
        } catch (IllegalStateException ignored) {
            // Already stopped.
        }
    }

    private void closeMicrophone() {
        if (record == null) return;
        stopCapture();
        record.release();
        record = null;
    }

    /** Hands sound to the encoder; with endOfStream, the last buffer also marks the end. */
    private void queue(byte[] pcm, int length, boolean endOfStream) throws IOException {
        int offset = 0;
        long deadline = deadlineIn(1000);
        while (true) {
            int index = encoder.dequeueInputBuffer(TIMEOUT_US);
            if (index < 0) {
                drain(false);
                if (passed(deadline)) return; // drop rather than hang
                continue;
            }
            ByteBuffer input = encoder.getInputBuffer(index);
            if (input == null) return;
            input.clear();
            int count = Math.min(length - offset, input.capacity());
            input.put(pcm, offset, count);
            long timeUs = samplesQueued * 1_000_000L / SAMPLE_RATE;
            offset += count;
            samplesQueued += count / 2;
            boolean done = offset >= length;
            encoder.queueInputBuffer(index, 0, count, timeUs, done && endOfStream ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
            if (done) return;
        }
    }

    private void drain(boolean endOfStream) throws IOException {
        long deadline = deadlineIn(2000);
        while (true) {
            int index = encoder.dequeueOutputBuffer(info, endOfStream ? TIMEOUT_US : 0);
            if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream || passed(deadline)) return;
                continue;
            }
            if (index < 0) continue; // the output format or buffers changed
            ByteBuffer data = encoder.getOutputBuffer(index);
            boolean config = (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
            if (!config && info.size > 0 && data != null) writeFrame(data);
            encoder.releaseOutputBuffer(index, false);
            if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
        }
    }

    private void writeFrame(ByteBuffer data) throws IOException {
        byte[] frame = new byte[info.size];
        data.position(info.offset);
        data.limit(info.offset + info.size);
        data.get(frame);
        if (out == null) openPart();
        out.write(Adts.header(frame.length, SAMPLE_RATE, 1));
        out.write(frame);
        partFrames++;
        if (partFrames >= framesPerPart) closePart();
    }

    private void openPart() throws IOException {
        seq++;
        out = new FileOutputStream(files.part(scribeId, seq));
        partFrames = 0;
        writingSeq = seq;
    }

    private void closePart() throws IOException {
        if (out == null) return;
        int doneSeq = seq;
        int frames = partFrames;
        try {
            out.flush();
            out.getFD().sync();
        } finally {
            out.close();
            out = null;
            writingSeq = 0;
        }
        if (frames > 0) listener.onPart(doneSeq, Adts.durationMs(frames, SAMPLE_RATE));
        else files.delete(scribeId, doneSeq);
    }

    private void reportLevel(byte[] pcm, int length) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastLevelAt < LEVEL_EVERY_MS) return;
        lastLevelAt = now;
        long sum = 0;
        int count = length / 2;
        for (int i = 0; i + 1 < length; i += 2) {
            int sample = (short) ((pcm[i] & 0xFF) | (pcm[i + 1] << 8));
            sum += (long) sample * sample;
        }
        double rms = count > 0 ? Math.sqrt(sum / (double) count) / 32768.0 : 0;
        listener.onLevel((float) Math.min(1.0, rms * 4.5));
    }

    // Android 10 and newer say when the system silences the microphone, for
    // example for a call or voice commands. Two checks in a row avoid false alarms.
    private void checkSilenced() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastSilenceCheckAt < SILENCE_CHECK_MS) return;
        lastSilenceCheckAt = now;
        AudioRecordingConfiguration config;
        try {
            config = record.getActiveRecordingConfiguration();
        } catch (RuntimeException e) {
            return; // This phone does not report it; calls are still noticed by Interruptions.
        }
        silencedChecks = config != null && config.isClientSilenced() ? silencedChecks + 1 : 0;
        if (silencedChecks >= 2) {
            silencedChecks = 0;
            paused = true;
            listener.onInterrupted(PauseRules.SILENCED);
        }
    }

    // Waits are measured with the monotonic clock, so they always end.
    private static long deadlineIn(long milliseconds) {
        return System.nanoTime() + milliseconds * 1_000_000L;
    }

    private static boolean passed(long deadline) {
        return System.nanoTime() - deadline > 0;
    }

    private void release() {
        closeMicrophone();
        if (encoder != null) {
            try {
                encoder.stop();
            } catch (IllegalStateException ignored) {
                // Never started.
            }
            encoder.release();
            encoder = null;
        }
    }
}
