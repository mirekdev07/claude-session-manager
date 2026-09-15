# Claude Session Manager — plan implementacji

Spec: `docs/superpowers/specs/2026-09-03-claude-session-manager-design.md`
Data: 2026-09-03

Legenda: `[ ]` do zrobienia · `[~]` w trakcie · `[x]` gotowe i zweryfikowane

---

## Etap 0 — Fundament + weryfikacja PTY ✅ ZAKOŃCZONY

**Cel:** prawdziwy `claude.exe` renderuje się poprawnie w xterm.js wewnątrz Electrona.

- [x] 0.1 `package.json`, `electron-vite`, TS (3 tsconfigi), Tailwind 4, struktura `src/{main,preload,shared,renderer}`
- [x] 0.2 `main/window.ts` — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- [x] 0.3 `shared/ipc-contract.ts` + `shared/schemas.ts` + `preload/index.ts` — typowane `window.api`
- [x] 0.4 Moduły natywne — **bez rebuildu**, patrz ustalenie poniżej
- [x] 0.5 `main/claude/locator.ts`
- [x] 0.6 `main/claude/process-manager.ts` — spawn, throttle 16 ms, status, resize, kill, czyszczenie env
- [x] 0.7 `main/ipc/pty.ipc.ts` + `main/ipc/claude.ipc.ts` — walidacja zod
- [x] 0.8 `renderer/features/terminal/XtermView.tsx` — xterm + fit/webgl/unicode11/search/web-links
- [x] 0.9 Test dymny `scripts/smoke-native.mjs` — **wszystko przeszło**
- [x] 0.10 `npm run typecheck` czysty, `electron-vite build` przechodzi, okno startuje i renderuje UI

### Wyniki testu dymnego (Electron 44.1.1, ABI 149)

```
[OK] node-pty 1.1.0 ładuje się
[OK] better-sqlite3 13.0.3 ładuje się, zapis i odczyt OK
[OK] claude.exe znaleziony — %APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
[OK] PTY wystartował proces
[OK] Claude Code wypisał 5252 bajty
[OK] 303 sekwencje ANSI
[OK] 17 różnych znaków Unicode (✳ ▐ ▛ █ ─ ❯ …)
```

Wyrenderował się pełny banner Claude Code v2.1.257 z ramkami, a `resize` w trakcie
przechwytywania przerysował układ bez awarii.

### Ustalenia, które zmieniły plan

**1. `electron-rebuild` jest niepotrzebny i szkodliwy.**
`node-pty` 1.1.0 i `better-sqlite3` 13 dostarczają prebuildy **N-API** dla `win32-x64`,
a N-API jest ABI-stabilne — działa w Electronie bez przebudowy. Próba rebuildu
kasowała działające binaria i wywracała się na dwóch niezależnych błędach:

