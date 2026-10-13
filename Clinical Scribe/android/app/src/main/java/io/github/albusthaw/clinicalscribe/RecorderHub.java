package io.github.albusthaw.clinicalscribe;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.PowerManager;
import android.os.SystemClock;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The one live recording on this phone. The page starts, pauses, resumes and stops
 * it (ScribeNativePlugin); the notification pauses and resumes it (RecordingService);
 * calls and other sound pause it (Interruptions), and it starts again by itself once
 * the call or the sound has ended. Each such pause is kept as a gap, so the transcript
 * and the note can mark the place. It keeps the state, the time recorded and the
 * recording limit, holds a wake lock while sound is recorded or while it waits to
 * start again, and tells the page and the notification about every change. It lives
 * as long as the app's process, so a recording carries on when the page is closed.
 */
final class RecorderHub {

    interface Observer {
        void onState(Snapshot state);

        void onPart(String scribeId, int seq, long durationMs, Gap gapBefore);

        void onLevel(float level);
    }

    static final String IDLE = "idle";
    static final String RECORDING = "recording";
    static final String PAUSED = "paused";
    static final String STOPPING = "stopping";
    static final String STOPPED = "stopped";

    private static final long WAKE_LOCK_SPARE_MS = 60_000;
    // It only keeps the application context, which lives as long as the app anyway.
    @SuppressLint("StaticFieldLeak")
    private static final RecorderHub HUB = new RecorderHub();

    /** A copy of the state at one moment. */
    static final class Snapshot {
        final String phase;
        final String scribeId;
        final String reason;
        final long activeMs;
        final int writingSeq;
        final boolean limitReached;
        /** Paused by a call or other sound, and waiting to start again by itself. */
        final boolean waiting;
        /** The gaps so far: where nothing was recorded, and for how long. */
        final List<Gap> gaps;

        Snapshot(String phase, String scribeId, String reason, long activeMs, int writingSeq, boolean limitReached,
                 boolean waiting, List<Gap> gaps) {
            this.phase = phase;
            this.scribeId = scribeId;
            this.reason = reason;
            this.activeMs = activeMs;
            this.writingSeq = writingSeq;
            this.limitReached = limitReached;
            this.waiting = waiting;
            this.gaps = gaps;
        }

        boolean live() {
            return RECORDING.equals(phase) || PAUSED.equals(phase);
        }
    }

    private final List<Observer> observers = new CopyOnWriteArrayList<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<Gap> gaps = new ArrayList<>();
    private Context app;
    private PartFiles files;
    private AudioPartRecorder recorder;
    private Interruptions interruptions;
    private PowerManager.WakeLock wakeLock;
    private CountDownLatch stopped;
    private String phase = IDLE;
    private String scribeId;
    private String reason = "";
    private long activeMs;
    private long resumedAt;
    private long maxMs;
    private boolean limitReached;
    private boolean waiting;
    // The gap going on now: when it began (elapsed-time clock, 0 for none), the time
    // recorded before it and why. It ends when sound is recorded again.
    private long gapSince;
    private long gapAtMs;
    private String gapReason = "";
    // Tries to start again by itself that found the microphone still busy.
    private int failedTries;

    static RecorderHub get() {
        return HUB;
    }

    synchronized void init(Context context) {
        if (app != null) return;
        app = context.getApplicationContext();
        files = new PartFiles(new File(app.getFilesDir(), "recordings"));
    }

    PartFiles files() {
        return files;
    }

    void addObserver(Observer observer) {
        observers.add(observer);
    }

    void removeObserver(Observer observer) {
        observers.remove(observer);
    }

    /**
     * Starts recording. Returns null, or why it could not start: "busy", "in_call",
     * "mic_denied", "mic_busy", "not_allowed" or "failed".
     */
    String start(String id, int segmentSeconds, long maxSeconds) {
        Snapshot state;
        synchronized (this) {
            if (RECORDING.equals(phase) || PAUSED.equals(phase) || STOPPING.equals(phase)) return "busy";
            Interruptions watch = new Interruptions(app, new Watch(id));
            if (watch.inCall()) return "in_call";
            AudioPartRecorder next = new AudioPartRecorder(app, files, id, segmentSeconds, new EngineListener(id));
            String problem = next.open();
            if (problem != null) return problem;
            try {
                RecordingService.start(app);
            } catch (IllegalStateException | SecurityException e) {
                next.cancel();
                return "not_allowed";
            }
            next.begin();
            recorder = next;
            interruptions = watch;
            scribeId = id;
            phase = RECORDING;
            reason = "";
            activeMs = 0;
            resumedAt = SystemClock.elapsedRealtime();
            maxMs = Math.max(1, maxSeconds) * 1000L;
            limitReached = false;
            clearGaps();
            stopped = new CountDownLatch(1);
            interruptions.begin();
            holdWakeLock(true);
            state = snapshotLocked();
        }
        publish(state);
        return null;
    }

