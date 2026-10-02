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
