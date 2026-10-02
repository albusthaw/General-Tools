package io.github.albusthaw.clinicalscribe;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

public class PartFilesTest {

    private static final String ID = "11111111-2222-4333-8444-555555555555";
    private PartFiles files;

    @Before
    public void setUp() throws IOException {
        files = new PartFiles(Files.createTempDirectory("recordings").toFile());
    }

    private void writePart(int seq, byte[] data) throws IOException {
        try (FileOutputStream out = new FileOutputStream(files.part(ID, seq))) {
            out.write(data);
        }
    }

    @Test
    public void namesPartsWithFourDigits() {
        assertEquals("0001.aac", files.part(ID, 1).getName());
        assertEquals("0123.aac", files.part(ID, 123).getName());
        assertThrows(IllegalArgumentException.class, () -> files.part(ID, 0));
        assertThrows(IllegalArgumentException.class, () -> files.part(ID, 10000));
        assertThrows(IllegalArgumentException.class, () -> files.part("../../etc", 1));
        assertThrows(IllegalArgumentException.class, () -> files.folder("11111111-2222-4333-8444-55555555555X"));
        assertTrue(PartFiles.isScribeId(ID));
        assertFalse(PartFiles.isScribeId(null));
    }

    @Test
    public void listsPartsInOrderWithoutThePartBeingWritten() throws IOException {
        writePart(2, AdtsTest.frames(20, 100));
        writePart(1, AdtsTest.frames(10, 100));
        writePart(3, AdtsTest.frames(5, 100));
        writePart(4, new byte[0]);
        File stray = new File(files.folder(ID), "notes.txt");
        assertTrue(stray.createNewFile());
        List<PartFiles.Part> parts = files.list(ID, 3);
        assertEquals(2, parts.size());
        assertEquals(1, parts.get(0).seq);
        assertEquals(10 * 107, parts.get(0).bytes);
        assertEquals(2, parts.get(1).seq);
        assertEquals(20 * 1024 * 1000L / 44100, parts.get(1).durationMs);
        assertEquals(3, files.list(ID, 0).size());
    }

    @Test
    public void readsPiecesButNeverPastTheLastWholeFrame() throws IOException {
        byte[] whole = AdtsTest.frames(4, 50);
        byte[] cut = Arrays.copyOf(whole, whole.length - 10);
        writePart(1, cut);
        byte[] first = files.read(ID, 1, 0, 100);
        assertArrayEquals(Arrays.copyOfRange(cut, 0, 100), first);
        byte[] rest = files.read(ID, 1, 100, 10_000);
        assertEquals(3 * 57 - 100, rest.length);
        assertThrows(IOException.class, () -> files.read(ID, 1, 10_000, 10));
        assertThrows(IOException.class, () -> files.read(ID, 9, 0, 10));
    }

    @Test
    public void removesPartsAndEmptyRecordings() throws IOException {
        writePart(1, AdtsTest.frames(3, 40));
        writePart(2, AdtsTest.frames(3, 40));
        assertEquals(Arrays.asList(ID), files.recordings());
        files.delete(ID, 1);
        assertEquals(1, files.list(ID, 0).size());
        files.delete(ID, 2);
        assertFalse(files.folder(ID).exists());
        writePart(5, AdtsTest.frames(3, 40));
        files.deleteAll(ID);
        assertTrue(files.recordings().isEmpty());
    }
}
