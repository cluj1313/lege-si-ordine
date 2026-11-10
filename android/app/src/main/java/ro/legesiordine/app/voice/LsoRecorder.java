package ro.legesiordine.app.voice;

import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaRecorder;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * Înregistrare audio nativă pentru RECORDINGS: AudioRecord (16 kHz, mono, PCM 16-bit) → fișier AAC (ADTS, „.aac”).
 * ADTS se scrie cadru cu cadru, deci fișierul rămâne valid chiar dacă aplicația e oprită brusc (nu se pierde audio).
 * Dacă encoderul AAC nu pornește sau cade, continuăm într-un fișier WAV (PCM). Aceleași eșantioane merg la Sink
 * (transcrierea live prin PcmInjector).
 */
final class LsoRecorder {
    interface Sink {
        void pcm(byte[] b, int len);
        void silenced(); // ~1,5 s de zero digital: microfonul a fost luat de altcineva / dezactivat
    }

    static final int RATE = PcmInjector.RATE;
    private static final int FREQ_IDX_16K = 8;

    final File dir;
    final long startMs;
    final List<File> files = new ArrayList<>();
    private AudioRecord ar;
    private MediaCodec enc;
    private FileOutputStream out;
    private boolean wav = false;
    private long wavBytes = 0;
    private Thread th;
    private volatile boolean on = false;
    private volatile Sink sink;
    volatile long pcmBytes = 0;
    private long samples = 0;
    private int zeroRun = 0;
    private boolean silentFired = false;

    LsoRecorder(File dir, long startMs) { this.dir = dir; this.startMs = startMs; }

    File current() { return files.isEmpty() ? null : files.get(files.size() - 1); }
    void setSink(Sink s) { sink = s; }
    double seconds() { return pcmBytes / (double) (RATE * 2); }

