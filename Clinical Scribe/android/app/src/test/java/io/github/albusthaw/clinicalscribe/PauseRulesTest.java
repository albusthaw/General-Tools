package io.github.albusthaw.clinicalscribe;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.media.AudioManager;
import org.junit.Test;

public class PauseRulesTest {

    @Test
    public void knowsTheCallStates() {
        assertFalse(PauseRules.isCallMode(AudioManager.MODE_NORMAL));
        assertTrue(PauseRules.isCallMode(AudioManager.MODE_RINGTONE));
        assertTrue(PauseRules.isCallMode(AudioManager.MODE_IN_CALL));
        assertTrue(PauseRules.isCallMode(AudioManager.MODE_IN_COMMUNICATION));
        assertTrue(PauseRules.isCallMode(AudioManager.MODE_CALL_SCREENING));
        assertFalse(PauseRules.isCallMode(AudioManager.MODE_INVALID));
        assertFalse(PauseRules.isCallMode(AudioManager.MODE_CURRENT));
    }

    @Test
    public void losingTheAudioFocusPausesWithTheRightReason() {
        assertEquals(PauseRules.CALL, PauseRules.forFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.MODE_RINGTONE));
        assertEquals(PauseRules.OTHER_AUDIO, PauseRules.forFocusChange(AudioManager.AUDIOFOCUS_LOSS, AudioManager.MODE_NORMAL));
        assertEquals(PauseRules.OTHER_AUDIO, PauseRules.forFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.MODE_NORMAL));
    }

    @Test
    public void shortSoundsAndRegainingFocusDoNotPause() {
        assertNull(PauseRules.forFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, AudioManager.MODE_NORMAL));
        assertNull(PauseRules.forFocusChange(AudioManager.AUDIOFOCUS_GAIN, AudioManager.MODE_NORMAL));
    }

    @Test
    public void aSilencedMicrophoneMeansACallOrABusyMicrophone() {
        assertEquals(PauseRules.CALL, PauseRules.forSilenced(AudioManager.MODE_IN_CALL));
        assertEquals(PauseRules.MIC_BUSY, PauseRules.forSilenced(AudioManager.MODE_NORMAL));
    }

    @Test
    public void onlyPausesAndroidMadeEndByThemselves() {
        assertTrue(PauseRules.resumesByItself(PauseRules.CALL));
        assertTrue(PauseRules.resumesByItself(PauseRules.OTHER_AUDIO));
        assertTrue(PauseRules.resumesByItself(PauseRules.MIC_LOST));
        assertTrue(PauseRules.resumesByItself(PauseRules.MIC_BUSY));
        assertFalse("the person's own pause stays", PauseRules.resumesByItself(PauseRules.USER));
        assertFalse(PauseRules.resumesByItself(PauseRules.NOTIFICATION));
        assertFalse(PauseRules.resumesByItself(""));
        assertFalse(PauseRules.resumesByItself(null));
    }

    @Test
    public void startsAgainOnlyAfterSomeQuiet() {
        long settle = PauseRules.SETTLE_MS;
        assertEquals("a call or other sound is still going on", PauseRules.WAIT, PauseRules.nextStep(true, false, 0, 60_000, settle));
        assertEquals("quiet, but not for long enough", PauseRules.WAIT, PauseRules.nextStep(false, false, 1_000, 60_000, settle));
        assertEquals(PauseRules.RESUME, PauseRules.nextStep(false, false, 2_000, 60_000, settle));
        assertEquals("another app will give the sound back", PauseRules.WAIT, PauseRules.nextStep(false, true, 5_000, 60_000, settle));
        assertEquals("it never did, but all is quiet", PauseRules.RESUME, PauseRules.nextStep(false, true, PauseRules.LONG_QUIET_MS, 60_000, settle));
        assertEquals("waited an hour", PauseRules.GIVE_UP, PauseRules.nextStep(true, false, 0, PauseRules.MAX_WAIT_MS, settle));
    }

    @Test
    public void waitsLongerAfterEachTryThatFoundTheMicrophoneBusy() {
        assertEquals(2_000, PauseRules.settleFor(0));
        assertEquals(4_000, PauseRules.settleFor(1));
        assertEquals(8_000, PauseRules.settleFor(2));
        assertEquals(30_000, PauseRules.settleFor(4));
        assertEquals(30_000, PauseRules.settleFor(40));
    }

    @Test
    public void picksTheNotificationMessage() {
        assertEquals("call", PauseRules.messageKind(PauseRules.CALL));
        assertEquals("other", PauseRules.messageKind(PauseRules.OTHER_AUDIO));
        assertEquals("mic", PauseRules.messageKind(PauseRules.MIC_LOST));
        assertEquals("mic", PauseRules.messageKind(PauseRules.MIC_BUSY));
        assertEquals("plain", PauseRules.messageKind(PauseRules.USER));
        assertEquals("plain", PauseRules.messageKind(PauseRules.NOTIFICATION));
        assertEquals("plain", PauseRules.messageKind(""));
    }
}
