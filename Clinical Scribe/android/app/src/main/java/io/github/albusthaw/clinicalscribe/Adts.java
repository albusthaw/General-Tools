package io.github.albusthaw.clinicalscribe;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * AAC audio stored as ADTS frames. Every frame carries its own 7-byte header, so a
 * part can be played up to its last whole frame even if the app stopped while it
 * was being written, and parts follow each other without a gap.
 */
final class Adts {

    static final int HEADER = 7;
    static final int SAMPLES_PER_FRAME = 1024;
    private static final int[] RATES = { 96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350 };

    private Adts() {}

    static int rateIndex(int sampleRate) {
        for (int i = 0; i < RATES.length; i++) {
            if (RATES[i] == sampleRate) return i;
        }
        throw new IllegalArgumentException("No ADTS index for " + sampleRate + " Hz");
    }

    /** The header of one AAC-LC frame whose encoded audio is payloadLength bytes. */
    static byte[] header(int payloadLength, int sampleRate, int channels) {
        int frameLength = payloadLength + HEADER;
        if (payloadLength <= 0 || frameLength > 0x1FFF) throw new IllegalArgumentException("Frame length out of range");
        int profile = 1; // AAC LC (object type 2), stored minus one
        int rate = rateIndex(sampleRate);
        byte[] header = new byte[HEADER];
        header[0] = (byte) 0xFF;
        header[1] = (byte) 0xF1; // MPEG-4, no checksum
        header[2] = (byte) ((profile << 6) | (rate << 2) | ((channels >> 2) & 1));
        header[3] = (byte) (((channels & 3) << 6) | (frameLength >> 11));
        header[4] = (byte) ((frameLength >> 3) & 0xFF);
        header[5] = (byte) (((frameLength & 7) << 5) | 0x1F);
        header[6] = (byte) 0xFC;
        return header;
    }

    /** Frames needed for this many seconds of sound. */
    static int framesFor(int seconds, int sampleRate) {
        return (int) Math.ceil(seconds * (double) sampleRate / SAMPLES_PER_FRAME);
    }

    static long durationMs(long frames, int sampleRate) {
        return frames * SAMPLES_PER_FRAME * 1000L / sampleRate;
    }

    /** Whole frames found at the start of some data. */
    static final class Scan {
        final int frames;
        final long validBytes;
        final int sampleRate;

        Scan(int frames, long validBytes, int sampleRate) {
            this.frames = frames;
            this.validBytes = validBytes;
            this.sampleRate = sampleRate;
        }

        long durationMs() {
            return sampleRate > 0 ? Adts.durationMs(frames, sampleRate) : 0;
        }
    }

    /** Counts whole frames, stopping at the first broken or cut-off one. */
    static Scan scan(File file) throws IOException {
        try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
            long length = in.length();
            long position = 0;
            int frames = 0;
            int sampleRate = 0;
            byte[] header = new byte[HEADER];
            while (position + HEADER <= length) {
                in.seek(position);
                in.readFully(header);
                if ((header[0] & 0xFF) != 0xFF || (header[1] & 0xF0) != 0xF0) break;
                int rateIndex = (header[2] >> 2) & 0x0F;
                if (rateIndex >= RATES.length) break;
                int headerLength = (header[1] & 0x01) == 1 ? HEADER : HEADER + 2;
                int frameLength = ((header[3] & 0x03) << 11) | ((header[4] & 0xFF) << 3) | ((header[5] & 0xE0) >> 5);
                if (frameLength <= headerLength || position + frameLength > length) break;
                int blocks = (header[6] & 0x03) + 1;
                sampleRate = RATES[rateIndex];
                frames += blocks;
                position += frameLength;
            }
            return new Scan(frames, position, sampleRate);
        }
    }
}
