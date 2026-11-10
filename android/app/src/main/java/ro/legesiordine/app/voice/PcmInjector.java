package ro.legesiordine.app.voice;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import java.io.FileDescriptor;
import java.util.ArrayList;
import java.util.List;

/**
 * Trimite audio PCM 16-bit mono (scris de noi) către SpeechRecognizer prin EXTRA_AUDIO_SOURCE (Android 13+, API 33).
 * Astfel microfonul rămâne la înregistrare, iar recunoașterea primește aceleași eșantioane.
 *
 * Nu toate serviciile de recunoaștere acceptă audio injectat. Verificăm: dacă serviciul nu citește din pipe
 * în primele secunde (pipe-ul se umple), trecem la următorul serviciu; dacă niciunul nu citește → failed("unsupported").
 * write() e apelat de pe firul producătorului (înregistrare / decodare); restul, pe firul principal.
 */
final class PcmInjector {
    interface Cb {
        void partial(String t);
        void fin(String t);
        void verified(String who);
        void failed(String code);
        void ended();
    }

    static final int RATE = 16000;
    private static final long VERIFY_MS = 5000;
    private static final long VERIFY_BYTES = 100_000; // > bufferul pipe-ului (64 KB): serviciul chiar citește

    private final Context ctx;
    private final Handler main;
    private final String lang;
    private final boolean live;
    private final Cb cb;
    private final List<Object> candidates = new ArrayList<>();
    private int ci = -1;

    private SpeechRecognizer sr;
    private ParcelFileDescriptor readPfd, writePfd;
    private final Object lock = new Object();
    private FileDescriptor wfd;
    private int gen = 0;
    private volatile long sessionBytes = 0;
    volatile long totalBytes = 0;
    volatile boolean active = false;
    private boolean verified = false, inputDone = false, finished = false, gotResult = false;
    private String lastPartial = "";
    private int errs = 0;
    private Runnable verifyTask, endTimeout;
    private volatile long candStart = 0;

    PcmInjector(Context ctx, Handler main, String lang, boolean live, ComponentName preferred, Cb cb) {
        this.ctx = ctx.getApplicationContext();
        this.main = main;
        this.lang = lang == null || lang.isEmpty() ? "ro-RO" : lang;
        this.live = live;
        this.cb = cb;
        if (Build.VERSION.SDK_INT >= 33) {
            try { if (SpeechRecognizer.isOnDeviceRecognitionAvailable(this.ctx)) candidates.add("ondevice"); } catch (Throwable ignored) {}
            if (preferred != null) candidates.add(preferred);
            candidates.add("default");
        }
    }

    static boolean supported() { return Build.VERSION.SDK_INT >= 33; }
    boolean isVerified() { return verified; }

    /** Firul principal. */
    void start() {
        if (Build.VERSION.SDK_INT < 33 || candidates.isEmpty()) { finish(false, "unsupported"); return; }
        active = true;
        next();
    }

    /** Producătorul a terminat (fișierul s-a decodat / înregistrarea s-a oprit): închidem audio → sesiunea se încheie. */
    void finishInput(long waitMs) {
        main.post(() -> {
            if (finished) return;
            inputDone = true;
            closeWrite();
            endTimeout = () -> finish(true, null);
            main.postDelayed(endTimeout, waitMs);
        });
    }

    /** Oprire imediată (utilizatorul a renunțat). */
    void cancel() { main.post(() -> { inputDone = true; finish(true, null); }); }

    /** Serviciul neverificat a „furat” microfonul (înregistrarea primește zero): îl abandonăm. */
    void onSilenced() { main.post(() -> { if (active && !verified) next(); }); }

    /**
     * Firul producătorului. live = true: dacă pipe-ul e plin, renunțăm la bucată (audio-ul în fișier nu e afectat).
     * live = false (fișier): așteptăm până citește serviciul. Întoarce false dacă injectorul s-a oprit.
     */
    boolean write(byte[] b, int off, int len) {
        int pos = off, end = off + len;
        while (pos < end) {
            if (!active) return false;
            int r; // 1 scris, 0 fără pipe, 2 plin, 3 închis
            // Scrierea (neblocantă) se face sub lacăt, ca descriptorul să nu fie închis între timp.
            synchronized (lock) {
                if (wfd == null) r = 0;
                else {
                    try {
                        int n = Os.write(wfd, b, pos, end - pos);
                        if (n > 0) { pos += n; sessionBytes += n; totalBytes += n; }
                        r = 1;
                    } catch (ErrnoException e) {
                        if (e.errno == OsConstants.EAGAIN) r = 2;
                        else { wfd = null; r = 3; }
                    } catch (Exception e) { wfd = null; r = 3; }
                }
            }
            if (r == 1) continue;
            if (live) return true;
            sleep(r == 2 ? 10 : 20);
        }
        return true;
    }

