package io.github.albusthaw.clinicalscribe;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.Test;

public class AdtsTest {

    /** A fake stream of frames: each payload is filled with one value. */
    static byte[] frames(int count, int payload) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int i = 0; i < count; i++) {
            out.write(Adts.header(payload, 44100, 1));
            byte[] data = new byte[payload];
            java.util.Arrays.fill(data, (byte) i);
            out.write(data);
        }
        return out.toByteArray();
    }

    static File write(byte[] data) throws IOException {
        File file = Files.createTempFile("part", ".aac").toFile();
        file.deleteOnExit();
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(data);
        }
        return file;
    }

    @Test
    public void writesTheStandardHeaderForAacLcMono() {
        // 371 bytes of audio + 7 = 378 = 0x17A.
        byte[] expected = { (byte) 0xFF, (byte) 0xF1, (byte) 0x50, (byte) 0x40, (byte) 0x2F, (byte) 0x5F, (byte) 0xFC };
        assertArrayEquals(expected, Adts.header(371, 44100, 1));
        assertEquals(4, Adts.rateIndex(44100));
        assertEquals(3, Adts.rateIndex(48000));
        assertEquals(8, Adts.rateIndex(16000));
    }

    @Test
    public void refusesImpossibleFrames() {
        assertThrows(IllegalArgumentException.class, () -> Adts.header(0, 44100, 1));
        assertThrows(IllegalArgumentException.class, () -> Adts.header(9000, 44100, 1));
        assertThrows(IllegalArgumentException.class, () -> Adts.rateIndex(44000));
    }

    @Test
    public void countsWholeFramesAndTheirLength() throws IOException {
        File file = write(frames(43, 120));
        Adts.Scan scan = Adts.scan(file);
        assertEquals(43, scan.frames);
        assertEquals(43 * 127, scan.validBytes);
        assertEquals(44100, scan.sampleRate);
        assertEquals(43 * 1024 * 1000L / 44100, scan.durationMs());
    }

    @Test
    public void stopsAtAFrameThatWasCutOff() throws IOException {
        byte[] whole = frames(10, 200);
        byte[] cut = java.util.Arrays.copyOf(whole, whole.length - 50);
        Adts.Scan scan = Adts.scan(write(cut));
        assertEquals(9, scan.frames);
        assertEquals(9 * 207, scan.validBytes);
    }

    @Test
    public void stopsAtDataThatIsNotAFrame() throws IOException {
        byte[] whole = frames(5, 100);
        byte[] broken = java.util.Arrays.copyOf(whole, whole.length + 20);
        Adts.Scan scan = Adts.scan(write(broken));
        assertEquals(5, scan.frames);
        assertEquals(0, Adts.scan(write(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 })).frames);
        assertEquals(0, Adts.scan(write(new byte[0])).frames);
    }

    @Test
    public void plansPartsByFrames() {
        assertEquals(25840, Adts.framesFor(600, 44100));
        assertEquals(216, Adts.framesFor(5, 44100));
        assertEquals(600_000, Adts.durationMs(Adts.framesFor(600, 44100), 44100), 30);
    }
}
