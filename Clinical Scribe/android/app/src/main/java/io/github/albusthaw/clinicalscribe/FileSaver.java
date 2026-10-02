package io.github.albusthaw.clinicalscribe;

import android.content.ContentResolver;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Writes a file the person asked to save to the place they picked in Android's
 * "Save to…" screen. The page sends the file in parts so that large recordings
 * never need to sit in memory at once. Only one file is written at a time, and a
 * file that does not finish is removed again.
 */
final class FileSaver {

    /** The longest part the page may send in one go (base64 characters). */
    static final int MAX_PART = 1024 * 1024;
    private static final long MAX_FILE = 512L * 1024 * 1024;
    private static final int MAX_NAME = 150;
    private static final Pattern TYPE = Pattern.compile("[a-z]{1,30}/[a-z0-9][a-z0-9.+-]{0,99}");

    private final ContentResolver resolver;
    private OpenFile current;

    private static final class OpenFile {
        final String token;
        final Uri place;
        final OutputStream out;
        long written;

        OpenFile(String token, Uri place, OutputStream out) {
            this.token = token;
            this.place = place;
            this.out = out;
        }
    }

    FileSaver(ContentResolver resolver) {
        this.resolver = resolver;
    }

    /** A suggested file name: plain text without folders or hidden characters. */
    static boolean isNameAccepted(String name) {
        if (name == null || name.trim().isEmpty() || name.length() > MAX_NAME) return false;
        if (name.startsWith(".")) return false;
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == '/' || c == '\\' || c == ':' || Character.isISOControl(c)) return false;
            if (Character.getType(c) == Character.FORMAT) return false;
        }
        return true;
    }

    /** A plain file type such as text/csv or audio/webm, without extra settings. */
    static boolean isTypeAccepted(String type) {
        return type != null && TYPE.matcher(type).matches();
    }

    synchronized String open(Uri place) throws IOException {
        discardCurrent();
        OutputStream out = resolver.openOutputStream(place, "wt");
        if (out == null) throw new IOException("No place to write");
        current = new OpenFile(UUID.randomUUID().toString(), place, out);
        return current.token;
    }

    synchronized void write(String token, String part) throws IOException {
        OpenFile file = fileFor(token);
        if (part == null || part.length() > MAX_PART) throw new IllegalArgumentException("Part not accepted");
        byte[] bytes = Base64.decode(part, Base64.DEFAULT);
        if (file.written + bytes.length > MAX_FILE) throw new IOException("File too large");
        file.out.write(bytes);
        file.written += bytes.length;
    }

    synchronized void finish(String token) throws IOException {
        OpenFile file = fileFor(token);
        current = null;
        try {
            file.out.close();
        } catch (IOException e) {
            remove(file.place);
            throw e;
        }
    }

    synchronized void cancel(String token) {
        if (current != null && current.token.equals(token)) discardCurrent();
    }

    synchronized void cancelAll() {
        discardCurrent();
    }

    private OpenFile fileFor(String token) throws IOException {
        if (current == null || token == null || !current.token.equals(token)) throw new IOException("No file is open");
        return current;
    }

    private void discardCurrent() {
        if (current == null) return;
        OpenFile file = current;
        current = null;
        try {
            file.out.close();
        } catch (IOException ignored) {
            // The file is removed below.
        }
        remove(file.place);
    }

    private void remove(Uri place) {
        try {
            DocumentsContract.deleteDocument(resolver, place);
        } catch (Exception ignored) {
            // Some places do not allow removing files; the half-written file stays.
        }
    }
}