    private static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) {} }

    private void next() {
        if (verifyTask != null) { main.removeCallbacks(verifyTask); verifyTask = null; }
        teardown();
        ci++;
        candStart = totalBytes;
        if (ci >= candidates.size()) { finish(false, "unsupported"); return; }
        if (!open()) { next(); return; }
        verifyTask = () -> {
            if (!active || verified || inputDone) return;
            if (totalBytes - candStart >= VERIFY_BYTES || gotResult) markVerified();
            else next();
        };
        main.postDelayed(verifyTask, VERIFY_MS);
    }

    private void markVerified() {
        if (verified) return;
        verified = true;
        Object c = candidates.get(ci);
        cb.verified(c instanceof ComponentName ? ((ComponentName) c).getPackageName() : String.valueOf(c));
    }

    private boolean open() {
        if (Build.VERSION.SDK_INT < 33) return false;
        Object c = candidates.get(ci);
        try {
            if ("ondevice".equals(c)) sr = SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx);
            else if (c instanceof ComponentName) sr = SpeechRecognizer.createSpeechRecognizer(ctx, (ComponentName) c);
            else sr = SpeechRecognizer.createSpeechRecognizer(ctx);
        } catch (Throwable e) { sr = null; }
        if (sr == null) return false;
        try {
            ParcelFileDescriptor[] p = ParcelFileDescriptor.createPipe();
            readPfd = p[0]; writePfd = p[1];
            try {
                int fl = Os.fcntlInt(writePfd.getFileDescriptor(), OsConstants.F_GETFL, 0);
                Os.fcntlInt(writePfd.getFileDescriptor(), OsConstants.F_SETFL, fl | OsConstants.O_NONBLOCK);
            } catch (Throwable ignored) {}
        } catch (Exception e) { teardown(); return false; }
        final SpeechRecognizer me = sr;
        sr.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle p) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float v) {}
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onEvent(int i, Bundle b) {}
            @Override public void onPartialResults(Bundle b) {
                if (me != sr) return;
                String t = first(b);
                if (t != null && !t.isEmpty()) { gotResult = true; lastPartial = t; cb.partial(t); }
            }
            @Override public void onSegmentResults(Bundle b) {
                if (me != sr) return;
                String t = first(b);
                if (t == null || t.isEmpty()) t = lastPartial;
                lastPartial = "";
                if (t != null && !t.isEmpty()) { gotResult = true; errs = 0; cb.fin(t); }
            }
            @Override public void onEndOfSegmentedSession() { if (me == sr) sessionEnded(); }
            @Override public void onResults(Bundle b) {
                if (me != sr) return;
                String t = first(b);
                if (t == null || t.isEmpty()) t = lastPartial;
                lastPartial = "";
                if (t != null && !t.isEmpty()) { gotResult = true; errs = 0; cb.fin(t); }
                sessionEnded();
            }
            @Override public void onError(int error) {
                if (me != sr) return;
                String t = lastPartial; lastPartial = "";
                if (t != null && !t.isEmpty()) cb.fin(t);
                if (inputDone) { finish(true, null); return; }
                if (!verified && !gotResult) {
                    // serviciul nu acceptă (limbă, injectare, client): încercăm următorul
                    if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) { next(); return; }
                }
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { finish(false, "perm"); return; }
                if (error == 12 || error == 13) { if (!verified) { next(); return; } finish(false, "lang"); return; }
                errs++;
                if (inputDone) { finish(true, null); return; }
                if (errs > 12) { finish(false, "noservice"); return; }
                long d = (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) ? 1500
                    : error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 400 : 60;
                restartLater(d);
            }
        });
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, readPfd);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE);
        i.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
        if ("ondevice".equals(c)) i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        synchronized (lock) { wfd = writePfd.getFileDescriptor(); gen++; sessionBytes = 0; }
        try { sr.startListening(i); } catch (Throwable e) { teardown(); return false; }
        return true;
    }

    private void sessionEnded() {
        if (finished) return;
        if (inputDone) { finish(true, null); return; }
        // sesiunea s-a încheiat înainte de sfârșitul audio-ului (serviciu fără sesiune segmentată): o redeschidem
        if (!verified) {
            if (gotResult || totalBytes - candStart >= VERIFY_BYTES) markVerified();
            else { next(); return; } // a terminat fără să citească nimic: nu acceptă audio injectat
        }
        restartLater(40);
    }

    private void restartLater(long d) {
        int keep = ci;
        teardown();
        main.postDelayed(() -> {
            if (!active || finished || ci != keep) return;
            if (!open()) finish(false, "noservice");
        }, d);
    }

    private void closeWrite() {
        synchronized (lock) { wfd = null; gen++; }
        if (writePfd != null) { try { writePfd.close(); } catch (Exception ignored) {} writePfd = null; }
    }

    private void teardown() {
        closeWrite();
        if (sr != null) {
            SpeechRecognizer s = sr; sr = null;
            try { s.cancel(); } catch (Throwable ignored) {}
            try { s.destroy(); } catch (Throwable ignored) {}
        }
        if (readPfd != null) { try { readPfd.close(); } catch (Exception ignored) {} readPfd = null; }
    }

    private void finish(boolean ok, String code) {
        if (finished) return;
        finished = true;
        active = false;
        if (endTimeout != null) { main.removeCallbacks(endTimeout); endTimeout = null; }
        if (verifyTask != null) { main.removeCallbacks(verifyTask); verifyTask = null; }
        String t = lastPartial; lastPartial = "";
        if (t != null && !t.isEmpty()) cb.fin(t);
        teardown();
        if (ok) cb.ended(); else cb.failed(code == null ? "noservice" : code);
    }

    private static String first(Bundle b) {
        if (b == null) return null;
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list != null && !list.isEmpty() && list.get(0) != null) return list.get(0).trim();
        return null;
    }
}
