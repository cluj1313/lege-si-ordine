package ro.legesiordine.app.voice;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import java.io.FileInputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Decodează un fișier audio (AAC/ADTS, WebM-Opus, M4A, OGG, WAV, MP3 …) în PCM 16-bit mono 16 kHz, pe bucăți,
 * pentru transcrierea ulterioară (PcmInjector). Totul local, pe telefon.
 */
final class AudioDecoder {
    interface Out { boolean pcm(byte[] b, int len); } // false = oprește
    interface Progress { void p(double frac); }

    static void decode(String path, Out out, Progress prog) throws Exception {
        if (path.endsWith(".wav") && wavDirect(path, out, prog)) return;
        MediaExtractor ex = new MediaExtractor();
        MediaCodec dec = null;
        try {
            ex.setDataSource(path);
            int track = -1; MediaFormat fmt = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String m = f.getString(MediaFormat.KEY_MIME);
                if (m != null && m.startsWith("audio/")) { track = i; fmt = f; break; }
            }
            if (track < 0) throw new Exception("notrack");
            ex.selectTrack(track);
            long durUs = fmt.containsKey(MediaFormat.KEY_DURATION) ? fmt.getLong(MediaFormat.KEY_DURATION) : 0;
            dec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
            dec.configure(fmt, null, null, 0);
            dec.start();
            int srcRate = fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 16000;
            int ch = fmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 1;
            boolean isFloat = false;
            Resampler rs = new Resampler(srcRate);
            MediaCodec.BufferInfo bi = new MediaCodec.BufferInfo();
            boolean inEos = false, outEos = false;
            long lastUs = 0;
            while (!outEos) {
                if (!inEos) {
                    int ii = dec.dequeueInputBuffer(10000);
                    if (ii >= 0) {
                        ByteBuffer ib = dec.getInputBuffer(ii);
                        int n = ex.readSampleData(ib, 0);
                        if (n < 0) { dec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inEos = true; }
                        else { lastUs = ex.getSampleTime(); dec.queueInputBuffer(ii, 0, n, Math.max(0, lastUs), 0); ex.advance(); }
                    }
                }
                int oi = dec.dequeueOutputBuffer(bi, 10000);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = dec.getOutputFormat();
                    if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) { srcRate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE); rs = new Resampler(srcRate); }
                    if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) ch = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) isFloat = of.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT;
                    continue;
                }
                if (oi < 0) continue;
                ByteBuffer ob = dec.getOutputBuffer(oi);
                if (bi.size > 0 && ob != null) {
                    ob.position(bi.offset); ob.limit(bi.offset + bi.size);
                    ob.order(ByteOrder.LITTLE_ENDIAN);
                    int frames = bi.size / ((isFloat ? 4 : 2) * Math.max(1, ch));
                    short[] mono = new short[frames];
                    for (int f = 0; f < frames; f++) {
                        int acc = 0;
                        for (int c = 0; c < ch; c++) {
                            if (isFloat) acc += (int) Math.max(-32768, Math.min(32767, ob.getFloat() * 32767f));
                            else acc += ob.getShort();
                        }
                        mono[f] = (short) (acc / Math.max(1, ch));
                    }
                    byte[] pcm = rs.run(mono);
                    if (pcm.length > 0 && !out.pcm(pcm, pcm.length)) { dec.releaseOutputBuffer(oi, false); return; }
                    if (durUs > 0 && prog != null) prog.p(Math.min(1, bi.presentationTimeUs / (double) durUs));
                }
                dec.releaseOutputBuffer(oi, false);
                if ((bi.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outEos = true;
            }
        } finally {
            if (dec != null) { try { dec.stop(); } catch (Exception ignored) {} try { dec.release(); } catch (Exception ignored) {} }
            try { ex.release(); } catch (Exception ignored) {}
        }
    }

    /** WAV PCM 16-bit mono 16 kHz (fișierele noastre de rezervă): citire directă. */
    private static boolean wavDirect(String path, Out out, Progress prog) throws Exception {
        try (RandomAccessFile r = new RandomAccessFile(path, "r")) {
            byte[] h = new byte[44];
            if (r.length() < 44) return false;
            r.readFully(h);
            int ch = (h[22] & 0xFF) | ((h[23] & 0xFF) << 8);
            int rate = (h[24] & 0xFF) | ((h[25] & 0xFF) << 8) | ((h[26] & 0xFF) << 16);
            int bits = (h[34] & 0xFF) | ((h[35] & 0xFF) << 8);
            if (ch != 1 || rate != 16000 || bits != 16 || h[36] != 'd') return false;
        }
        try (FileInputStream in = new FileInputStream(path)) {
            long total = Math.max(1, new java.io.File(path).length() - 44), done = 0;
            if (in.skip(44) != 44) return false;
            byte[] b = new byte[6400];
            int n;
            while ((n = in.read(b)) > 0) {
                if (n % 2 == 1) n--;
                if (!out.pcm(b, n)) return true;
                done += n;
                if (prog != null) prog.p(done / (double) total);
            }
        }
        return true;
    }

    /** Reeșantionare liniară la 16 kHz (suficient pentru recunoașterea vorbirii). */
    static final class Resampler {
        private final double step;
        private double pos = 0;
        private short prev = 0;
        Resampler(int src) { step = src / 16000.0; }
        byte[] run(short[] in) {
            if (step == 1.0) {
                byte[] o = new byte[in.length * 2];
                for (int i = 0; i < in.length; i++) { o[2 * i] = (byte) in[i]; o[2 * i + 1] = (byte) (in[i] >> 8); }
                return o;
            }
            int cap = (int) (in.length / step) + 2;
            byte[] o = new byte[cap * 2];
            int k = 0;
            while (pos < in.length && k < cap) {
                int i = (int) Math.floor(pos);
                double fr = pos - i;
                short a = i - 1 < 0 ? prev : in[i - 1];
                short b = in[i];
                // pos e relativ: indexul 0 corespunde eșantionului de după „prev”
                int v = (int) Math.round(a + (b - a) * fr);
                o[2 * k] = (byte) v; o[2 * k + 1] = (byte) (v >> 8);
                k++;
                pos += step;
            }
            pos -= in.length;
            if (in.length > 0) prev = in[in.length - 1];
            byte[] r = new byte[k * 2];
            System.arraycopy(o, 0, r, 0, k * 2);
            return r;
        }
    }
}