    void pause(String why) {
        Snapshot state;
        synchronized (this) {
            if (!RECORDING.equals(phase)) return;
            settle();
            phase = PAUSED;
            reason = why;
            boolean byItself = PauseRules.resumesByItself(why);
            // A pause soon after starting again, before any sound, continues the same gap.
            if (byItself && gapSince == 0) {
                gapSince = SystemClock.elapsedRealtime();
                gapAtMs = activeMs;
                gapReason = why;
            }
            recorder.pause(byItself);
            waiting = byItself;
            if (byItself) {
                // The phone stays awake to notice the end of the call, even with the screen off.
                interruptions.waitForEnd(gapSince, PauseRules.settleFor(failedTries));
                keepAwakeWhileWaiting();
            } else {
                interruptions.end();
                holdWakeLock(false);
            }
            state = snapshotLocked();
        }
        publish(state);
    }

    /** Resume pressed by the person; returns null, or "in_call" when a call is still going on. */
    String resume() {
        return carryOn(false);
    }

    private String carryOn(boolean byItself) {
        Snapshot state;
        String refusal = null;
        synchronized (this) {
            if (!PAUSED.equals(phase)) return null;
            // The person paused meanwhile, or the waiting already ended.
            if (byItself && !waiting) return null;
            if (interruptions.inCall()) {
                reason = PauseRules.CALL;
                refusal = "in_call";
                // A new call began just as the last one ended: wait for this one too.
                if (byItself) interruptions.waitForEnd(gapSince, PauseRules.settleFor(failedTries));
            } else {
                phase = RECORDING;
                reason = "";
                waiting = false;
                if (byItself) failedTries++;
                resumedAt = SystemClock.elapsedRealtime();
                recorder.resume(gapSince != 0 ? new Gap(gapReason, resumedAt - gapSince, gapAtMs) : null);
                interruptions.begin();
                holdWakeLock(true);
            }
            state = snapshotLocked();
        }
        publish(state);
        return refusal;
    }

    /** It waited as long as it may: the person resumes when ready. */
    private void giveUpWaiting() {
        Snapshot state;
        synchronized (this) {
            if (!PAUSED.equals(phase) || !waiting) return;
            waiting = false;
            interruptions.end();
            holdWakeLock(false);
            state = snapshotLocked();
        }
        publish(state);
    }

    /** Stops and waits until the last part is closed. Never call it on the main thread. */
    Snapshot stop() {
        AudioPartRecorder current;
        CountDownLatch latch;
        synchronized (this) {
            if (recorder == null) return snapshotLocked();
            if (RECORDING.equals(phase)) settle();
            phase = STOPPING;
            waiting = false;
            current = recorder;
            latch = stopped;
            current.stop();
        }
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        Snapshot state;
        synchronized (this) {
            if (recorder == current) {
                recorder = null;
                interruptions.end();
                interruptions = null;
                holdWakeLock(false);
                phase = STOPPED;
                RecordingService.stop(app);
            }
            state = snapshotLocked();
        }
        publish(state);
        return state;
    }

    /** Stops and removes everything recorded. Never call it on the main thread. */
    void discard() {
        Snapshot ended = stop();
        if (ended.scribeId != null) files.deleteAll(ended.scribeId);
        done(ended.scribeId);
    }

    /** The page has stored every part of this recording: forget it. */
    void done(String id) {
        Snapshot state;
        synchronized (this) {
            if (!STOPPED.equals(phase) || id == null || !id.equals(scribeId)) return;
            phase = IDLE;
            scribeId = null;
            reason = "";
            activeMs = 0;
            limitReached = false;
            clearGaps();
            state = snapshotLocked();
        }
        publish(state);
    }