- `'GetCommitHash.bat' is not recognized` — w środowisku ustawiona jest zmienna
  `NoDefaultCurrentDirectoryInExePath=1`, przez którą `cmd.exe` nie szuka programów
  w bieżącym katalogu, a `winpty.gyp` woła ten plik bez prefiksu `.\`
- `MSB8040: wymagane biblioteki Spectre` — `node-pty/binding.gyp` wymusza
  `SpectreMitigation: 'Spectre'`, a żadna z czterech instalacji Visual Studio
  na tej maszynie nie ma tych bibliotek

`postinstall` został usunięty. Skrypt `scripts/rebuild-native.mjs` pozostaje jako
`npm run rebuild:from-source` — obchodzi pierwszy z tych błędów, gdyby build ze
źródeł kiedykolwiek był konieczny (inna architektura, `npm_config_build_from_source`).

**2. Procesy potomne dziedziczą markery sesji-rodzica.**
Test wypisał ostrzeżenie `Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION
marker`. Uruchomienie aplikacji z wnętrza sesji Claude Code powodowało, że potomny
`claude` przestawał zapisywać transkrypt — czyli wykrywanie sesji z Etapu 1 nie
znalazłoby niczego. `ClaudeProcessManager` czyści teraz dziesięć zmiennych
(`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_TOKEN` i pozostałe),
jawną listą — nie po prefiksie, bo pod `CLAUDE_*` kryją się też ustawienia użytkownika.

**3. Nakładka przycisków okna zasłaniała treść nagłówka.**
Naprawione klasą `.titlebar-safe` opartą o `env(titlebar-area-width)`.

---

## Etap 1 — Projekty i sesje ✅ ZAKOŃCZONY

- [x] 1.1 `storage/db.ts` + `storage/migrations.ts`: `projects`, `session_cache`, `session_meta`, `settings`, `open_tabs`
- [x] 1.2 `claude/path-encoding.ts` — ścieżka → nazwa katalogu
- [x] 1.3 `claude/transcript-reader.ts` — head-parsing + `stat()`
- [x] 1.4 `claude/session-provider.ts` — skan dwufazowy, mapowanie po `cwd`, cache po `mtime`+`size`
- [x] 1.5 `claude/session-watcher.ts` — chokidar z batchowaniem 500 ms
- [x] 1.6 `projects/manager.ts` — discovery, Add, Remove, Rename, Favorite, Open Folder
- [x] 1.7 `git/service.ts` — branch czytany z `.git/HEAD`, bez uruchamiania gita
- [x] 1.8 UI: `ProjectList` (przypięte + wykryte), wyszukiwarka, `SessionList`
- [x] 1.9 Ekran błędu „Nie znaleziono Claude Code" + toast błędów

### Weryfikacja na prawdziwych danych (`npm run verify:transcripts`)

```
Katalogi projektów:            55
Transkrypty:                   66
Łączny rozmiar:                317,6 MB
Czas odczytu nagłówków:        144 ms  (2,2 ms/plik)
Z odczytanym cwd:              66/66  (w tym 4 odziedziczone z sąsiada)
Z tytułem (pierwszy prompt):   51/66
Z branchem git:                33/66
Unikalnych projektów (po cwd): 20
[OK] Kodowanie ścieżek zgadza się dla wszystkich transkryptów
```

**Czytamy 144 ms zamiast przetwarzać 317 MB** — strategia head-only potwierdzona.

### Ustalenia z weryfikacji

**1. `gitBranch: "HEAD"` to brak informacji, nie nazwa gałęzi.**
Claude Code zapisuje `HEAD` dla katalogów spoza repozytorium. Bez normalizacji
w interfejsie widniałoby „⑂ HEAD" przy 29 sesjach z katalogów bez gita.
`normalizeBranch` mapuje to na `null`; licznik spadł z 62/66 na prawdziwe 33/66.

**2. Cztery transkrypty w ogóle nie zawierają `cwd`.**
To sesje o rozmiarze 146–267 bajtów, które zmarły zaraz po starcie — mają same wpisy
sterujące, bez ani jednego wpisu `user`. Nie da się ich przypisać do projektu na podstawie
zawartości, a nazwa katalogu jest zakodowana stratnie. Rozwiązanie: `scanDirectory`
działa dwufazowo — po przejrzeniu całego katalogu uzupełnia brakujące `cwd` ścieżką
z transkryptu-sąsiada. Po tej zmianie **66/66** sesji ma przypisany projekt.

**3. Puste sesje są odfiltrowane z list.**
Warunek `(title IS NOT NULL OR size >= 1024)` obowiązuje zarówno przy listowaniu,
jak i w statystykach, żeby licznik sesji zgadzał się z tym, co widać.

### Weryfikacja warstwy danych (`npm run verify:storage`)

```
[OK] Migracje wykonują się od zera — user_version = 1
[OK] Powstały wszystkie tabele
[OK] Ponowna migracja jest bezpieczna (idempotencja)
[OK] Zapis i odczyt wpisu cache
[OK] Zmiana mtime unieważnia cache
[OK] Puste sesje nie trafiają na listę
[OK] Statystyki zgadzają się z listą
[OK] Dziedziczenie cwd po katalogu (ścieżki Windows w LIKE)
[OK] Usunięcie transkryptu czyści cache
```

Test wykrył potrzebę escapowania `\`, `%` i `_` w klauzuli `LIKE` — na Windows każda
ścieżka zawiera backslashe, które SQLite traktuje jako znak ucieczki.

---

## Etap 2 — Sesje w zakładkach ✅ ZAKOŃCZONY (do przetestowania przez użytkownika)

- [x] 2.1 `process-manager`: `new` (z własnym `--session-id`), `continue`, `resume`, `fork`
- [x] 2.2 `TerminalTabs` — wiele PTY naraz, zamykanie, środkowy przycisk myszy
- [x] 2.3 Detekcja statusu Running/Waiting/Closed (cisza > 800 ms)
- [x] 2.4 `StatusBar` — cwd, session ID, PID, uptime, status
- [x] 2.5 Obsługa zakończonego procesu — zakładka przekreślona z przyciskiem Restart
- [ ] 2.6 Persystencja otwartych zakładek + „reopen after restart" → przeniesione do Etapu 5
      (razem z resztą Settings, bo zależy od ustawienia „reopen sessions after restart")

### Decyzja implementacyjna

Terminale nieaktywnych zakładek **pozostają zamontowane** i są ukrywane przez
`visibility: hidden`, a nie `display: none`. Odmontowanie zabiłoby proces Claude,
a `display: none` wyzerowałoby wymiary kontenera, przez co `FitAddon` policzyłby
zerową siatkę i po powrocie na wierzch terminal miałby zepsuty układ.

---

## Etap 3 — Obrazy (część MVP) ✅ ZAKOŃCZONY (do przetestowania przez użytkownika)

- [x] 3.1 `images/cache.ts` — zapis do `%APPDATA%/claude-session-manager/cache/images/`, TTL, cleanup przy starcie
- [x] 3.2 `images/clipboard-service.ts` — rozpoznanie text / image / file-list
- [x] 3.3 **Eksperyment rozstrzygnięty** — patrz niżej
- [x] 3.4 `images/attachment-provider.ts` + `inject-strategies.ts`, wiele obrazów
- [x] 3.5 `ComposeBar` — zwinięty domyślnie, rozwija się przy załączniku
- [x] 3.6 Chipy załączników, modal preview, usuwanie
- [x] 3.7 Drag & drop na obszar terminala + file picker
- [x] 3.8 Logika Ctrl+V przez zdarzenie `paste` w fazie przechwytywania
- [x] 3.9 Błędy §18 — toasty z konkretnym powodem per plik

### Eksperyment: która strategia działa (`npm run verify:inject`)

Skrypt uruchamia prawdziwy proces `claude` w PTY, przechodzi ekran zaufania katalogiem,
wysyła ścieżkę wygenerowanego pliku PNG i sprawdza reakcję TUI.

| Strategia | Znacznik `[Image #N]` | Ścieżka widoczna w TUI | Werdykt |
|---|---|---|---|
| `bracketed-path` | **TAK** (`[Image#1]`) | nie | **domyślna** |
| `plain-path` | nie | TAK | wariant awaryjny |
| `clipboard-paste` | nie testowano | — | wymaga GUI, do testów ręcznych |

**Wniosek zmienił domyślne ustawienie.** Specyfikacja zakładała, że najlepsza będzie
strategia schowkowa (S1). Pomiar pokazał, że wystarczy wysłać ścieżkę pliku w trybie
bracketed paste — Claude Code sam tworzy wtedy natywny załącznik `[Image #1]`.
Jest to jednocześnie rozwiązanie najczystsze: nie nadpisuje schowka użytkownika,
nie zależy od przebudowanego w Electronie 44 API schowka i działa identycznie
dla obrazów ze schowka, upuszczonych i wybranych z dysku.

### Pozostałe ustalenia

**1. Electron 44 przebudował API schowka.**
`clipboard.readImage()`, `writeImage()` i `readBuffer()` **nie istnieją** — zastąpiło je
asynchroniczne API wzorowane na W3C: `read(): Promise<ClipboardItem[]>` z `types[]`
i `getType(mime): Promise<Blob>`. Cały `clipboard-service` jest przez to asynchroniczny.
Wykryte przez typecheck: TypeScript podstawiał w to miejsce globalny `Clipboard` z `lib.dom.d.ts`.
`nativeImage` pozostał bez zmian.

**2. Ctrl+V obsługujemy zdarzeniem `paste`, nie odczytem schowka z main.**
`ClipboardEvent.clipboardData` jest dostępne **synchronicznie**, więc decyzja
„to obraz, nie przepuszczaj do terminala" zapada natychmiast. Odczyt asynchroniczny
zdążyłby wpuścić do xterma tekst towarzyszący obrazowi. Główna droga to więc
`onPasteCapture`, a odczyt schowka po stronie main obsługuje wyłącznie przycisk
„Wklej obraz", gdzie zdarzenia `paste` nie ma.

**3. Claude Code pyta o zaufanie do każdego nowego katalogu.**
Ekran *„Quick safety check: Is this a project you created or one you trust?"* z domyślnie
zaznaczonym **„No, exit"** pochłania cały input, dopóki użytkownik nie odpowie.
W aplikacji to nie problem — pełne TUI jest interaktywne, więc użytkownik po prostu
odpowiada w terminalu. Trzeba było to natomiast obsłużyć w teście automatycznym,
razem z potwierdzaniem, że wskaźnik ❯ faktycznie przeskoczył na „Yes" przed Enterem
(stały odstęp bywał zawodny i potrafił zatwierdzić wyjście z programu).

---

## Etap 4 — Voice ✅ ZAKOŃCZONY (do przetestowania przez użytkownika)

- [x] 4.1 `speech/model-downloader.ts` — pięć modeli ggml, pasek postępu, przerwanie
- [x] 4.2 `speech/whisper-cpp.ts` — wywołanie silnika, odczyt JSON, sprzątanie plików
- [x] 4.3 `SpeechToTextProvider` — interfejs pod ewentualny drugi silnik
- [x] 4.4 Renderer: MediaRecorder + AnalyserNode (fala na `canvas`), Esc anuluje
- [x] 4.5 Push-to-talk `Ctrl+Shift+Space` (przytrzymanie)
- [x] 4.6 Transkrypcja **dopisuje się** do ComposeBar, nigdy nie wysyła sama

### Decyzje, które zmieniły plan

**1. Zero ffmpeg.**
Specyfikacja zakładała `ffmpeg-static` (kilkadziesiąt MB) do konwersji WebM→WAV.
Okazało się to zbędne: nagranie dekodujemy wbudowanym `decodeAudioData`, przepuszczamy
przez `OfflineAudioContext` o częstotliwości 16 kHz — co załatwia jednocześnie resampling
i redukcję do mono — a nagłówek WAV (44 bajty) składamy sami. Zależność usunięta.

**2. Aplikacja nie pobiera plików wykonywalnych.**
Model Whispera (dane) pobieramy w aplikacji, z paskiem postępu i zapisem przez plik
tymczasowy, żeby przerwane pobieranie nie zostawiło uszkodzonego modelu wyglądającego
na gotowy. Pliku wykonywalnego `whisper-cli.exe` aplikacja **nie ściąga sama** —
użytkownik wskazuje go w Ustawieniach. Automatyczne pobieranie i uruchamianie obcego
programu to nie jest coś, co narzędzie ma robić po cichu.

**3. Skrót push-to-talk działa tylko przy aktywnym oknie.**
Świadomie nie rejestrujemy globalnego skrótu systemowego — przechwytywałby
Ctrl+Shift+Space także wtedy, gdy użytkownik pisze w zupełnie innym programie.

---

## Etap 5 — Dashboard, Settings, Command Palette ✅ ZAKOŃCZONY (do przetestowania)

- [x] 5.1 Dashboard (§19) — powitanie zależne od pory dnia, ostatnie projekty, ostatnie rozmowy
- [x] 5.2 Settings — Claude / Głos / Obrazy / Wygląd (§23)
- [x] 5.3 Command Palette `Ctrl+K` (§22) — wszystkie polecenia z planu + skok do projektu
- [x] 5.4 Obsługa błędów §18 i §26 — ekran braku Claude Code, toasty z konkretnym powodem
- [x] 5.5 `electron-builder.yml` → instalator NSIS (`npm run package`)
- [ ] 5.6 Persystencja otwartych zakładek („reopen sessions after restart") — **świadomie odłożone**,
      czeka na Twój feedback, czy w ogóle tego chcesz (przywracanie sesji uruchamia procesy przy starcie)

### Decyzja implementacyjna

Zmiana rozmiaru lub kroju czcionki **nie restartuje sesji**. Pierwsza wersja miała
`fontSize` w zależnościach efektu montującego `XtermView`, przez co każda zmiana wyglądu
odmontowałaby terminal i ubiła proces Claude. Efekt jest teraz rozdzielony: montowanie
zależy wyłącznie od `cwd`, trybu i `sessionId`, a wygląd zmienia się w miejscu przez
`term.options`, z przeliczeniem siatki i powiadomieniem procesu o nowym rozmiarze.

---

## Poprawki po pierwszych testach użytkownika (2026-09-03)

Dwa błędy zgłoszone po uruchomieniu aplikacji. Oba miały przyczynę inną niż podpowiadała
intuicja, więc obie zdiagnozowane pomiarem, nie zgadywaniem.

### 1. `Ctrl+V` nie wklejał obrazów (drag & drop działał)

**Objaw:** zrzut z Narzędzia Wycinania nie pojawiał się jako załącznik po `Ctrl+V`,
natomiast przeciągnięcie pliku działało bez zarzutu.

**Diagnoza.** Napisana na tę okazję sonda (mały program Electrona wywołujący
`webContents.paste()` na schowku z bitmapą umieszczoną tak, jak robi to Narzędzie Wycinania)
pokazała, że zdarzenie `paste` niesie obraz kompletnie poprawnie:

```
clipboardData.files.length = 1  →  image.png (image/png, 4392 B)
items                      = [{ kind: "file", type: "image/png" }]
clipboard.read() [main]    = types ["image/png", …]  →  Blob 4392 B
```

Handler był więc poprawny — **nigdy się nie uruchamiał**. xterm.js domyślnie zamienia
`Ctrl+V` na znak sterujący `0x16` i wywołuje `preventDefault()`, przez co przeglądarka
nie generuje zdarzenia `paste` w ogóle. Drag & drop korzysta z osobnej ścieżki, stąd różnica.

**Naprawa.** `term.attachCustomKeyEventHandler` zwraca `false` dla `Ctrl+V` i `Shift+Insert`,
czyli mówi xtermowi „nie obsługuj tego klawisza". Zdarzenie `paste` powstaje normalnie:
obraz przechwytuje `TerminalPane` w fazie przechwytywania, a zwykły tekst trafia do
wbudowanego w xterm handlera wklejania. Dodatkowo `collectImages` czyta obrazy zarówno
z `files`, jak i z `items[].getAsFile()`.

### 2. Rozpoznawanie mowy tłumaczyło polski na angielski

**Objaw:** wypowiedzi po polsku wracały po angielsku albo jako śmieci; czasem poprawnie.

**Diagnoza.** Pomoc silnika:

```
-l LANG, --language LANG   [en]   spoken language ('auto' for auto-detect)
```

Domyślną wartością `whisper-cli` jest **`en`, nie `auto`**. Kod przy ustawieniu
„Automatyczny" nie przekazywał flagi w ogóle, więc silnik zakładał angielski.
Niestabilność wynikała stąd, że przy wyraźnie polskim nagraniu model czasem opierał się
narzuconemu językowi.

Porównanie na tym samym pliku WAV:

| Wariant | Wynik |
|---|---|
| bez `-l` (domyślnie `en`) | `POPRAW PROSZE TEN KOMPONENT BO PRZYCISKI SA ZA MAŁE…` |
| `-l auto` | `Popraw proszę ten komponent bo przyciski są za małe i nie widać ich na ciemnym tle.` |
| `-l pl` | identycznie jak `-l auto` |

Wersaliki i brak polskich znaków to sygnatura trybu angielskiego.

**Naprawa.** Flaga `-l` przekazywana **zawsze**, z `auto` podawanym dosłownie.

**Pułapka, w którą omal nie wpadłem.** Chciałem dodatkowo wymusić `-tr false`, żeby jawnie
wyłączyć tłumaczenie. `-tr` jest jednak przełącznikiem bez wartości — `-tr false`
**włączyłoby** tłumaczenie, a `false` trafiłoby na listę plików wejściowych. Wycofane;
domyślnie tłumaczenie jest wyłączone i o to chodzi.

### Środowisko: konfiguracja silnika mowy

Silnik: `whisper-cublas-12.4.0-bin-x64.zip` z wydania `b4938`, rozpakowany do
`D:\Tools\whisper` (1129 MB, z czego 964 MB to biblioteki CUDA — dzięki nim nie trzeba
instalować CUDA Toolkit). Plik wykonywalny: `D:\Tools\whisper\Release\whisper-cli.exe`.
Model `ggml-large-v3-turbo.bin` (1549 MB) pobrany przez aplikację do katalogu danych.

Zmierzone na RTX 4060: pierwszy przebieg 5 s, kolejne 2,7 s (~2 s to ładowanie modelu).
Odczyt JSON przez `readFile(path, 'utf8')` zwraca poprawne polskie znaki — zweryfikowane
osobno, bo PowerShell pokazywał krzaki z powodu domyślnego kodowania `Get-Content`.

---

## Etap 6 — Podgląd zużycia limitów (na życzenie użytkownika)

**Wymaganie:** mieć `/usage` przypięte na stałe, z podglądem na żywo.

### Skąd wziąć dane

Rozważone i odrzucone:

- **Parsowanie `/usage` z ekranu TUI** — łamie zasadę „nie parsujemy TUI" (§20), zajmuje sesję
  i psuje się przy każdej zmianie wyglądu.
- **`~/.claude/stats-cache.json`** — plik istnieje, ale zawiera liczbę wiadomości i sesji,
  a nie zużycie limitu. U użytkownika `lastComputedDate` wskazywał datę sprzed miesięcy.
- **Własne wywołanie API Anthropic** — wymagałoby sięgnięcia po token logowania, czego §24 zabrania.

Wybrane: **`claude -p "/usage"`** zwraca ten sam raport co komenda w TUI, jako czysty tekst.

### Pomiary, które ukształtowały implementację

| Pytanie | Odpowiedź | Konsekwencja |
|---|---|---|
| Czy print mode blokuje się na ekranie zaufania w nowym katalogu? | Nie | Sonda może mieć własny katalog roboczy |
| Ile trwa wywołanie? | 2,8–5,7 s | Odświeżanie co 5 minut, pierwszy odczyt 4 s po starcie |
| **Czy zużywa limit?** | **Nie** — licznik `requests` po trzech wywołaniach: 1166 → 1166 → 1165 (spadek to przesuwające się okno 24 h), sesja stale 36% | Odpytywanie cykliczne jest bezpieczne |
| Czy zostawia transkrypt? | Tak, jeden na wywołanie | Kasujemy go po każdym odczycie |
| Czy `--session-id` da się reużyć? | Nie — `Session ID is already in use` | Każde wywołanie dostaje świeży identyfikator |

Bez sprzątania transkryptów odświeżanie co 5 minut zostawiałoby **288 śmieciowych plików
dziennie**, które trafiłyby na listę sesji aplikacji. Sonda pracuje więc w katalogu
`<userData>/usage-probe`, po każdym odczycie kasuje pozostawiony plik, a `ProjectManager`
dodatkowo pomija tę ścieżkę na liście projektów — na wypadek gdyby kasowanie się nie powiodło.

### Implementacja

- `claude/usage-parser.ts` — czysta funkcja, wydzielona z providera właśnie po to, żeby dało się
  ją sprawdzić bez uruchamiania Electrona. Nie zakłada konkretnego zestawu limitów: bierze każdą
  linię pasującą do wzorca `<etykieta>: <n>% used · resets <kiedy>`, bo pozycji przybywa
  wraz z planem (limity per model).
- `claude/usage-provider.ts` — uruchomienie CLI, cache, scalanie równoległych żądań
  (timer i kliknięcie użytkownika nie uruchamiają dwóch procesów naraz), sprzątanie transkryptów.
- `ipc/usage.ipc.ts` — odczyt z cache, wymuszone odświeżenie, timer 5-minutowy.
- `features/usage/UsageIndicator.tsx` — pigułki w górnej belce (etykieta, procent, mikropasek),
  kolor zależny od progu: zielony < 70%, bursztynowy 70–90%, czerwony ≥ 90%.
  Kliknięcie otwiera panel z paskami postępu, czasami odnowy i pełnym raportem.

### Weryfikacja (`npm run verify:usage`)

```
Czas wywolania: 5750 ms
[OK] Rozpoznano 3 limitow:
  Sesja                 37%  [#######.............]  odnowa: Sep 3, 10:10pm
  Tydzień               53%  [###########.........]  odnowa: Sep 7, 10pm
  Tydzień · Fable       96%  [###################.]  odnowa: Sep 7, 10pm
[OK] Czasy odnowy odczytane dla wszystkich pozycji
Usuniete transkrypty sondy: 1
```

---

## Poprawka: kopiowanie tekstu z terminala

**Objaw:** „nie mogę nic kopiować z terminala".

**Diagnoza.** Pierwsze podejrzenie — że TUI Claude Code włącza raportowanie myszy i przez to
przeciąganie nie zaznacza tekstu — okazało się błędne. Sonda (`scripts/diag-mouse-tracking.mjs`)
pokazała, że żaden z trybów myszy nie jest włączany:

```
?1000   —          klikanie (X11 mouse)
?1002   —          przeciąganie z wciśniętym przyciskiem
?1003   —          każdy ruch myszy
?2004   WŁĄCZONY   bracketed paste
```

Zaznaczanie więc działało. Brakowało po prostu **sposobu na skopiowanie**: w terminalu
`Ctrl+C` wysyła sygnał przerwania, a xterm.js nie ma domyślnego skrótu kopiowania.

**Naprawa.**

- `Ctrl+Shift+C` i `Ctrl+Insert` — kopiują zaznaczenie (konwencja Windows Terminala)
- `Ctrl+C` przy aktywnym zaznaczeniu kopiuje **i od razu je czyści**, więc kolejne naciśnięcie
  przerywa pracę Claude'a. Bez czyszczenia zapomniane zaznaczenie blokowałoby przerywanie,
  a w tej aplikacji przerywa się często — to był świadomy warunek projektowy tej decyzji.
- `Ctrl+Shift+A` zaznacza cały bufor (samo `Ctrl+A` zostaje terminalowi jako „początek linii")
- menu pod prawym przyciskiem myszy: Kopiuj / Wklej / Zaznacz wszystko / Wyczyść zaznaczenie,
  z widocznymi skrótami — bo skróty same w sobie są nieodkrywalne
- `rightClickSelectsWord` wyłączone, żeby prawy przycisk otwierał menu zamiast zaznaczać słowo

Kopiowanie idzie przez nowy kanał IPC `clipboard:write-text` — renderer nadal nie ma
bezpośredniego dostępu do systemu (§24).
