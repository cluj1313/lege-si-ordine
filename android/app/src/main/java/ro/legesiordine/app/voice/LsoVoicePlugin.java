package ro.legesiordine.app.voice;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.view.WindowManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Pod nativ TTS/STT pentru LEGE ȘI ORDINE (Android).
 * Alege recunoașterea: aplicația Google, apoi Speech Services by Google,
 * apoi implicitul sistemului — niciodată com.google.android.as.
 * Dacă eșuează, deschide dialogul RECOGNIZE_SPEECH și livrează textul după onResume.
 */
@CapacitorPlugin(
    name = "LsoVoice",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "mic") }
)
public class LsoVoicePlugin extends Plugin {
    private static final String BLOCKED = "com.google.android.as";
    private static final String[] PREFERRED = {
        "com.google.android.googlequicksearchbox",
        "com.google.android.tts"
    };
    private static final String TTS_SETTINGS = "com.android.settings.TTS_SETTINGS";

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private PluginCall speakCall;
    private Runnable speakTimeout;
    private String speakId;

    private SpeechRecognizer stt;
    private PluginCall sttCall;
    private String lastPartial = "";
    private String pendingDialogText = null;
    private int pendingDialogTries = 0;
    private boolean resumed = true;

    @Override
    public void load() {
        Activity act = getActivity();
        if (act == null) return;
        tts = new TextToSpeech(act.getApplicationContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady && tts != null) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) { ttsEv(utteranceId, "start", 0, 0); }
                    @Override public void onDone(String utteranceId) { finishSpeak(true, null); }
                    // Citire cu bara sub cuvânt (din Notis, NativeTts.onRangeStart): indicii de caracter ale cuvântului rostit
                    @Override public void onRangeStart(String utteranceId, int start, int end, int frame) { ttsEv(utteranceId, "range", start, end); }
                    @Override public void onError(String utteranceId) { finishSpeak(false, "error"); }
                });
            }
        });
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        resumed = true;
        deliverPendingDialog();
    }

    @Override
    protected void handleOnPause() {
        resumed = false;
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        if (rec != null) { try { rec.setSink(null); rec.stop(); } catch (Exception ignored) {} rec = null; }
        if (recInj != null) { try { recInj.cancel(); } catch (Exception ignored) {} recInj = null; }
        if (ftInj != null) { try { ftInj.cancel(); } catch (Exception ignored) {} ftInj = null; }
        trOn = false;
        destroyTr();
        restoreBeep();
        cancelSpeakTimeout();
        if (stt != null) {
            try { stt.cancel(); stt.destroy(); } catch (Exception ignored) {}
            stt = null;
        }
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
            ttsReady = false;
        }
        super.handleOnDestroy();
    }

    // ---- TTS ----
    @PluginMethod
    public void ttsState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ready", ttsReady);
        call.resolve(r);
    }

    @PluginMethod
    public void getSupportedVoices(PluginCall call) {
        JSArray arr = new JSArray();
        if (ttsReady && tts != null) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        JSObject o = new JSObject();
                        o.put("name", v.getName());
                        o.put("lang", v.getLocale() != null ? v.getLocale().toLanguageTag() : "");
                        arr.put(o);
                    }
                }
            } catch (Exception ignored) {}
        }
        JSObject r = new JSObject();
        r.put("voices", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void isLanguageSupported(PluginCall call) {
        String lang = call.getString("lang", "ro-RO");
        boolean ok = false;
        if (ttsReady && tts != null) {
            try {
                int res = tts.isLanguageAvailable(localeOf(lang));
                ok = res == TextToSpeech.LANG_AVAILABLE || res == TextToSpeech.LANG_COUNTRY_AVAILABLE || res == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE;
            } catch (Exception ignored) {}
        }
        JSObject r = new JSObject();
        r.put("supported", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void ttsSpeak(PluginCall call) {
        call.setKeepAlive(true);
        main.post(() -> {
            if (!ttsReady || tts == null) {
                call.reject("no-engine");
                return;
            }
            if (speakCall != null) {
                PluginCall prev = speakCall;
                speakCall = null;
                cancelSpeakTimeout();
                try { prev.resolve(); } catch (Exception ignored) {}
            }
            String text = call.getString("text", "");
            if (text == null || text.isEmpty()) { call.resolve(); return; }
            String lang = call.getString("lang", "ro-RO");
            float rate = call.getFloat("rate", 1.25f);
            float pitch = call.getFloat("pitch", 1f);
            String voiceName = call.getString("voiceName", "");
            try {
                tts.setLanguage(localeOf(lang));
                tts.setSpeechRate(rate);
                tts.setPitch(pitch);
                if (voiceName != null && !voiceName.isEmpty() && tts.getVoices() != null) {
                    for (Voice v : tts.getVoices()) {
                        if (voiceName.equals(v.getName())) { tts.setVoice(v); break; }
                    }
                }
            } catch (Exception ignored) {}
            speakCall = call;
            String reqId = call.getString("id", "");
            speakId = reqId != null && !reqId.isEmpty() ? reqId.replaceAll("[^A-Za-z0-9_-]", "") : UUID.randomUUID().toString();
            int maxMs = Math.max(4000, Math.min(120000, (int) (110 * text.length() / Math.max(0.5f, rate)) + 3000));
            cancelSpeakTimeout();
            speakTimeout = () -> finishSpeak(true, null);
            main.postDelayed(speakTimeout, maxMs);
            int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), speakId);
            if (r != TextToSpeech.SUCCESS) finishSpeak(false, "error");
        });
    }

    @PluginMethod
    public void ttsStop(PluginCall call) {
        main.post(() -> {
            cancelSpeakTimeout();
            if (tts != null) try { tts.stop(); } catch (Exception ignored) {}
            PluginCall pending = speakCall;
            speakCall = null;
            if (pending != null) try { pending.resolve(); } catch (Exception ignored) {}
            call.resolve();
        });
    }

    @PluginMethod
    public void ttsInstall(PluginCall call) {
        Activity act = getActivity();
        if (act == null) { call.reject("no-activity"); return; }
        Intent install = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
        if (install.resolveActivity(act.getPackageManager()) != null) {
            act.startActivity(install);
            call.resolve();
            return;
        }
        Intent settings = new Intent(TTS_SETTINGS);
        if (settings.resolveActivity(act.getPackageManager()) != null) {
            act.startActivity(settings);
            call.resolve();
            return;
        }
        call.reject("no-install");
    }

    private void ttsEv(String id, String type, int s, int e) {
        JSObject ev = new JSObject();
        ev.put("id", id == null ? "" : id);
        ev.put("type", type);
        ev.put("s", s);
        ev.put("e", e);
        notifyListeners("ttsEv", ev);
    }

    private void finishSpeak(boolean ok, String err) {
        main.post(() -> {
            cancelSpeakTimeout();
            PluginCall c = speakCall;
            speakCall = null;
            if (c == null) return;
            if (ok) c.resolve();
            else c.reject(err == null ? "error" : err);
        });
    }

    private void cancelSpeakTimeout() {
        if (speakTimeout != null) { main.removeCallbacks(speakTimeout); speakTimeout = null; }
    }

    private static Locale localeOf(String lang) {
        if (lang == null || lang.isEmpty()) return new Locale("ro", "RO");
        String[] p = lang.replace('_', '-').split("-");
        if (p.length >= 2) return new Locale(p[0], p[1]);
        return new Locale(p[0]);
    }

    // ---- STT ----
    @PluginMethod
    public void available(PluginCall call) {
        Activity act = getActivity();
        boolean ok = act != null && SpeechRecognizer.isRecognitionAvailable(act);
        JSObject r = new JSObject();
        r.put("available", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject r = new JSObject();
        r.put("speechRecognition", hasMic() ? "granted" : "denied");
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (hasMic()) { JSObject r = new JSObject(); r.put("speechRecognition", "granted"); call.resolve(r); return; }
        requestPermissionForAlias("mic", call, "onMicPerm");
    }

    @PermissionCallback
    private void onMicPerm(PluginCall call) {
        JSObject r = new JSObject();
        r.put("speechRecognition", hasMic() ? "granted" : "denied");
        call.resolve(r);
        JSObject ev = new JSObject();
        ev.put("ok", hasMic());
        notifyListeners("sttPerm", ev);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasMic()) { call.reject("perm"); return; }
        call.setKeepAlive(true);
        sttCall = call;
        lastPartial = "";
        String lang = call.getString("language", call.getString("lang", "ro-RO"));
        main.post(() -> startRecognizer(call, lang));
    }

    @PluginMethod
    public void sttStop(PluginCall call) {
        main.post(() -> {
            destroyStt();
            PluginCall c = sttCall;
            sttCall = null;
            if (c != null) try { c.resolve(); } catch (Exception ignored) {}
            emitStt("end", "");
            call.resolve();
        });
    }

    private void startRecognizer(PluginCall call, String lang) {
        Activity act = getActivity();
        if (act == null) { failStart(call, "noservice"); return; }
        destroyStt();
        ComponentName cn = preferredComponent(act);
        try {
            if (cn != null) stt = SpeechRecognizer.createSpeechRecognizer(act, cn);
            else stt = SpeechRecognizer.createSpeechRecognizer(act);
        } catch (Exception e) {
            stt = null;
        }
        if (stt == null) {
            startDialogFallback(call, lang);
            return;
        }
        stt.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle p) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float v) {}
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onPartialResults(Bundle b) {
                String t = firstResult(b);
                if (t != null && !t.isEmpty()) { lastPartial = t; emitStt("partial", t); }
            }
            @Override public void onResults(Bundle b) {
                String t = firstResult(b);
                if (t == null || t.isEmpty()) t = lastPartial;
                if (t == null) t = "";
                emitStt("final", t);
                emitStt("end", "");
                PluginCall c = sttCall;
                sttCall = null;
                if (c != null) try { c.resolve(); } catch (Exception ignored) {}
                destroyStt();
            }
            @Override public void onError(int error) {
                String t = lastPartial;
                if (t != null && !t.isEmpty()) {
                    emitStt("final", t);
                    emitStt("end", "");
                    PluginCall c = sttCall;
                    sttCall = null;
                    if (c != null) try { c.resolve(); } catch (Exception ignored) {}
                    destroyStt();
                    return;
                }
                if (error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_SERVER || isNoService(error)) {
                    destroyStt();
                    startDialogFallback(call, lang);
                    return;
                }
                String code = mapError(error);
                emitStt("err", code);
                PluginCall c = sttCall;
                sttCall = null;
                if (c != null) try { c.reject(code); } catch (Exception ignored) {}
                destroyStt();
            }
            @Override public void onEvent(int i, Bundle b) {}
        });
        try {
            stt.startListening(sttIntent(lang, true));
        } catch (Exception e) {
            destroyStt();
            startDialogFallback(call, lang);
        }
    }

    private void startDialogFallback(PluginCall call, String lang) {
        Activity act = getActivity();
        if (act == null) { failStart(call, "noservice"); return; }
        Intent intent = sttIntent(lang, false);
        intent.setAction(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        if (intent.resolveActivity(act.getPackageManager()) == null) {
            failStart(call, "noservice");
            return;
        }
        try {
            startActivityForResult(call, intent, "onSttDialog");
        } catch (Exception e) {
            failStart(call, "noservice");
        }
    }

    @ActivityCallback
    private void onSttDialog(PluginCall call, ActivityResult result) {
        String text = "";
        if (result != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> list = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (list != null && !list.isEmpty() && list.get(0) != null) text = list.get(0).trim();
        }
        if (text.isEmpty()) text = lastPartial;
        pendingDialogText = text == null ? "" : text;
        pendingDialogTries = 0;
        sttCall = call;
        if (resumed) deliverPendingDialog();
    }

    private void deliverPendingDialog() {
        if (pendingDialogText == null) return;
        if (!resumed) return;
        final String text = pendingDialogText;
        pendingDialogTries++;
        emitStt("final", text);
        emitStt("end", "");
        PluginCall c = sttCall;
        sttCall = null;
        if (c != null) try { c.resolve(); } catch (Exception ignored) {}
        // Livrăm și prin JS, pentru cazul în care evenimentul a venit cât WebView era pauzat.
        if (getBridge() != null && getBridge().getWebView() != null) {
            String payload = jsonStr(text);
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
                "(function(){try{if(window.__lsoStt){window.__lsoStt('final'," + payload + ");window.__lsoStt('end','');return 'ok';}return 'no';}catch(e){return 'no';}})()",
                value -> {
                    if (value != null && value.contains("ok")) {
                        pendingDialogText = null;
                    } else if (pendingDialogTries < 15) {
                        main.postDelayed(this::deliverPendingDialog, 250);
                    } else {
                        pendingDialogText = null;
                    }
                }
            ));
        } else if (pendingDialogTries < 15) {
            main.postDelayed(this::deliverPendingDialog, 250);
        } else {
            pendingDialogText = null;
        }
    }

    private void failStart(PluginCall call, String code) {
        emitStt("err", code);
        if (call != null) try { call.reject(code); } catch (Exception ignored) {}
        if (sttCall == call) sttCall = null;
    }

    private void destroyStt() {
        if (stt != null) {
            try { stt.cancel(); } catch (Exception ignored) {}
            try { stt.destroy(); } catch (Exception ignored) {}
            stt = null;
        }
    }

    private ComponentName preferredComponent(Activity act) {
        PackageManager pm = act.getPackageManager();
        List<ResolveInfo> list = pm.queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
        if (list == null) list = new ArrayList<>();
        for (String pkg : PREFERRED) {
            for (ResolveInfo ri : list) {
                ServiceInfo si = ri.serviceInfo;
                if (si != null && pkg.equals(si.packageName) && !BLOCKED.equals(si.packageName)) {
                    return new ComponentName(si.packageName, si.name);
                }
            }
        }
        for (ResolveInfo ri : list) {
            ServiceInfo si = ri.serviceInfo;
            if (si != null && !BLOCKED.equals(si.packageName)) {
                return new ComponentName(si.packageName, si.name);
            }
        }
        return null;
    }

    private Intent sttIntent(String lang, boolean plusPartial) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (plusPartial) i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        return i;
    }

    private String firstResult(Bundle b) {
        if (b == null) return null;
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list != null && !list.isEmpty() && list.get(0) != null) return list.get(0).trim();
        return null;
    }

    private void emitStt(String kind, String text) {
        JSObject ev = new JSObject();
        ev.put("kind", kind);
        ev.put("text", text == null ? "" : text);
        ev.put("status", "end".equals(kind) ? "stopped" : kind);
        ev.put("matches", new JSArray().put(text == null ? "" : text));
        ev.put("accumulatedText", text == null ? "" : text);
        if ("partial".equals(kind) || "final".equals(kind)) notifyListeners("partialResults", ev);
        if ("end".equals(kind)) notifyListeners("listeningState", ev);
        if ("err".equals(kind)) notifyListeners("sttError", ev);
        notifyListeners("stt", ev);
    }

    private boolean hasMic() {
        Activity act = getActivity();
        return act != null && ActivityCompat.checkSelfPermission(act, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean isNoService(int error) {
        return error == 5; // ERROR_CLIENT often means no usable service
    }

    private static String mapError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "perm";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "nomatch";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED
            case 13: // ERROR_LANGUAGE_UNAVAILABLE
                return "lang";
            default:
                return "noservice";
        }
    }

    private static String jsonStr(String s) {
        if (s == null) return "\"\"";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\"";
    }

    // ---------- Transcriere continuă (RECORDINGS, „Transcrie în text tot ce este audio”) ----------
    // Android permite un singur utilizator al microfonului: în acest mod recunoașterea vorbirii ține microfonul
    // și se repornește singură la fiecare pauză/sfârșit, până la transcribeStop. Evenimente: „transcribe”
    // { kind: partial|final|err, text }. Final gol → se păstrează ultimul parțial.
    private SpeechRecognizer trStt;
    private boolean trOn = false;
    private String trLang = "ro-RO", trLast = "";
    private int trErrs = 0;
    private boolean beepMuted = false;

    @PluginMethod
    public void transcribeStart(PluginCall call) {
        if (!hasMic()) { call.reject("perm"); return; }
        trLang = call.getString("language", "ro-RO");
        trOn = true; trLast = ""; trErrs = 0;
        main.post(() -> {
            Activity act = getActivity();
            if (act != null) act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            muteBeep();
            trLoop();
        });
        call.resolve();
    }

    @PluginMethod
    public void transcribeStop(PluginCall call) {
        trOn = false;
        main.post(() -> {
            String last = trLast; trLast = "";
            destroyTr();
            restoreBeep();
            Activity act = getActivity();
            if (act != null) act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            JSObject r = new JSObject();
            r.put("last", last == null ? "" : last);
            call.resolve(r);
        });
    }

    private void emitTr(String kind, String text) {
        JSObject ev = new JSObject();
        ev.put("kind", kind);
        ev.put("text", text == null ? "" : text);
        notifyListeners("transcribe", ev);
    }

    private void trAgain(long delay) {
        destroyTr();
        if (trOn) main.postDelayed(() -> { if (trOn) trLoop(); }, delay);
    }

    private void trLoop() {
        if (!trOn) return;
        Activity act = getActivity();
        if (act == null) { trAgain(1000); return; }
        destroyTr();
        ComponentName cn = preferredComponent(act);
        try {
            trStt = cn != null ? SpeechRecognizer.createSpeechRecognizer(act, cn) : SpeechRecognizer.createSpeechRecognizer(act);
        } catch (Exception e) { trStt = null; }
        if (trStt == null) { trOn = false; emitTr("err", "noservice"); restoreBeep(); return; }
        trStt.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle p) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float v) {}
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onEvent(int i, Bundle b) {}
            @Override public void onPartialResults(Bundle b) {
                String t = firstResult(b);
                if (t != null && !t.isEmpty()) { trLast = t; emitTr("partial", t); }
            }
            @Override public void onResults(Bundle b) {
                String t = firstResult(b);
                if (t == null || t.isEmpty()) t = trLast;
                trLast = "";
                if (t != null && !t.isEmpty()) emitTr("final", t);
                trErrs = 0;
                trAgain(30);
            }
            @Override public void onError(int error) {
                String t = trLast; trLast = "";
                if (t != null && !t.isEmpty()) emitTr("final", t);
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { trOn = false; emitTr("err", "perm"); destroyTr(); restoreBeep(); return; }
                trErrs++;
                long d = error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 400
                    : (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) ? 1500
                    : (trErrs > 20 ? 1000 : 80);
                trAgain(d);
            }
        });
        try {
            Intent i = sttIntent(trLang, true);
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L);
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L);
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 15000L);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.getPackageName());
            trStt.startListening(i);
        } catch (Exception e) { trAgain(500); }
    }

    private void destroyTr() {
        if (trStt != null) {
            try { trStt.cancel(); } catch (Exception ignored) {}
            try { trStt.destroy(); } catch (Exception ignored) {}
            trStt = null;
        }
    }

    // Repornirile dese ale recunoașterii fac „bip” pe multe telefoane: îl oprim cât durează transcrierea.
    private void muteBeep() {
        if (beepMuted || Build.VERSION.SDK_INT < 23) return;
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            if (am != null && !am.isMusicActive()) { am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0); beepMuted = true; }
        } catch (Exception ignored) {}
    }

    private void restoreBeep() {
        if (!beepMuted || Build.VERSION.SDK_INT < 23) return;
        beepMuted = false;
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
            if (am != null) am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
        } catch (Exception ignored) {}
    }

    // ---------- RECORDINGS v1.0.7: audio MEREU + transcriere live / ulterioară ----------
    // Înregistrarea o face LsoRecorder (AudioRecord → .aac). Cu bifa „Transcriere live în timpul înregistrării”:
    //  • Android 13+ (API 33): aceleași eșantioane merg la recunoaștere prin EXTRA_AUDIO_SOURCE (PcmInjector);
    //  • dacă serviciul nu acceptă audio injectat sau Android < 13: recunoașterea pe microfon în paralel („mic”),
    //    păzită: dacă înregistrarea noastră primește zero (microfon luat), oprim transcrierea live, audio continuă.
    // Transcrierea ulterioară: fișierul e decodat local (AudioDecoder) și trimis la recunoaștere tot prin EXTRA_AUDIO_SOURCE.
    private LsoRecorder rec;
    private PcmInjector recInj, ftInj;
    private String recMode = "off";
    private String recLang = "ro-RO";

    private File recDir() { return new File(getContext().getFilesDir(), "lso_rec"); }
    private File trDir() { return new File(getContext().getCacheDir(), "lso_tr"); }

    private boolean insideAppDirs(File f) {
        try {
            String c = f.getCanonicalPath();
            return c.startsWith(recDir().getCanonicalPath() + File.separator) || c.startsWith(trDir().getCanonicalPath() + File.separator);
        } catch (Exception e) { return false; }
    }

    private static String mimeOf(File f) {
        String n = f.getName().toLowerCase(Locale.ROOT);
        if (n.endsWith(".aac")) return "audio/aac";
        if (n.endsWith(".wav")) return "audio/wav";
        if (n.endsWith(".webm")) return "audio/webm";
        if (n.endsWith(".ogg")) return "audio/ogg";
        if (n.endsWith(".m4a") || n.endsWith(".mp4")) return "audio/mp4";
        return "application/octet-stream";
    }

    private JSObject fileInfo(File f) {
        JSObject o = new JSObject();
        o.put("path", f.getAbsolutePath());
        o.put("name", f.getName());
        o.put("mime", mimeOf(f));
        o.put("size", f.length());
        o.put("duration", LsoRecorder.durationOf(f));
        long at = 0;
        try { at = Long.parseLong(f.getName().replaceAll("^rec_(\\d+).*$", "$1")); } catch (Exception ignored) {}
        o.put("at", at > 0 ? at : f.lastModified());
        return o;
    }

    @PluginMethod
    public void recCaps(PluginCall call) {
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("inject", PcmInjector.supported());
        r.put("recording", rec != null);
        call.resolve(r);
    }

    @PluginMethod
    public void recStart(PluginCall call) {
        if (!hasMic()) { call.reject("perm"); return; }
        final boolean live = Boolean.TRUE.equals(call.getBoolean("live", false));
        recLang = call.getString("language", "ro-RO");
        main.post(() -> {
            if (rec != null) { call.reject("busy"); return; }
            LsoRecorder r = new LsoRecorder(recDir(), System.currentTimeMillis());
            try { r.start(); } catch (Exception e) { call.reject("mic"); return; }
            rec = r;
            recMode = "off";
            Activity act = getActivity();
            if (act != null) act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            r.setSink(new LsoRecorder.Sink() {
                @Override public void pcm(byte[] b, int len) { PcmInjector i = recInj; if (i != null) i.write(b, 0, len); }
                @Override public void silenced() {
                    PcmInjector i = recInj;
                    if (i != null) { i.onSilenced(); return; }
                    main.post(() -> { if ("mic".equals(recMode)) { stopMicLive(); recMode = "off"; emitTr("err", "live-off:silenced"); } });
                }
            });
            if (live) startLive();
            JSObject o = new JSObject();
            File f = r.current();
            o.put("path", f != null ? f.getAbsolutePath() : "");
            o.put("inject", PcmInjector.supported());
            o.put("sdk", Build.VERSION.SDK_INT);
            call.resolve(o);
        });
    }

    private void startLive() {
        Activity act = getActivity();
        if (PcmInjector.supported() && act != null) {
            recMode = "trying";
            recInj = new PcmInjector(act, main, recLang, true, preferredComponent(act), new PcmInjector.Cb() {
                @Override public void partial(String t) { emitTr("partial", t); }
                @Override public void fin(String t) { emitTr("final", t); }
                @Override public void verified(String who) { recMode = "inject"; emitTr("mode", "inject:" + who); }
                @Override public void failed(String code) {
                    recInj = null;
                    if (rec == null) return;
                    if ("unsupported".equals(code)) startMicLive();
                    else { recMode = "off"; emitTr("err", "live-off:" + code); }
                }
                @Override public void ended() { recInj = null; }
            });
            recInj.start();
        } else startMicLive();
    }

    private void startMicLive() {
        if (rec == null) return;
        recMode = "mic";
        emitTr("mode", "mic");
        trLang = recLang; trOn = true; trLast = ""; trErrs = 0;
        muteBeep();
        trLoop();
    }

    private void stopMicLive() {
        trOn = false;
        destroyTr();
        restoreBeep();
    }

    @PluginMethod
    public void recStop(PluginCall call) {
        main.post(() -> {
            final LsoRecorder r = rec;
            if (r == null) { JSObject o = new JSObject(); o.put("files", new JSArray()); o.put("last", ""); call.resolve(o); return; }
            final String last = trLast == null ? "" : trLast; trLast = "";
            final String mode = recMode;
            stopMicLive();
            final PcmInjector inj = recInj;
            r.setSink(null);
            new Thread(() -> {
                java.util.List<File> fs = r.stop();
                if (inj != null) inj.finishInput(1500);
                try { Thread.sleep(inj != null && inj.isVerified() ? 1700 : 50); } catch (InterruptedException ignored) {}
                main.post(() -> {
                    if (rec == r) rec = null;
                    if (recInj == inj) recInj = null;
                    recMode = "off";
                    Activity act = getActivity();
                    if (act != null) act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    JSArray arr = new JSArray();
                    for (File f : fs) if (f.exists() && f.length() > 0) arr.put(fileInfo(f));
                    JSObject o = new JSObject();
                    o.put("files", arr);
                    o.put("last", last);
                    o.put("mode", mode);
                    o.put("seconds", r.seconds());
                    call.resolve(o);
                });
            }, "lso-rec-stop").start();
        });
    }

    /** Fișiere rămase de la o înregistrare întreruptă (aplicația închisă brusc): JS le importă, apoi le șterge. */
    @PluginMethod
    public void recOrphans(PluginCall call) {
        JSArray arr = new JSArray();
        File[] list = recDir().listFiles();
        java.util.Set<String> busy = new java.util.HashSet<>();
        if (rec != null) for (File f : rec.files) busy.add(f.getAbsolutePath());
        if (list != null) {
            for (File f : list) {
                if (!f.isFile() || busy.contains(f.getAbsolutePath())) continue;
                if (f.getName().endsWith(".wav")) LsoRecorder.fixWav(f);
                if (f.length() <= 64) { f.delete(); continue; }
                arr.put(fileInfo(f));
            }
        }
        JSObject o = new JSObject();
        o.put("files", arr);
        call.resolve(o);
    }

    @PluginMethod
    public void recDelete(PluginCall call) {
        String path = call.getString("path", "");
        File f = new File(path == null ? "" : path);
        boolean ok = false;
        if (insideAppDirs(f) && (rec == null || !rec.files.contains(f))) ok = f.delete();
        JSObject o = new JSObject();
        o.put("deleted", ok);
        call.resolve(o);
    }

    /** Scrie (pe bucăți, base64) un fișier temporar în cache/lso_tr, pentru transcrierea ulterioară. */
    @PluginMethod
    public void tmpWrite(PluginCall call) {
        String name = String.valueOf(call.getString("name", "audio.bin")).replaceAll("[^A-Za-z0-9._-]", "_");
        String data = call.getString("data", "");
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        File dir = trDir();
        if (!dir.exists()) dir.mkdirs();
        File f = new File(dir, name);
        try (java.io.FileOutputStream o = new java.io.FileOutputStream(f, append)) {
            o.write(android.util.Base64.decode(data == null ? "" : data, android.util.Base64.DEFAULT));
        } catch (Exception e) { call.reject("write"); return; }
        JSObject r = new JSObject();
        r.put("path", f.getAbsolutePath());
        r.put("size", f.length());
        call.resolve(r);
    }

    private void emitFt(String kind, String text, double p) {
        JSObject ev = new JSObject();
        ev.put("kind", kind);
        ev.put("text", text == null ? "" : text);
        ev.put("p", p);
        notifyListeners("filetr", ev);
    }

    @PluginMethod
    public void fileTranscribeStart(PluginCall call) {
        if (!PcmInjector.supported()) { call.reject("sdk"); return; }
        final String path = call.getString("path", "");
        final File f = new File(path == null ? "" : path);
        if (!insideAppDirs(f) || !f.isFile()) { call.reject("file"); return; }
        final String lang = call.getString("language", "ro-RO");
        main.post(() -> {
            if (ftInj != null) { call.reject("busy"); return; }
            Activity act = getActivity();
            if (act == null) { call.reject("noservice"); return; }
            act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            final PcmInjector[] me = new PcmInjector[1];
            me[0] = new PcmInjector(act, main, lang, false, preferredComponent(act), new PcmInjector.Cb() {
                @Override public void partial(String t) { emitFt("partial", t, -1); }
                @Override public void fin(String t) { emitFt("final", t, -1); }
                @Override public void verified(String who) { emitFt("mode", who, -1); }
                @Override public void failed(String code) { if (ftInj == me[0]) ftInj = null; ftDone(); emitFt("err", code, -1); }
                @Override public void ended() { if (ftInj == me[0]) ftInj = null; ftDone(); emitFt("done", "", 1); }
            });
            ftInj = me[0];
            me[0].start();
            new Thread(() -> {
                final long[] lastEmit = { 0 };
                try {
                    AudioDecoder.decode(f.getAbsolutePath(), (b, n) -> me[0].write(b, 0, n), p -> {
                        long now = System.currentTimeMillis();
                        if (now - lastEmit[0] > 700) { lastEmit[0] = now; emitFt("progress", "", p); }
                    });
                    me[0].finishInput(10000);
                } catch (Exception e) {
                    me[0].cancel();
                    emitFt("err", "decode", -1);
                }
            }, "lso-filetr").start();
            call.resolve();
        });
    }

    private void ftDone() {
        Activity act = getActivity();
        if (act != null && rec == null) act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @PluginMethod
    public void fileTranscribeStop(PluginCall call) {
        main.post(() -> {
            PcmInjector i = ftInj;
            if (i != null) i.cancel();
            call.resolve();
        });
    }
}
