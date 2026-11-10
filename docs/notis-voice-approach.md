# Notis TTS/STT approach on Android (from NOTIS bot, 10/11/2026), behavioural/technical notes only

## How Notis is built
- Notis is not Capacitor. It runs in its own WebView with a JS bridge `window.NotisNative` (addJavascriptInterface).
- It calls `android.speech.tts.TextToSpeech` and `android.speech.SpeechRecognizer` directly.
- Recording to a file is a separate path (MediaRecorder).

## Read-aloud order
1. Piper in the WebView via WASM: onnxruntime-web 1.18.0, piper-wasm 1.0.0, public voices rhasspy/piper-voices (ro "Mihai", en "Joe").
2. System TTS through the bridge.
3. speechSynthesis, in a browser only.
- The fallback to system TTS is mandatory.

## Bridge API
- Calls: ttsState, ttsVoices(lang), ttsSpeak(text, voice, lang, rate, pitch, id), ttsStop, ttsInstall, sttStart(lang), sttStop.
- JS events: notisTtsEv(id, type, s, e) and __stt(kind, text), where kind is part, final, end, err or dbg; plus __sttPerm(ok).
- The bridge is active only on the trusted origin. sttStart and sttStop run on the UI thread.

## Language, voice and rate
- The default is the app language (ro maps to ro-RO).
- Settings, then Voce: choose Piper or the phone's voice.
- For ro, system TTS prefers a male voice, picked by name.
- Default rate 1.25.

## Microphone button
- Long-press (~500 ms) opens: Automat, the ticked Piper voices, then "Voci de citire" with search.
- A short tap opens the menu: Citire / Dictare / Înregistrare.

## Reading
- A second tap on Citește stops it (flush, ttsStop, speechSynthesis.cancel). There is no pause.
- It reads the whole open item, not only the selection.
- Lists: the title plus the items, with ", bifat" for checked ones.
- Language is detected per line. Where there is no Piper voice, the phone voice is used.
- A voice forced from the long-press menu applies to the whole text.

## Dictation
- Uses the app language.
- Inserts at the cursor, or replaces the selection.
- Partial results are rewritten in place, without an italic overlay.
- The final text is plain, with spaces, and fires an `input` event so it gets saved.
- Native mode runs one session until speech ends, with no auto-restart.

## Manifest
- Permissions: RECORD_AUDIO, MODIFY_AUDIO_SETTINGS.
- uses-feature microphone, required=false.
- <queries> intents:
  - android.speech.RecognitionService
  - android.speech.action.RECOGNIZE_SPEECH
  - android.intent.action.TTS_SERVICE
  - android.speech.tts.engine.INSTALL_TTS_DATA
  - com.android.settings.TTS_SETTINGS
- Without the queries on Android 11+, recognition and the TTS install screen appear empty.
- RECORD_AUDIO is requested at first use.

## When a voice or engine is missing
- ttsState 1 means initialising, so retry. -1 means failed.
- No voice for the language: show a dialog "Instalează o voce" that opens ACTION_INSTALL_TTS_DATA, otherwise the TTS settings.
- No bridge and no speechSynthesis: show "Sinteza vocală nu e disponibilă".
- A Piper voice missing for one line: say once "Descarcă vocea din Setări → Voce", then read with the phone voice.
- STT errors and their messages:
  - noservice: "Lipsește serviciul Google"
  - nomatch
  - network
  - busy
  - lang
  - perm

## One microphone user at a time
- Starting dictation or reading stops and saves the recording.
- Starting a recording stops dictation and reading.

## Pitfalls already solved in Notis
- Chunking:
  - Piper starts with 3–6 words, then sentences of ~180 chars; flush cancels the queue.
  - System TTS reads one line at a time with QUEUE_FLUSH, events and a safety timeout.
- Recogniser choice:
  - Avoid com.google.android.as, which refuses third-party apps and Romanian.
  - Prefer the Google app, then Speech Services by Google, then the system default.
  - On failure, fall back to the RECOGNIZE_SPEECH dialog.
- STT results:
  - If onResults is empty, use the last partial result.
  - If an error comes after some speech was heard, keep the partial text.
- STT dialog and resume:
  - onActivityResult arrives before onResume, while the WebView is paused.
  - Hold the text and deliver it from onResume, retrying until JS answers "ok".
  - Use a unique requestCode for the STT dialog.
- Long-press: do not cancel the timer on pointercancel or contextmenu.
