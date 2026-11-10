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
