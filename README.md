# LEGE ȘI ORDINE – v1 (PWA locală)

Aplicație web mobilă pentru avocați. Datele rămân doar pe dispozitiv (IndexedDB `lso_db`, chei `lso_*`, cache SW `lso-cache-v<versiune>`). Este complet separată de Notis. Viitorul pachet Android va fi `ro.legesiordine.app`.

## Rulare locală
    python3 -m http.server 8765 --bind 127.0.0.1
    # deschide http://127.0.0.1:8765/index.html

## Teste automate (Playwright, Chrome de sistem)
    cd tests && npm install && node e2e.mjs      # 360x780 și 412x915, touch, CPU încetinit 4x
Rezultatele se scriu în `tests/results.txt`, iar capturile de ecran în `screenshots/`.

## După modificarea fișierelor
    python3 tools-gen-sw.py   # regenerează lista precache din sw.js (mărește APP_VERSION în js/core/store.js la fiecare versiune)

## Structură
- `js/boot.js`: pornirea aplicației. `js/app.js`: randare, navigare, FAB, selecție, ciclul de viață.
- `js/core/`: `db` (IndexedDB), `store` (stare, lacăte, media, coș), `crypto` (PBKDF2 + AES-GCM), `i18n`, `util`, `seed` (date inițiale și migrare).
- `js/ui/`: `modal` (ferestre proprii, PIN), `list` (liste cu 2 rânduri), `editor`, `tabsbar`, `pillrow` (rând orizontal comun și foaia de vizibilitate), `daygroups` (grupare pe zile), `datetime` (ZZ/LL/AAAA).
- `js/tabs/`: `kinds` (tipurile de elemente), `views` (listă, Salvate, Foldere, Ultimele noutăți, Monitorul Oficial), `cats` (categorii pentru Documente și Legi), `recordings`.
- `js/features/`: `search`, `trash`, `alarms`, `voice`, `backup`, `settings`, `share`, `media`.
- `i18n/ro.js`: toate textele interfeței, în română.

## APK Android (Capacitor, pachet `ro.legesiordine.app`)
Datele rămân pe telefon (IndexedDB). Nu se trimite o copie automată în cloud.

    npm install
    python3 tools/sync-www.py
    python3 tools/make-android-icons.py
    npx cap sync android
    cd android && ./gradlew assembleDebug

APK-ul rezultat: `android/app/build/outputs/apk/debug/app-debug.apk`.
Cheile de semnare și `local.properties` nu se încarcă pe GitHub. În repo există un flux GitHub Actions (`APK`), pornit doar manual, care pune APK-ul ca artefact privat.

## Zona secretă / Meniul creator (v1.0.6, preluat din Notis)

- **Deschidere:** apăsare lungă de 6 secunde pe logo sau pe titlul LEGE ȘI ORDINE din antet (inel cyan după 0,35 s, vibrație la reușită). Atingerea scurtă deschide în continuare Setările. Mișcarea degetului peste 15 px sau ridicarea lui anulează gestul.
- **Prima dată:** „Creează” (parolă de minim 8 caractere + caracter secret). Apoi „Deblochează”. Pe telefon se păstrează doar un hash PBKDF2-SHA-256 (200 000 de iterații) în `lso_crsec`, niciodată parola.
- **Mesaje către utilizatori:** tokenul GitHub (Contents: Read and write pe `cluj1313/lso-mesaje`) se lipește o singură dată și se păstrează criptat AES-GCM, cu cheia derivată din parolă + caracter (`lso_crtok`). Mesajele se scriu în `creator.json` și se citesc public de la `https://cluj1313.github.io/lso-mesaje/creator.json`.
- **📊 Statistici și coduri** (server propriu `https://lso-stats.cluj1313.workers.dev`): se deschid direct din zona deblocată, fără „Cod secret” separat.
  - *Prima dată:* alegi parola de admin a serverului (minim 10 caractere, o singură dată). Serverul păstrează doar un hash.
  - *Pe acest telefon:* aceeași parolă se păstrează **criptată AES-GCM cu cheia zonei** (parola + caracterul secret, același KDF ca tokenul) în `lso_adpw`.
  - *Autologare:* când sesiunea admin (12 h, `sessionStorage.lso_adtok`) lipsește sau a expirat, aplicația se autentifică singură cu parola salvată. După deblocarea zonei nu mai tastezi nimic.
  - *Pe un telefon nou* (sau după „Resetează”), parola de admin se cere o singură dată, apoi se reține din nou criptat.
  - Fără deblocarea zonei, parola salvată nu poate fi decriptată.
- **Ieșire:** ×, Ieșire, fundal, Înapoi sau Escape cer „Vrei să ieși din Zona secretă?” Da/Nu. La ieșire se golesc sesiunea și ciorna.
- **Partea utilizatorului:**
  - contor anonim de instalări (o dată pe zi, doar id aleator + versiune + sursă; se oprește din Setări › Confidențialitate);
  - „Comunică cu creatorul aplicației” (bifă + listă; pe Android, `NewsReceiver` verifică la ~6 ore);
  - „Ai un cod?” în Setări › Versiune (Super Class, `lso_super`).
- **Backup:** cheile de mai sus stau în localStorage/sessionStorage și **nu intră** în backup (backup-ul exportă doar IndexedDB). În depozit nu există nicio parolă, niciun token și niciun piper; testele folosesc valori false și servere simulate.

## RECORDINGS: „Transcrie în text tot ce este audio” (v1.0.6)

- **Bifă nebifată (implicit):** se înregistrează doar audio, ca înainte.
- **Bifă bifată pe Android:** recunoașterea vorbirii nativă (ro-RO) ține microfonul și se repornește singură la fiecare pauză. Textul apare live și se salvează în înregistrare. Android permite un singur utilizator al microfonului, așa că în acest mod se păstrează textul, fără fișier audio. Ecranul rămâne aprins cât durează.
- **Bifă bifată în browser (Chrome):** audio + text în paralel.
- Preferința se păstrează în `lso_rec_transcribe`.
