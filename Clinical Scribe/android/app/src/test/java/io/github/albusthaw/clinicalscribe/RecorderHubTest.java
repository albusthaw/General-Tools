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
 * or other sound must pause it with the reason and keep what was recorded; Resume
 * must wait for a call to end; the limit must stop it by itself; and the phone must
 * be kept awake only while sound is recorded.
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
            public void onPart(String scribeId, int seq, long durationMs) {
                parts.add(seq);
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
    public void aRingingCallPausesAndResumeWaitsUntilTheCallHasEnded() {
        assertNull(hub.start(ID, 600, 3600));
        AudioManager.OnAudioFocusChangeListener focus = focusListener();
        waitFor("sound", () -> hub.snapshot().writingSeq == 1);

        audio.setMode(AudioManager.MODE_RINGTONE);
        focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
        RecorderHub.Snapshot paused = hub.snapshot();
        assertEquals(RecorderHub.PAUSED, paused.phase);
        assertEquals(PauseRules.CALL, paused.reason);
        assertFalse("nothing is kept awake while paused", awake());
        idleMain();
        assertNotNull("other apps may use the sound again", shadowOf(audio).getLastAbandonedAudioFocusRequest());
        rest(50); // the block of sound read just before the pause is still written
        int before = scan(1).frames;
        rest(100);
        assertEquals("nothing is recorded during the call", before, scan(1).frames);

        assertEquals("in_call", hub.resume());
        assertEquals(RecorderHub.PAUSED, hub.snapshot().phase);

        audio.setMode(AudioManager.MODE_NORMAL);
        idleMain();
        assertNull(hub.resume());
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
        assertTrue(awake());
        waitFor("sound after the call", () -> scan(1).frames > before + 10);

        hub.stop();
        List<PartFiles.Part> saved = list();
        assertEquals("the sound before and after the call is kept in one part", 1, saved.size());
        assertTrue(states.stream().anyMatch(state -> PauseRules.CALL.equals(state.reason)));
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
        int before = scan(1).frames;
        assertNull(hub.resume());
        waitFor("sound again", () -> scan(1).frames > before + 10);
        assertEquals(RecorderHub.RECORDING, hub.snapshot().phase);
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
        Notification call = RecordingNotification.build(app, new RecorderHub.Snapshot(RecorderHub.PAUSED, ID, PauseRules.CALL, 245_000, 0, false));
        assertEquals("Paused for a call · 4:05", text(call, Notification.EXTRA_TITLE));
        assertEquals("Tap Resume when the call has ended", text(call, Notification.EXTRA_TEXT));
        assertEquals("Resume", call.actions[0].title.toString());

        Notification other = RecordingNotification.build(app, new RecorderHub.Snapshot(RecorderHub.PAUSED, ID, PauseRules.OTHER_AUDIO, 5_000, 0, false));
        assertEquals("Paused · 0:05", text(other, Notification.EXTRA_TITLE));
        assertEquals("Another app played sound. Tap Resume to carry on", text(other, Notification.EXTRA_TEXT));

        Notification live = RecordingNotification.build(app, new RecorderHub.Snapshot(RecorderHub.RECORDING, ID, "", 61_000, 1, false));
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
