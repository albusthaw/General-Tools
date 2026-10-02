package io.github.albusthaw.clinicalscribe;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The recorded parts kept in the app's private storage until the page has stored
 * them in its upload queue: recordings/<recording id>/0001.aac, 0002.aac, ...
 */
final class PartFiles {

    static final int MAX_SEQ = 9999;
    private static final Pattern SCRIBE = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Pattern NAME = Pattern.compile("(\\d{4})\\.aac");

    private final File root;

    PartFiles(File root) {
        this.root = root;
    }

    static boolean isScribeId(String value) {
        return value != null && SCRIBE.matcher(value).matches();
    }

    static boolean isSeq(int seq) {
        return seq >= 1 && seq <= MAX_SEQ;
    }

    File folder(String scribeId) {
        if (!isScribeId(scribeId)) throw new IllegalArgumentException("Not a recording id");
        return new File(root, scribeId);
    }

    File part(String scribeId, int seq) {
        if (!isSeq(seq)) throw new IllegalArgumentException("Part number out of range");
        File folder = folder(scribeId);
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IllegalStateException("Cannot make the recording folder");
        return new File(folder, String.format(Locale.ROOT, "%04d.aac", seq));
    }

    /** One part waiting to be stored by the page. */
    static final class Part {
        final int seq;
        final long bytes;
        final long durationMs;

        Part(int seq, long bytes, long durationMs) {
            this.seq = seq;
            this.bytes = bytes;
            this.durationMs = durationMs;
        }
    }

    /** The parts of a recording in order, without the one still being written (skipSeq). */
    List<Part> list(String scribeId, int skipSeq) throws IOException {
        File folder = folder(scribeId);
        List<Part> parts = new ArrayList<>();
        File[] files = folder.listFiles();
        if (files == null) return parts;
        for (File file : files) {
            Matcher match = NAME.matcher(file.getName());
            if (!match.matches()) continue;
            int seq = Integer.parseInt(match.group(1));
            if (seq == skipSeq || !isSeq(seq)) continue;
            Adts.Scan scan = Adts.scan(file);
            if (scan.frames == 0) continue;
            parts.add(new Part(seq, scan.validBytes, scan.durationMs()));
        }
        Collections.sort(parts, (a, b) -> Integer.compare(a.seq, b.seq));
        return parts;
    }

    /** Up to length bytes of a part from offset, never past its last whole frame. */
    byte[] read(String scribeId, int seq, long offset, int length) throws IOException {
        File file = part(scribeId, seq);
        if (!file.isFile()) throw new IOException("No such part");
        long valid = Adts.scan(file).validBytes;
        if (offset < 0 || offset > valid || length < 0) throw new IOException("Out of range");
        int count = (int) Math.min(length, valid - offset);
        byte[] data = new byte[count];
        try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
            in.seek(offset);
            in.readFully(data);
        }
        return data;
    }

    void delete(String scribeId, int seq) {
        File file = new File(folder(scribeId), String.format(Locale.ROOT, "%04d.aac", seq));
        if (isSeq(seq) && file.isFile()) file.delete();
        removeIfEmpty(scribeId);
    }

    void deleteAll(String scribeId) {
        File folder = folder(scribeId);
        File[] files = folder.listFiles();
        if (files != null) {
            for (File file : files) file.delete();
        }
        folder.delete();
    }

    /** Recordings that still have parts on this phone. */
    List<String> recordings() {
        List<String> ids = new ArrayList<>();
        File[] folders = root.listFiles();
        if (folders == null) return ids;
        for (File folder : folders) {
            if (folder.isDirectory() && isScribeId(folder.getName())) ids.add(folder.getName());
        }
        Collections.sort(ids);
        return ids;
    }

    private void removeIfEmpty(String scribeId) {
        File folder = folder(scribeId);
        String[] left = folder.list();
        if (left != null && left.length == 0) folder.delete();
    }
}
