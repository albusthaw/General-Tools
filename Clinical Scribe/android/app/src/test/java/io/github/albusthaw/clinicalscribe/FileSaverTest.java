package io.github.albusthaw.clinicalscribe;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FileSaverTest {

    @Test
    public void acceptsPlainFileNames() {
        assertTrue(FileSaver.isNameAccepted("Audit log 2026-10-02.csv"));
        assertTrue(FileSaver.isNameAccepted("Recording – Clinic (1).webm"));
    }

    @Test
    public void refusesNamesWithFoldersOrHiddenCharacters() {
        assertFalse(FileSaver.isNameAccepted(null));
        assertFalse(FileSaver.isNameAccepted("   "));
        assertFalse(FileSaver.isNameAccepted("../notes.csv"));
        assertFalse(FileSaver.isNameAccepted("folder/notes.csv"));
        assertFalse(FileSaver.isNameAccepted("folder\\notes.csv"));
        assertFalse(FileSaver.isNameAccepted(".hidden"));
        assertFalse(FileSaver.isNameAccepted("notes\n.csv"));
        assertFalse(FileSaver.isNameAccepted("notes‮vsc.exe"));
        assertFalse(FileSaver.isNameAccepted("a".repeat(151)));
    }

    @Test
    public void acceptsPlainFileTypes() {
        assertTrue(FileSaver.isTypeAccepted("text/csv"));
        assertTrue(FileSaver.isTypeAccepted("audio/webm"));
        assertTrue(FileSaver.isTypeAccepted("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
        assertTrue(FileSaver.isTypeAccepted("application/octet-stream"));
    }

    @Test
    public void refusesOtherFileTypes() {
        assertFalse(FileSaver.isTypeAccepted(null));
        assertFalse(FileSaver.isTypeAccepted(""));
        assertFalse(FileSaver.isTypeAccepted("text/csv;charset=utf-8"));
        assertFalse(FileSaver.isTypeAccepted("Text/CSV"));
        assertFalse(FileSaver.isTypeAccepted("text"));
        assertFalse(FileSaver.isTypeAccepted("text/"));
    }
}