    @SuppressLint("MissingPermission")
    void start() throws Exception {
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("dir");
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) throw new IOException("rate");
        ar = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 4, RATE * 2));
        if (ar.getState() != AudioRecord.STATE_INITIALIZED) { try { ar.release(); } catch (Exception ignored) {} ar = null; throw new IOException("mic"); }
        try { openAac(); } catch (Exception e) { closeEnc(); openWav(); }
        ar.startRecording();
        if (ar.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) { stopQuiet(); throw new IOException("busy"); }
        on = true;
        th = new Thread(this::loop, "lso-rec");
        th.start();
    }

    /** Oprește și închide fișierele. Întoarce lista de fișiere (de obicei unul). */
    List<File> stop() {
        on = false;
        if (th != null) { try { th.join(3000); } catch (InterruptedException ignored) {} th = null; }
        stopQuiet();
        return files;
    }

    private void stopQuiet() {
        if (ar != null) {
            try { ar.stop(); } catch (Exception ignored) {}
            try { ar.release(); } catch (Exception ignored) {}
            ar = null;
        }
        if (enc != null) { try { drain(true); } catch (Exception ignored) {} }
        closeEnc();
        closeOut();
    }

    private void loop() {
        byte[] buf = new byte[3200]; // 100 ms
        while (on) {
            int n;
            try { n = ar.read(buf, 0, buf.length); } catch (Exception e) { n = -1; }
            if (n <= 0) { if (n < 0) { try { Thread.sleep(20); } catch (InterruptedException ignored) {} } continue; }
            pcmBytes += n;
            writeAudio(buf, n);
            boolean zero = true;
            for (int i = 0; i < n; i++) if (buf[i] != 0) { zero = false; break; }
            if (zero) {
                zeroRun += n;
                if (zeroRun >= RATE * 3 && !silentFired) { silentFired = true; Sink s = sink; if (s != null) s.silenced(); }
            } else { zeroRun = 0; silentFired = false; }
            Sink s = sink;
            if (s != null) { try { s.pcm(buf, n); } catch (Exception ignored) {} }
        }
    }

    private void writeAudio(byte[] buf, int n) {
        if (!wav && enc != null) {
            try { encode(buf, n); return; }
            catch (Exception e) { closeEnc(); closeOut(); try { openWav(); } catch (Exception ignored) { return; } }
        }
        if (wav && out != null) {
            try { out.write(buf, 0, n); wavBytes += n; if ((wavBytes & 0xFFFF) < n) out.getFD().sync(); }
            catch (Exception ignored) {}
        }
    }

    // ---- AAC (ADTS) ----
    private void openAac() throws Exception {
        MediaFormat f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 1);
        f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        f.setInteger(MediaFormat.KEY_BIT_RATE, 48000);
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
        enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        enc.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        enc.start();
        File file = new File(dir, "rec_" + startMs + (files.isEmpty() ? "" : "_" + files.size()) + ".aac");
        out = new FileOutputStream(file);
        files.add(file);
        wav = false;
    }

    private void encode(byte[] buf, int n) throws Exception {
        int off = 0;
        while (off < n) {
            int idx = enc.dequeueInputBuffer(10000);
            if (idx < 0) { drain(false); continue; }
            ByteBuffer in = enc.getInputBuffer(idx);
            in.clear();
            int len = Math.min(in.remaining(), n - off);
            in.put(buf, off, len);
            long pts = samples * 1_000_000L / RATE;
            samples += len / 2;
            enc.queueInputBuffer(idx, 0, len, pts, 0);
            off += len;
            drain(false);
        }
    }

    private final MediaCodec.BufferInfo bi = new MediaCodec.BufferInfo();
    private final byte[] hdr = new byte[7];
    private int frames = 0;

    private void drain(boolean eos) throws Exception {
        if (eos) {
            int idx = enc.dequeueInputBuffer(10000);
            if (idx >= 0) enc.queueInputBuffer(idx, 0, 0, samples * 1_000_000L / RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
        }
        long until = System.currentTimeMillis() + (eos ? 1500 : 0);
        while (true) {
            int idx = enc.dequeueOutputBuffer(bi, eos ? 10000 : 0);
            if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) { if (!eos || System.currentTimeMillis() > until) return; continue; }
            if (idx < 0) continue; // format/buffers changed
            ByteBuffer ob = enc.getOutputBuffer(idx);
            boolean end = (bi.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
            if ((bi.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && bi.size > 0 && ob != null && out != null) {
                ob.position(bi.offset); ob.limit(bi.offset + bi.size);
                byte[] data = new byte[bi.size];
                ob.get(data);
                adts(hdr, bi.size + 7);
                out.write(hdr); out.write(data);
                if (++frames % 50 == 0) out.getFD().sync();
            }
            enc.releaseOutputBuffer(idx, false);
            if (end) return;
        }
    }

    private static void adts(byte[] p, int len) {
        int profile = 2, chan = 1;
        p[0] = (byte) 0xFF;
        p[1] = (byte) 0xF1;
        p[2] = (byte) (((profile - 1) << 6) + (FREQ_IDX_16K << 2) + (chan >> 2));
        p[3] = (byte) (((chan & 3) << 6) + (len >> 11));
        p[4] = (byte) ((len & 0x7FF) >> 3);
        p[5] = (byte) (((len & 7) << 5) + 0x1F);
        p[6] = (byte) 0xFC;
    }

    private void closeEnc() {
        if (enc != null) {
            try { enc.stop(); } catch (Exception ignored) {}
            try { enc.release(); } catch (Exception ignored) {}
            enc = null;
        }
    }

    // ---- WAV (rezervă) ----
    private void openWav() throws Exception {
        File file = new File(dir, "rec_" + startMs + (files.isEmpty() ? "" : "_" + files.size()) + ".wav");
        out = new FileOutputStream(file);
        out.write(wavHeader(0));
        files.add(file);
        wav = true; wavBytes = 0;
    }

    private void closeOut() {
        if (out != null) {
            try { out.getFD().sync(); } catch (Exception ignored) {}
            try { out.close(); } catch (Exception ignored) {}
            out = null;
            File f = current();
            if (wav && f != null) fixWav(f);
        }
    }

    static byte[] wavHeader(long data) {
        long riff = 36 + data;
        int byteRate = RATE * 2;
        return new byte[] {
            'R', 'I', 'F', 'F', (byte) riff, (byte) (riff >> 8), (byte) (riff >> 16), (byte) (riff >> 24),
            'W', 'A', 'V', 'E', 'f', 'm', 't', ' ', 16, 0, 0, 0, 1, 0, 1, 0,
            (byte) RATE, (byte) (RATE >> 8), 0, 0, (byte) byteRate, (byte) (byteRate >> 8), (byte) (byteRate >> 16), 0,
            2, 0, 16, 0, 'd', 'a', 't', 'a', (byte) data, (byte) (data >> 8), (byte) (data >> 16), (byte) (data >> 24)
        };
    }

    /** Corectează dimensiunile din antet după lungimea reală (și pentru fișierele rămase după o oprire bruscă). */
    static void fixWav(File f) {
        try (RandomAccessFile r = new RandomAccessFile(f, "rw")) {
            long data = Math.max(0, r.length() - 44);
            r.seek(0);
            r.write(wavHeader(data));
        } catch (Exception ignored) {}
    }

    /** Durata unui fișier rămas: ADTS → numărăm cadrele (1024 eșantioane fiecare); WAV → din mărime. */
    static double durationOf(File f) {
        String n = f.getName();
        if (n.endsWith(".wav")) return Math.max(0, f.length() - 44) / (double) (RATE * 2);
        long frames = 0;
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long pos = 0, len = r.length();
            byte[] h = new byte[7];
            int sr = RATE;
            while (pos + 7 <= len) {
                r.seek(pos);
                r.readFully(h);
                if ((h[0] & 0xFF) != 0xFF || (h[1] & 0xF0) != 0xF0) break;
                int fl = ((h[3] & 0x03) << 11) | ((h[4] & 0xFF) << 3) | ((h[5] & 0xE0) >> 5);
                if (fl < 7) break;
                frames++;
                pos += fl;
            }
            return frames * 1024.0 / sr;
        } catch (Exception e) { return frames * 1024.0 / RATE; }
    }
}
