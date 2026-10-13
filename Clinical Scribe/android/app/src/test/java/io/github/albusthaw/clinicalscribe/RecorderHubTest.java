package io.github.albusthaw.clinicalscribe;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.app.Application;
import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaFormat;
import android.os.Looper;
import android.os.PowerManager;
import java.io.File;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAudioManager;
import org.robolectric.shadows.ShadowAudioRecord;
import org.robolectric.shadows.ShadowMediaCodec;
import org.robolectric.shadows.ShadowPowerManager;
import org.robolectric.shadows.ShadowSystemClock;

/**
 * The recorder on a stand-in phone (Robolectric). The microphone gives sound about
 * twenty times faster than a real one, a stand-in encoder makes one small frame from
 * each block of sound, and the test plays Android's part for calls, other sound and
 * the call state. Recording must carry on in whole parts until it is stopped; a call
 * or other sound must pause it with the reason, keep what was recorded and start
 * again by itself once the call or the sound has ended, with the gap kept beside the
 * next part; Resume must wait for a call to end; a pause the person made never ends
 * by itself; the limit must stop it by itself; and the phone must be kept awake only
 * while sound is recorded or while the recording waits to start again.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
public class RecorderHubTest {

    private static final String ID = "8d6f7a52-3c3e-4f62-9f0b-2c8e5d1a7b34";
    private static final byte[] FRAME = new byte[64];

    private Application app;
    private AudioManager audio;
    private RecorderHub hub;
    private final AtomicBoolean micBroken = new AtomicBoolean(false);
    private final List<RecorderHub.Snapshot> states = new CopyOnWriteArrayList<>();
    private final List<Integer> parts = new CopyOnWriteArrayList<>();
    private final List<Integer> partGaps = new CopyOnWriteArrayList<>();

    @Before
    public void setUp() {
        app = RuntimeEnvironment.getApplication();
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO);
        audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        ShadowMediaCodec.addEncoder(MediaFormat.MIMETYPE_AUDIO_AAC, new ShadowMediaCodec.CodecConfig(16384, 1024, (in, out) -> {
            if (!in.hasRemaining()) return;
            in.position(in.limit());
            out.put(FRAME);
        }));
        ShadowAudioRecord.setSourceProvider(record -> new ShadowAudioRecord.AudioRecordSource() {
            @Override
            public int readInByteArray(byte[] data, int offset, int size, boolean blocking) {
                rest(2);
                return micBroken.get() ? AudioRecord.ERROR_DEAD_OBJECT : size;
            }
        });
        hub = new RecorderHub();
        hub.init(app);
        hub.addObserver(new RecorderHub.Observer() {
            @Override
            public void onState(RecorderHub.Snapshot state) {
                states.add(state);
            }

            @Override
            public void onPart(String scribeId, int seq, long durationMs, Gap gapBefore) {
                parts.add(seq);
                if (gapBefore != null) partGaps.add(seq);
            }

            @Override
            public void onLevel(float level) {}
        });
    }

    @After
    public void tearDown() {
        hub.stop();
    }

    @Test
    public void recordsWholePartsWithTheScreenOffUntilStopped() {
        assertNull(hub.start(ID, 5, 3600));
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
        assertTrue("the phone keeps working with the screen off", awake());
        Intent service = shadowOf(app).getNextStartedService();
        assertNotNull("the recording runs in the foreground service", service);
        assertEquals(RecordingService.ACTION_START, service.getAction());
        assertEquals("only one recording at a time", "busy", hub.start(ID, 5, 3600));

        waitFor("two whole parts", () -> parts.size() >= 2);
        RecorderHub.Snapshot ended = hub.stop();
        assertEquals(RecorderHub.STOPPED, ended.phase);
        assertFalse("the phone may sleep again", awake());

        List<PartFiles.Part> saved = list();
        assertEquals("every part was reported", parts.size(), saved.size());
        for (int i = 0; i < saved.size(); i++) assertEquals("parts are numbered without gaps", i + 1, saved.get(i).seq);
        int perPart = Adts.framesFor(5, AudioPartRecorder.SAMPLE_RATE);
        assertEquals(perPart, scan(1).frames);
        assertEquals(perPart, scan(2).frames);
        assertEquals("every frame is whole", scan(1).validBytes, part(1).length());
        assertTrue("the last part keeps the sound up to the stop", scan(saved.size()).frames > 0);

        hub.done(ID);
        assertEquals(RecorderHub.IDLE, hub.snapshot().phase);
    }

    @Test
    public void aRingingCallPausesAndRecordingStartsAgainByItselfWhenTheCallEnds() {
        assertNull(hub.start(ID, 600, 3600));
        AudioManager.OnAudioFocusChangeListener focus = focusListener();
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        rest(100);

        audio.setMode(AudioManager.MODE_RINGTONE);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        RecorderHub.Snapshot paused = hub.snapshot();
        assertEquals(RecorderHub.PAUSED, paused.phase);
        assertEquals(PauseRules.CALL, paused.reason);
        assertTrue("it waits to start again by itself", paused.waiting);
        assertTrue("the phone stays awake to notice the end of the call", awake());
        waitFor("the part before the call is closed", () -> parts.contains(1));
        int before = scan(1).frames;
        rest(100);
        assertEquals("nothing is recorded during the call", before, scan(1).frames);
        assertEquals("nothing new is started during the call", 0, hub.snapshot().writingSeq);

        assertEquals("Resume waits for the call to end", "in_call", hub.resume());
        idleFor(Duration.ofSeconds(20));
        assertEquals("the call is still going on", RecorderHub.PAUSED, hub.snapshot().phase);

        audio.setMode(AudioManager.MODE_NORMAL);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN);
        idleFor(Duration.ofSeconds(3));
        RecorderHub.Snapshot again = hub.snapshot();
        assertEquals("it started again by itself", RecorderHub.RECORDING, again.phase);
        assertFalse(again.waiting);
        assertTrue(awake());
        waitFor("sound after the call, in a new part", () -> hub.snapshot().writingSeq == 2 && scan(2).frames > 10);

        RecorderHub.Snapshot marked = hub.snapshot();
        assertEquals("the gap is kept", 1, marked.gaps.size());
        Gap gap = marked.gaps.get(0);
        assertEquals(PauseRules.CALL, gap.reason);
        assertTrue("it lasted as long as the call: " + gap.ms, gap.ms >= 22_000 && gap.ms < 25_000);
        assertTrue("it sits after the sound before the call", gap.atMs >= 0);

        hub.stop();
        List<PartFiles.Part> saved = list();
        assertEquals("the sound before and after the call is kept in two parts", 2, saved.size());
        assertNull(saved.get(0).gap);
        assertNotNull("the part after the call carries the gap", saved.get(1).gap);
        assertEquals(PauseRules.CALL, saved.get(1).gap.reason);
        assertEquals(gap.ms, saved.get(1).gap.ms);
        assertEquals("the page hears of it with the part", Arrays.asList(2), partGaps);
        assertTrue(states.stream().anyMatch(state -> PauseRules.CALL.equals(state.reason) && state.waiting));
    }

    @Test
    public void otherSoundPausesButShortSoundsDoNot() {
        assertNull(hub.start(ID, 600, 3600));
        AudioManager.OnAudioFocusChangeListener focus = focusListener();
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK);
        assertEquals("a notification sound only lowers others", RecorderHub.RECORDING, hub.snapshot().phase);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS);
        assertEquals(RecorderHub.PAUSED, hub.snapshot().phase);
        assertEquals(PauseRules.OTHER_AUDIO, hub.snapshot().reason);
        assertNull("Resume carries on at once", hub.resume());
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
        idleFor(Duration.ofSeconds(5));
        assertEquals("nothing starts twice", RecorderHub.RECORDING, hub.snapshot().phase);
        // Even a pause too short for the recorder to notice ends the part, with the gap.
        waitFor("the part after the gap", () -> hub.snapshot().writingSeq == 2 && hub.snapshot().gaps.size() == 1);
        assertEquals(PauseRules.OTHER_AUDIO, hub.snapshot().gaps.get(0).reason);
    }

    @Test
    public void musicPausesTheRecordingUntilItStops() {
        assertNull(hub.start(ID, 600, 3600));
        AudioManager.OnAudioFocusChangeListener focus = focusListener();
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        shadowOf(audio).setIsMusicActive(true);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS);
        assertEquals(PauseRules.OTHER_AUDIO, hub.snapshot().reason);
        idleFor(Duration.ofSeconds(30));
        assertEquals("it waits while the music plays", RecorderHub.PAUSED, hub.snapshot().phase);
        assertTrue(hub.snapshot().waiting);

        shadowOf(audio).setIsMusicActive(false);
        idleFor(Duration.ofSeconds(3));
        assertEquals("it started again once the music stopped", RecorderHub.RECORDING, hub.snapshot().phase);
        waitFor("the gap", () -> hub.snapshot().gaps.size() == 1);
        assertEquals(PauseRules.OTHER_AUDIO, hub.snapshot().gaps.get(0).reason);
    }

    @Test
    public void voiceCommandsPauseUntilTheyGiveTheSoundBack() {
        assertNull(hub.start(ID, 600, 3600));
        AudioManager.OnAudioFocusChangeListener focus = focusListener();
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        ShadowAudioManager shadow = shadowOf(audio);
        shadow.setActiveRecordingConfigurations(Arrays.asList(shadow.createActiveRecordingConfiguration(0, 1, "voice.commands")), false);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        idleFor(Duration.ofSeconds(20));
        assertEquals("it waits while another app uses the microphone", RecorderHub.PAUSED, hub.snapshot().phase);

        shadow.setActiveRecordingConfigurations(Collections.emptyList(), false);
        idleFor(Duration.ofSeconds(3));
        assertEquals("it waits for the sound to be given back", RecorderHub.PAUSED, hub.snapshot().phase);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN);
        idleFor(Duration.ofSeconds(3));
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
    }

    @Test
    public void aPauseThePersonMadeNeverEndsByItself() {
        assertNull(hub.start(ID, 600, 3600));
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        hub.pause(PauseRules.USER);
        idleFor(Duration.ofMinutes(5));
        RecorderHub.Snapshot paused = hub.snapshot();
        assertEquals(RecorderHub.PAUSED, paused.phase);
        assertFalse(paused.waiting);
        assertFalse("nothing is kept awake while the person paused", awake());
        rest(50);
        int before = scan(1).frames;
        assertNull(hub.resume());
        waitFor("sound in the same part", () -> scan(1).frames > before + 10);
        hub.stop();
        assertEquals("the person's own pause starts no new part", 1, list().size());
        assertTrue("and is no gap", hub.snapshot().gaps.isEmpty());
    }

    @Test
    public void afterAnHourOfWaitingThePersonResumes() {
        assertNull(hub.start(ID, 600, 7200));
        AudioManager.OnAudioFocusChangeListener focus = focusListener();
        audio.setMode(AudioManager.MODE_IN_CALL);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        assertTrue(hub.snapshot().waiting);
        idleFor(Duration.ofMinutes(61));
        RecorderHub.Snapshot paused = hub.snapshot();
        assertEquals(RecorderHub.PAUSED, paused.phase);
        assertFalse("it no longer waits", paused.waiting);
        assertFalse("the phone may sleep again", awake());
        Notification shown = RecordingNotification.build(app, paused);
        assertEquals("Tap Resume when the call has ended", text(shown, Notification.EXTRA_TEXT));
        audio.setMode(AudioManager.MODE_NORMAL);
        idleFor(Duration.ofSeconds(10));
        assertEquals("only the person resumes now", RecorderHub.PAUSED, hub.snapshot().phase);
        assertNull(hub.resume());
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
    }

    @Test
    public void anInternetCallPausesThroughThePhoneState() {
        audio.setMode(AudioManager.MODE_IN_CALL);
        assertEquals("no recording starts during a call", "in_call", hub.start(ID, 600, 3600));
        audio.setMode(AudioManager.MODE_NORMAL);
        assertNull(hub.start(ID, 600, 3600));
        idleMain();
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        idleMain();
        assertEquals(RecorderHub.PAUSED, hub.snapshot().phase);
        assertEquals(PauseRules.CALL, hub.snapshot().reason);
    }

    @Test
    @Config(sdk = 30)
    public void olderPhonesNoticeACallByCheckingEverySecond() {
        assertNull(hub.start(ID, 600, 3600));
        idleMain();
        audio.setMode(AudioManager.MODE_IN_CALL);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));
        assertEquals(RecorderHub.PAUSED, hub.snapshot().phase);
        assertEquals(PauseRules.CALL, hub.snapshot().reason);
    }

    @Test
    @Config(sdk = 30)
    public void olderPhonesAlsoStartAgainWhenTheCallEnds() {
        assertNull(hub.start(ID, 600, 3600));
        idleMain();
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        audio.setMode(AudioManager.MODE_IN_CALL);
        idleFor(Duration.ofSeconds(2));
        assertEquals(PauseRules.CALL, hub.snapshot().reason);
        assertTrue(hub.snapshot().waiting);
        idleFor(Duration.ofSeconds(30));
        assertEquals(RecorderHub.PAUSED, hub.snapshot().phase);
        audio.setMode(AudioManager.MODE_NORMAL);
        idleFor(Duration.ofSeconds(3));
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
        waitFor("the gap", () -> hub.snapshot().gaps.size() == 1);
    }

    @Test
    public void theRecordingLimitStopsItByItself() {
        assertNull(hub.start(ID, 600, 2));
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        ShadowSystemClock.advanceBy(Duration.ofSeconds(3));
        waitFor("the limit", () -> RecorderHub.STOPPED.equals(hub.snapshot().phase));
        assertTrue(hub.snapshot().limitReached);
        assertFalse(awake());
        assertEquals("what was recorded is kept", 1, list().size());
    }

    @Test
    public void aLostMicrophonePausesAndResumeOpensItAgain() {
        assertNull(hub.start(ID, 600, 3600));
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        micBroken.set(true);
        waitFor("a pause", () -> RecorderHub.PAUSED.equals(hub.snapshot().phase));
        assertEquals(PauseRules.MIC_LOST, hub.snapshot().reason);

        micBroken.set(false);
        assertNull(hub.resume());
        waitFor("sound again, after the gap", () -> hub.snapshot().writingSeq == 2 && scan(2).frames > 10);
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
        waitFor("the gap", () -> hub.snapshot().gaps.size() == 1);
        assertEquals(PauseRules.MIC_LOST, hub.snapshot().gaps.get(0).reason);
    }

    @Test
    public void aLostMicrophoneIsTriedAgainByItselfUntilItWorks() {
        assertNull(hub.start(ID, 600, 3600));
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);
        micBroken.set(true);
        waitFor("a pause", () -> RecorderHub.PAUSED.equals(hub.snapshot().phase));
        idleFor(Duration.ofSeconds(3));
        // The first try finds the microphone still broken and pauses again; the gap goes on.
        waitFor("the first try", () -> RecorderHub.PAUSED.equals(hub.snapshot().phase) && hub.snapshot().waiting);
        assertTrue(hub.snapshot().gaps.isEmpty());

        micBroken.set(false);
        idleFor(Duration.ofSeconds(6));
        waitFor("sound again by itself, in the next part", () -> hub.snapshot().writingSeq == 2 && scan(2).frames > 10);
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
        waitFor("one gap", () -> hub.snapshot().gaps.size() == 1);
        assertTrue("one gap from the first pause on: " + hub.snapshot().gaps.get(0).ms, hub.snapshot().gaps.get(0).ms >= 5_000);
    }

    @Test
    public void discardStopsAndRemovesEverythingRecorded() {
        assertNull(hub.start(ID, 5, 3600));
        waitFor("a whole part", () -> !parts.isEmpty());
        hub.discard();
        assertEquals(RecorderHub.IDLE, hub.snapshot().phase);
        assertFalse(new File(app.getFilesDir(), "recordings/" + ID).exists());
        assertFalse(awake());
    }

    @Test
    public void theNotificationSaysWhyTheRecordingPaused() {
        Notification call = RecordingNotification.build(app, snapshot(RecorderHub.PAUSED, PauseRules.CALL, 245_000, true));
        assertEquals("Paused for a call · 4:05", text(call, Notification.EXTRA_TITLE));
        assertEquals("Starts again by itself when the call ends", text(call, Notification.EXTRA_TEXT));
        assertEquals("Resume", call.actions[0].title.toString());

        Notification other = RecordingNotification.build(app, snapshot(RecorderHub.PAUSED, PauseRules.OTHER_AUDIO, 5_000, true));
        assertEquals("Paused · 0:05", text(other, Notification.EXTRA_TITLE));
        assertEquals("Another app played sound. Starts again by itself when it stops", text(other, Notification.EXTRA_TEXT));

        Notification mic = RecordingNotification.build(app, snapshot(RecorderHub.PAUSED, PauseRules.MIC_BUSY, 5_000, true));
        assertEquals("The microphone is in use. Starts again by itself when it is free", text(mic, Notification.EXTRA_TEXT));

        Notification gaveUp = RecordingNotification.build(app, snapshot(RecorderHub.PAUSED, PauseRules.CALL, 5_000, false));
        assertEquals("Tap Resume when the call has ended", text(gaveUp, Notification.EXTRA_TEXT));
        Notification own = RecordingNotification.build(app, snapshot(RecorderHub.PAUSED, PauseRules.USER, 5_000, false));
        assertEquals("Tap Resume to carry on", text(own, Notification.EXTRA_TEXT));

        Notification live = RecordingNotification.build(app, snapshot(RecorderHub.RECORDING, "", 61_000, false));
        assertEquals("Pause", live.actions[0].title.toString());
        assertTrue("the time counts up by itself", live.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER));
    }

    @Test
    public void theServiceAlwaysShowsItsNotificationAndStopsWhenNothingIsRecorded() {
        Intent start = new Intent(app, RecordingService.class).setAction(RecordingService.ACTION_START);
        ServiceController<RecordingService> service = Robolectric.buildService(RecordingService.class, start).create().startCommand(0, 1);
        assertNotNull("Android requires the notification first", shadowOf(service.get()).getLastForegroundNotification());
        assertTrue(shadowOf(service.get()).isStoppedBySelf());
        service.destroy();
    }

    private static RecorderHub.Snapshot snapshot(String phase, String reason, long activeMs, boolean waiting) {
        return new RecorderHub.Snapshot(phase, ID, reason, activeMs, 0, false, waiting, Collections.emptyList());
    }

    private AudioManager.OnAudioFocusChangeListener focusListener() {
        idleMain(); // the recorder asks for the audio focus on the main thread
        ShadowAudioManager.AudioFocusRequest request = shadowOf(audio).getLastAudioFocusRequest();
        assertNotNull("the recorder holds the audio focus", request);
        return request.listener;
    }

    private boolean awake() {
        PowerManager.WakeLock lock = ShadowPowerManager.getLatestWakeLock();
        return lock != null && lock.isHeld();
    }

    private List<PartFiles.Part> list() {
        try {
            return hub.files().list(ID, 0);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private File part(int seq) {
        return new File(app.getFilesDir(), String.format(Locale.ROOT, "recordings/%s/%04d.aac", ID, seq));
    }

    private Adts.Scan scan(int seq) {
        try {
            return Adts.scan(part(seq));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String text(Notification notification, String key) {
        CharSequence value = notification.extras.getCharSequence(key);
        return value == null ? null : value.toString();
    }

    private static void idleMain() {
        shadowOf(Looper.getMainLooper()).idle();
    }

    // Lets time pass on the phone's clock and runs what the main thread had planned.
    private static void idleFor(Duration time) {
        shadowOf(Looper.getMainLooper()).idleFor(time);
    }

    private static void rest(long milliseconds) {
        try {
            Thread.sleep(milliseconds);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void waitFor(String what, BooleanSupplier done) {
        long end = System.nanoTime() + 10_000_000_000L;
        while (!done.getAsBoolean()) {
            if (System.nanoTime() - end > 0) throw new AssertionError("Waited too long for " + what);
            rest(5);
        }
    }
}