    synchronized Snapshot snapshot() {
        return snapshotLocked();
    }

    private Snapshot snapshotLocked() {
        int writing = recorder != null ? recorder.writingSeq() : 0;
        return new Snapshot(phase, scribeId, reason, activeNow(), writing, limitReached, waiting,
            Collections.unmodifiableList(new ArrayList<>(gaps)));
    }

    private long activeNow() {
        return activeMs + (RECORDING.equals(phase) ? SystemClock.elapsedRealtime() - resumedAt : 0);
    }

    private void settle() {
        activeMs += SystemClock.elapsedRealtime() - resumedAt;
    }

    private void clearGaps() {
        gaps.clear();
        gapSince = 0;
        gapAtMs = 0;
        gapReason = "";
        failedTries = 0;
        waiting = false;
    }

    private void interrupt(String why) {
        String mapped = why;
        synchronized (this) {
            if (PauseRules.SILENCED.equals(why)) {
                mapped = interruptions != null ? PauseRules.forSilenced(interruptions.mode()) : PauseRules.MIC_BUSY;
            }
        }
        pause(mapped);
    }

    private void checkLimit() {
        boolean reached;
        synchronized (this) {
            reached = RECORDING.equals(phase) && !limitReached && activeNow() >= maxMs;
            if (reached) limitReached = true;
        }
        if (reached) worker.execute(this::stop);
    }

    private void publish(Snapshot state) {
        RecordingService.update(app, state);
        for (Observer observer : observers) observer.onState(state);
    }

    /** Keeps the phone working with the screen off, never longer than the recording can last. */
    private void holdWakeLock(boolean on) {
        if (on) {
            acquireWakeLock(Math.max(0, maxMs - activeMs) + WAKE_LOCK_SPARE_MS);
        } else if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    /** While waiting to start again by itself: never longer than the longest wait. */
    private void keepAwakeWhileWaiting() {
        acquireWakeLock(PauseRules.MAX_WAIT_MS + WAKE_LOCK_SPARE_MS);
    }

    private void acquireWakeLock(long timeoutMs) {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "clinicalscribe:recording");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(timeoutMs);
    }

    /** Calls and other sound for one recording; events for an older recording are ignored. */
    private final class Watch implements Interruptions.Callback {
        private final String id;

        Watch(String id) {
            this.id = id;
        }

        private boolean current() {
            synchronized (RecorderHub.this) {
                return id.equals(scribeId);
            }
        }

        @Override
        public void onInterrupted(String why) {
            if (current()) interrupt(why);
        }

        @Override
        public void onOver() {
            if (current()) carryOn(true);
        }

        @Override
        public void onGaveUp() {
            if (current()) giveUpWaiting();
        }
    }

    /** Events from one recorder; events from an older recorder are ignored. */
    private final class EngineListener implements AudioPartRecorder.Listener {
        private final String id;

        EngineListener(String id) {
            this.id = id;
        }

        @Override
        public void onPart(int seq, long durationMs, Gap gapBefore) {
            for (Observer observer : observers) observer.onPart(id, seq, durationMs, gapBefore);
        }

        @Override
        public void onLevel(float level) {
            checkLimit();
            for (Observer observer : observers) observer.onLevel(level);
        }

        @Override
        public void onInterrupted(String why) {
            synchronized (RecorderHub.this) {
                if (!id.equals(scribeId)) return;
            }
            interrupt(why);
        }

        @Override
        public void onGap(int seq, Gap gap) {
            Snapshot state;
            synchronized (RecorderHub.this) {
                if (!id.equals(scribeId)) return;
                gaps.add(gap);
                gapSince = 0;
                failedTries = 0;
                state = snapshotLocked();
            }
            publish(state);
        }

        @Override
        public void onStopped(String failure) {
            CountDownLatch latch;
            boolean unexpected;
            synchronized (RecorderHub.this) {
                if (!id.equals(scribeId)) return;
                latch = stopped;
                unexpected = !STOPPING.equals(phase);
            }
            if (latch != null) latch.countDown();
            // The recorder stopped by itself (it could not write): end the recording
            // so the page can keep what was saved.
            if (unexpected) worker.execute(RecorderHub.this::stop);
        }
    }
}
