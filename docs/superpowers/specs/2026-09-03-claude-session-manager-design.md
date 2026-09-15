# Claude Session Manager — architektura i plan MVP

Data: 2026-09-03
Status: do akceptacji
Źródło wymagań: `plan.md` (§1–§34), `mockup.png` (poglądowy)

---

## 0. Ustalenia z brainstormingu

| Decyzja | Wybór | Uzasadnienie |
|---|---|---|
| Układ main area | **Terminal-first** | Zgodnie z §3/§6/§21 planu. Mockup pokazywał własny czat z dymkami — odrzucony, bo wymagałby headless `claude -p` i utraty permissions promptów, slash commands, plan mode i całego TUI. |
| Silnik STT | **whisper.cpp + CUDA, `ggml-large-v3-turbo`** | RTX 4060 na maszynie. Najlepszy polski wśród opcji offline, dobrze znosi wtrącenia angielskich nazw technicznych. |
| Lista projektów | **Auto-discovery + ręczne przypinanie** | 55 katalogów już istnieje w `~/.claude/projects/`. Wykryte pokazujemy w osobnej sekcji, użytkownik przypina istotne. |
| Split view | **poza MVP**, ale architektura go przewiduje | §7 planu. |
| Capture Screenshot | **poza MVP** | §14 planu. |

---

## 0.1. Wyniki rekonesansu środowiska (§30 planu)

Wszystko poniżej **zweryfikowane na tej maszynie**, nie założone.

**Środowisko**
- Node `v25.2.1`, npm `11.6.2`, Windows 11 Pro 26200
- CPU: Ryzen 5 5600 (12 wątków), RAM 32 GB, GPU: NVIDIA RTX 4060

**Claude Code**
- Wersja `2.1.257`
- Rozwiązanie ścieżki: `where claude` → `C:\Users\<uzytkownik>\AppData\Roaming\npm\claude.cmd`
- Pakiet npm `@anthropic-ai/claude-code` jest **wrapperem**: `cli-wrapper.cjs` deleguje do natywnego binarza `bin/claude.exe` (postinstall kopiuje binarkę per-platforma, `win32-x64`).
  → **Spawnujemy `claude.exe` bezpośrednio**, nie `.cmd` przez `cmd.exe`. Czystszy PTY, brak problemów z propagacją Ctrl+C przez shim.

**Flagi CLI istotne dla nas** (potwierdzone w `claude --help`)
- `-c, --continue` — kontynuacja ostatniej rozmowy w bieżącym katalogu
- `-r, --resume [session-id]` — wznowienie po ID (bez argumentu: interaktywny picker)
- `--fork-session` — przy resume tworzy **nowe** session ID zamiast reużywać ⇒ **Fork Session z §5 jest wykonalny**
- `--session-id <uuid>` — narzucenie własnego UUID nowej sesji ⇒ **znamy ID sesji od razu przy starcie**, bez zgadywania po plikach
- `--add-dir`, `--allowedTools`, `--append-system-prompt`, `--setting-sources` — do „default arguments" w Settings
- Podkomendy: `agents`, `attach <id>`, `logs <id>`, `stop <id>`, `rm <id>`, `--bg` — osobny świat sesji background; **poza MVP**, ale warto o nim wiedzieć
- `claude project purge [path]` — usuwa cały stan projektu; **nigdy nie wołamy bez wyraźnego potwierdzenia** (§5)
- **Nie istnieje** oficjalne `claude sessions --json` ani inny nieinteraktywny listing rozmów ⇒ musimy czytać dane lokalne (§3 pkt 8 planu to dopuszcza)

**Format danych lokalnych**
- Transkrypty: `~/.claude/projects/<enc-cwd>/<session-uuid>.jsonl`, 55 katalogów
- Kodowanie nazwy katalogu: `D:\Claude Manager` → `D--Claude-Manager` (`:`, `\`, spacja → `-`). **Stratne i nieodwracalne**: `Nowy folder (3)` → `Nowy-folder--3-`
- Pola we wpisie `type:"user"`: `cwd`, `gitBranch`, `version`, `sessionId`, `timestamp`, `uuid`, `parentUuid`, `message`, `permissionMode`, `promptSource`, `isSidechain`, `entrypoint`, `origin`, `promptId`, `userType`
  → **`cwd` w środku pliku jest źródłem prawdy dla mapowania sesja→projekt**, nie nazwa katalogu
- Nagłówek pliku zawiera lekkie wpisy sterujące: `{"type":"last-prompt",...}`, `{"type":"mode",...}`, `{"type":"permission-mode",...}`

**Obrazy — mechanizm natywny (§12 planu)**
- Claude Code TUI **natywnie obsługuje wklejanie obrazów**
- Zapisuje je do `~/.claude/image-cache/<sessionId>/1.png`, `2.png`, …
- W prompcie wstawia placeholder `[Image #1]`
- W transkryptach znaleziono `[Image #2] popraw formatowanie...` ⇒ **wiele obrazów w jednym prompcie działa natywnie**
- Długie wklejki tekstu trafiają do `~/.claude/paste-cache/<hash>.txt`

**Konsekwencja:** nie budujemy własnego kanału obrazów do modelu. Naszym zadaniem jest tylko **doprowadzić obraz do natywnego mechanizmu Claude Code** — patrz §F.

---

## A. Architektura

### Procesy

```
┌──────────────────────── Electron main (Node) ────────────────────────┐
│  ClaudeCliLocator · ClaudeProcessManager · ClaudeSessionProvider      │
│  ProjectManager · ImageAttachmentProvider · SpeechToTextProvider      │
│  ClipboardService · SettingsService · PersistenceService · GitService │
│                              ▲   │                                    │
│                       IPC    │   │  push (pty data, status)           │
└──────────────────────────────┼───┼────────────────────────────────────┘
                               │   ▼
                    ┌──── preload (contextBridge) ────┐
                    │  wąskie, typowane window.api    │
                    └──────────┬──────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│  renderer — React + TS + Vite + Tailwind + zustand                   │
│  Sidebar projektów · panel sesji · xterm.js · attachment bar · voice  │
└──────────────────────────────────────────────────────────────────────┘
```

**Bezpieczeństwo (§24):** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
Renderer **nie może** uruchomić dowolnej komendy. Jedyne wejście do PTY to `pty.create({ projectId, mode, sessionId? })` — main sam składa argumenty z whitelisty, renderer nigdy nie podaje ścieżki executable ani surowego argv.

### IPC — trzy kanały

| Typ | Mechanizm | Zastosowanie |
|---|---|---|
| request/response | `ipcRenderer.invoke` ↔ `ipcMain.handle` | `projects.*`, `sessions.*`, `settings.*`, `images.*`, `speech.*` |
| main → renderer, wysoka częstotliwość | `webContents.send` na dedykowanym kanale `pty:data:<ptyId>` | strumień wyjścia terminala |
| main → renderer, zdarzenia | `webContents.send('app:event')` | zmiana statusu procesu, nowa sesja wykryta przez watcher, postęp pobierania modelu |

**Throttling PTY:** surowy `onData` z TUI potrafi generować setki zdarzeń/s. Bufor w main z flushem co ~16 ms (jedna klatka) — inaczej IPC staje się wąskim gardłem i terminal się zacina.

**Walidacja:** każdy handler w main waliduje payload przez `zod` zanim cokolwiek zrobi. Ścieżki projektów i obrazów: `path.resolve` + sprawdzenie, że mieszczą się w dozwolonym zakresie (projekt: istniejący katalog z listy; obraz: wyłącznie katalog cache aplikacji).

### Ryzyko #1: node-pty i ABI Electrona

Lokalny Node to v25, Electron ma własny ABI. `node-pty` to moduł natywny ⇒ wymaga rebuildu (`@electron/rebuild`) albo prebuildów. Na Windows używa ConPTY (dostępne w Win 11) — to jedyna droga do pełnego interaktywnego TUI.

**Plan:** zaczynamy od `node-pty` + `@electron/rebuild`. Jeśli rebuild okaże się kruchy w CI/na czystej maszynie, przechodzimy na fork z prebuildami. **To jest weryfikowane w Etapie 0, przed jakąkolwiek inną pracą** — bo jeśli TUI nie działa w xterm.js, cały projekt nie ma sensu.

### Warstwy w main

| Moduł | Odpowiedzialność | Zależy od |
|---|---|---|
| `ClaudeCliLocator` | znalezienie `claude.exe`, wersja, health check, ręczne nadpisanie ścieżki | fs, child_process |
| `ClaudeProcessManager` | spawn PTY, resume/continue/fork, kill, PID, uptime, lifecycle | node-pty, Locator |
| `ClaudeSessionProvider` | skan `~/.claude/projects/**`, metadata, mapowanie sesja→projekt, watcher | fs, chokidar, Persistence |
| `ProjectManager` | katalogi, aliasy, favorites, discovery, last activity | Persistence, SessionProvider, Git |
| `ImageAttachmentProvider` | clipboard/DnD/picker → temp file → wstrzyknięcie do PTY | Clipboard, ProcessManager |
| `SpeechToTextProvider` | nagranie → WAV → whisper.cpp → tekst, model downloader | child_process, ffmpeg |
| `ClipboardService` | rozpoznanie typu zawartości schowka (text / image / file list) | Electron clipboard |
| `SettingsService` | schema zod, defaults, migracje | Persistence |
| `PersistenceService` | SQLite: projekty, aliasy, favorites, cache metadanych sesji, otwarte zakładki | better-sqlite3 |
| `GitService` | aktualny branch, dirty flag | git CLI |

Granice: `ClaudeSessionProvider` i `ImageAttachmentProvider` to jedyne miejsca, które wiedzą **cokolwiek** o wewnętrznym formacie danych Claude Code. Zmiana formatu = zmiana w jednym pliku (§3, §12).

---

## B. Struktura katalogów

```
claude-session-manager/
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
├─ docs/
│  └─ superpowers/specs/2026-09-03-claude-session-manager-design.md
├─ resources/
│  └─ icons/
└─ src/
   ├─ shared/                    # współdzielone main ↔ renderer
   │  ├─ ipc-contract.ts         # nazwy kanałów + typy request/response
   │  ├─ types.ts                # Project, ClaudeSession, PtyHandle, Attachment...
   │  └─ schemas.ts              # zod
   ├─ preload/
   │  └─ index.ts                # contextBridge → window.api
   ├─ main/
   │  ├─ index.ts                # bootstrap, single instance lock
   │  ├─ window.ts               # BrowserWindow + webPreferences
   │  ├─ ipc/
   │  │  ├─ index.ts             # rejestracja wszystkich handlerów
   │  │  ├─ projects.ipc.ts
   │  │  ├─ sessions.ipc.ts
   │  │  ├─ pty.ipc.ts
   │  │  ├─ images.ipc.ts
   │  │  ├─ speech.ipc.ts
   │  │  └─ settings.ipc.ts
   │  ├─ claude/
   │  │  ├─ locator.ts
   │  │  ├─ process-manager.ts
   │  │  ├─ session-provider.ts
   │  │  ├─ transcript-reader.ts # head/tail parsing .jsonl
   │  │  └─ path-encoding.ts
   │  ├─ projects/manager.ts
   │  ├─ images/
   │  │  ├─ attachment-provider.ts
   │  │  ├─ clipboard-service.ts
   │  │  ├─ cache.ts             # zapis, TTL, cleanup
   │  │  └─ inject-strategies.ts # S1 / S2 / S3 (patrz §F)
   │  ├─ speech/
   │  │  ├─ provider.ts
   │  │  ├─ whisper-cpp.ts
   │  │  └─ model-downloader.ts
   │  ├─ git/service.ts
   │  ├─ storage/
   │  │  ├─ db.ts
   │  │  ├─ migrations/
   │  │  └─ settings.ts
   │  └─ util/{logger,paths,throttle}.ts
   └─ renderer/
      ├─ index.html
      ├─ main.tsx
      ├─ app/
      │  ├─ App.tsx              # layout: sidebar | sessions | main
      │  ├─ CommandPalette.tsx   # Ctrl+K
      │  └─ shortcuts.ts
      ├─ features/
      │  ├─ dashboard/
      │  ├─ projects/            # ProjectList, ProjectItem, AddProjectDialog
      │  ├─ sessions/            # SessionList, SessionItem, SessionActions
      │  ├─ terminal/
      │  │  ├─ TerminalTabs.tsx
      │  │  ├─ XtermView.tsx     # xterm + addons + resize observer
      │  │  ├─ ComposeBar.tsx    # attachments + transkrypcja (pojawia się warunkowo)
      │  │  └─ StatusBar.tsx     # cwd, branch, session id, PID, uptime, status
      │  ├─ images/              # AttachmentChip, ImagePreviewModal, DropZone
      │  ├─ voice/               # MicButton, Waveform, RecordingOverlay
      │  └─ settings/            # 5 sekcji z §23
      ├─ store/                  # zustand: projects, sessions, terminals, attachments
      └─ styles/
```

Zasada: żaden plik nie rośnie ponad ~300 linii. Gdy rośnie — dzielimy, bo to sygnał, że robi zbyt wiele.

---

## C. Biblioteki

| Biblioteka | Rola | Dlaczego akurat ta |
|---|---|---|
| `electron` | shell aplikacji | wymóg §2 |
| `electron-vite` | build main/preload/renderer, HMR | najprostsza konfiguracja TS+React dla Electrona; alternatywa Electron Forge dokłada warstwę, której nie potrzebujemy |
| `electron-builder` | pakowanie do .exe/NSIS | standard na Windows |
| `react`, `react-dom` | UI | wymóg §2 |
| `typescript` | typy | wymóg §2 |
| `@xterm/xterm` | emulator terminala | wymóg §6 (nowy scope; stary pakiet `xterm` jest zdeprecjonowany) |
| `@xterm/addon-fit` | dopasowanie cols/rows do kontenera | resize (§6) |
| `@xterm/addon-webgl` | renderer GPU | płynne przewijanie TUI; fallback na canvas gdy brak WebGL |
| `@xterm/addon-unicode11` | poprawna szerokość znaków | wymóg Unicode (§6), krytyczne dla polskich znaków i emoji w TUI |
| `@xterm/addon-search` | szukanie w buforze | UX |
| `@xterm/addon-web-links` | klikalne linki | UX |
| `node-pty` | ConPTY, prawdziwy PTY | wymóg §2; jedyna opcja dla interaktywnego TUI |
| `better-sqlite3` | lokalna baza | synchroniczne API = zero ceremonii async w main; szybkie; §2 dopuszcza SQLite |
| `zod` | walidacja IPC i settings | wymóg bezpieczeństwa §24 |
| `zustand` | stan renderera | lekki, bez boilerplate; Redux byłby overengineeringiem (§32) |
| `chokidar` | watch `~/.claude/projects` | live update listy sesji bez pollingu |
| `tailwindcss` | style | szybko, spójnie, dark-first (§21) |
| `lucide-react` | ikony | lekkie, spójny zestaw |
| `ffmpeg-static` | konwersja WebM/Opus → WAV 16 kHz | whisper.cpp przyjmuje tylko WAV |

**Świadomie NIE używamy:** Redux/MobX, ORM (Prisma/TypeORM), `sharp` (miniatury robi wbudowany `nativeImage.resize` — o jedną natywną zależność mniej), własnego klienta Anthropic API (§3).

Zależności natywne wymagające rebuildu pod Electron: `node-pty`, `better-sqlite3`. Obie obsłużone jednym `@electron/rebuild` w postinstall.

---

## D. Integracja z Claude CLI

### Znalezienie executable

```
1. Settings → ręcznie wskazana ścieżka (jeśli ustawiona)     → użyj
2. where claude                                              → claude.cmd
3. rozwiąż .cmd → node_modules/@anthropic-ai/claude-code/bin/claude.exe
4. typowe lokalizacje fallback (~/.local/bin, %LOCALAPPDATA%)
5. brak → ekran błędu z instrukcją instalacji (§26)
```
Health check przy starcie: `claude --version` z timeoutem 5 s. Wynik cache'owany, odświeżany przy zmianie ścieżki.

### Spawn

```ts
pty.spawn(claudeExePath, args, {
  name: 'xterm-256color',
  cols, rows,
  cwd: project.path,                 // §6: zawsze katalog projektu
  env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '3' },
  useConpty: true,
})
```

### Argumenty per tryb

| Akcja UI | argv | Uwagi |
|---|---|---|
| New Session | `['--session-id', <nowy uuid v4>]` | znamy ID **od razu**, bez zgadywania po mtime plików |
| Continue Last | `['--continue']` | ostatnia rozmowa w tym `cwd` |
| Resume | `['--resume', <sessionId>]` | |
| Fork Session | `['--resume', <sessionId>, '--fork-session']` | tworzy nowe ID, oryginał nietknięty |
| + default args z Settings | doklejane na końcu, po walidacji whitelisty | §23 |

Renderer **nigdy** nie przekazuje argv. Wysyła `{ projectId, mode: 'new'|'continue'|'resume'|'fork', sessionId? }`, main składa resztę.

### Lifecycle

- `onData` → bufor → flush co 16 ms → `pty:data:<id>` → `term.write()`
- `onExit(code, signal)` → status `Closed`, zapis kodu wyjścia, zakładka pokazuje „Zakończono (kod N)" z przyciskiem Restart
- `kill()` → `pty.kill()`; Ctrl+C to zwykły bajt `0x03` wysłany na stdin, nie osobne API
- resize: `ResizeObserver` → `FitAddon.fit()` → IPC → `pty.resize(cols, rows)`, debounce 100 ms
- crash node-pty (§26): łapiemy, oznaczamy zakładkę jako błędną, oferujemy restart — nie ubijamy całej aplikacji

### Status Running / Waiting / Closed (§20)

**Nie parsujemy TUI.** Trzy niezależne, wiarygodne źródła:
- `Closed` — proces nie żyje (twardy fakt z `onExit`)
- `Running` — dane płyną z PTY (był `onData` w ostatnich 800 ms)
- `Waiting` — proces żyje, cisza > 800 ms

To celowo prosta heurystyka. Reszta danych statusu jest twarda: `cwd` (znamy), branch (GitService), `sessionId` (nasze `--session-id` albo resume), PID (node-pty), uptime (czas od spawn).

---

## E. Wykrywanie sesji

### Źródło prawdy

`~/.claude/projects/<enc>/<uuid>.jsonl`. Claude Code pozostaje właścicielem transkryptów — **nie duplikujemy ich** (§25), trzymamy tylko cache metadanych.

### Mapowanie sesja → projekt

Kodowanie nazwy katalogu jest **stratne**, więc dekodowanie nazwy byłoby zgadywaniem. Dlatego dwa kierunki:

- **projekt → katalog** (znamy ścieżkę): liczymy `enc` z pełnej ścieżki i sprawdzamy, czy katalog istnieje. Deterministyczne.
- **katalog → projekt** (discovery): otwieramy pierwszy `.jsonl` i czytamy pole **`cwd`** ze środka pliku. Niezawodne, niezależne od kodowania nazwy.

### Odczyt metadanych bez czytania całych plików

Transkrypty potrafią mieć dziesiątki MB. Czytamy:
- **head** (~30 pierwszych linii): `sessionId`, `cwd`, `gitBranch`, `version`, `permissionMode`, pierwszy wpis `type:"user"` → **tytuł sesji** (pierwszy prompt, przycięty)
- **`stat()`**: `mtime` → data ostatniej aktywności (pewniejsze niż tail — ostatnia linia bywa wpisem sterującym bez `timestamp`), `birthtime` → data utworzenia, `size`
- reszta pliku nie jest czytana

### Cache i świeżość

Tabela `session_cache(file_path PK, mtime, size, session_id, cwd, title, git_branch, created_at, last_activity)`.
Rescan pliku tylko gdy zmienił się `mtime` lub `size`. Przy 55 projektach pierwszy pełny skan to jednorazowy koszt; potem `chokidar` obserwuje `~/.claude/projects` i aktualizuje pojedyncze wpisy na bieżąco (nowa sesja pojawia się na liście bez odświeżania).

### Nasze własne dane o sesji (§25)

Osobna tabela `session_meta(session_id PK, label, is_favorite, hidden)` — nasze nazwy i ulubione, niezależne od plików Claude. „Delete from app index" kasuje wyłącznie ten wiersz. Usunięcie prawdziwego transkryptu wymaga osobnego, wyraźnego potwierdzenia (§5).

---

## F. Image Input

### Workflow

```
Win+Shift+S → Ctrl+V w aplikacji
   │
   ├─ ClipboardService rozpoznaje typ: text | image | file-list
   │
   ├─ image → zapis do %APPDATA%/claude-session-manager/cache/images/
   │           2026-09-03_182314_a81f.png            (§13: nigdy w katalogu projektu)
   │
   ├─ ComposeBar pokazuje chip: [miniatura | nazwa | rozmiar | ×]
   │           klik w miniaturę → duży preview w modalu
   │
   ├─ dopisujesz prompt (klawiatura lub mikrofon)
   │
   ├─ Send → ImageAttachmentProvider wstrzykuje obrazy do PTY, potem tekst, potem \r
   │
   └─ cleanup: plik żyje ≥ 24 h (konfigurowalne), sprzątanie przy starcie aplikacji
              — nigdy natychmiast po wysłaniu (§13)
```

### Strategie wstrzykiwania — kaskada z fallbackiem

Claude Code ma natywny mechanizm (`~/.claude/image-cache/<sessionId>/N.png` + `[Image #N]`). Naszym zadaniem jest go **wyzwolić**, nie zastąpić. Trzy strategie, w kolejności preferencji; **wybór potwierdzamy eksperymentalnie w Etapie 3**, wynik zapisujemy w Settings:

| | Strategia | Jak | Ryzyko |
|---|---|---|---|
| **S1** | Systemowy clipboard + Ctrl+V | `clipboard.writeImage(nativeImage)` → wyślij bajt `0x16` do PTY → TUI samo czyta schowek | Zależy od tego, czy TUI na Windows czyta obraz ze schowka przy `0x16`. Daje UX **identyczny** z natywnym. |
| **S2** | Bracketed paste ścieżki | `ESC[200~` + ścieżka pliku + `ESC[201~` | Odpowiednik drag&drop pliku do terminala. Bardzo prawdopodobnie działa. |
| **S3** | Zwykły tekst ze ścieżką | wpisanie ścieżki w cudzysłowach do promptu | Zawsze działa — Claude odczyta obraz narzędziem Read. Kosztuje jedną dodatkową turę narzędziową. |

Wiele obrazów: powtarzamy wybraną strategię dla każdego załącznika, dopiero potem doklejamy tekst promptu i `\r`. Natywne `[Image #1] [Image #2]` potwierdzone w transkryptach.

Abstrakcja `ImageAttachmentProvider` istnieje właśnie po to (§12), żeby zmiana strategii nie ruszała UI.

### Trzy drogi wejścia (§9)

1. **Ctrl+V** — obsługiwane na poziomie okna, przed xterm
2. **Drag & Drop** — cały obszar terminala jest drop zone; podświetlenie ramki przy hover; PNG/JPG/JPEG/WEBP/GIF/BMP
3. **File picker** — przycisk `[+]` w ComposeBar, `dialog.showOpenDialog` z `multiSelections`

Żadna z nich nie wysyła automatycznie (§9.1).

### Logika Ctrl+V (§16) — nie zepsuć terminala

| Zawartość schowka | Zachowanie |
|---|---|
| tylko tekst | przepuść do xterm — normalny paste, bez żadnej ingerencji |
| obraz | przechwyć, dodaj załącznik, **nie** wysyłaj nic do PTY |
| lista plików, wszystkie graficzne | dodaj jako załączniki |
| lista plików, niegraficzne | wklej ścieżki jako tekst |
| obraz **i** tekst jednocześnie | obraz (Windows przy screenshotach zwykle nie ma sensownego tekstu) |
| `Ctrl+Shift+V`, `Shift+Insert` | **zawsze** tekst — awaryjne obejście |

### Obsługa błędów (§18)

Nieobsługiwany format, uszkodzony plik, obraz > 10 MB (proponujemy downscale), brak dostępu, plik zniknął przed wysłaniem, błąd odczytu schowka, błąd zapisu pliku tymczasowego. Komunikaty krótkie, w postaci toasta z jedną akcją naprawczą.

---

## G. Voice Input

### Łańcuch

```
Ctrl+Shift+Space (push-to-talk) lub klik w mikrofon
   → renderer: getUserMedia → MediaRecorder (WebM/Opus) + AnalyserNode (waveform na żywo)
   → puszczenie klawisza / drugi klik → stop
   → IPC: ArrayBuffer do main
   → ffmpeg-static: WebM/Opus → WAV 16 kHz mono
   → whisper-cli.exe -m ggml-large-v3-turbo.bin -l <auto|pl|en> -f in.wav -oj
   → JSON → tekst
   → IPC z powrotem → tekst ląduje w polu ComposeBar
   → EDYTUJESZ
   → Send → dopiero teraz tekst idzie do PTY
```

**Nigdy nie wysyłamy automatycznie po zakończeniu nagrania** (§8). Esc anuluje nagranie bez transkrypcji.

### Model i binarka

- `whisper.cpp` z akceleracją CUDA, model `ggml-large-v3-turbo` (~1.6 GB)
- Pobierane **przy pierwszym użyciu** do `%APPDATA%/claude-session-manager/models/`, z paskiem postępu i możliwością anulowania — nie zwiększamy instalatora o 1.6 GB
- Fallback na CPU, gdy CUDA niedostępna
- Settings pozwalają zmienić model (`base` / `small` / `medium` / `large-v3-turbo`) i język (`Auto` / `Polski` / `English`)
- Oczekiwana wydajność na RTX 4060: ~1 s na 10 s mowy

### Współpraca voice + image + text (§17)

ComposeBar to jedno wspólne miejsce: chipy załączników na górze, pole tekstowe pod nimi, mikrofon i Send w rzędzie akcji. Transkrypcja **dopisuje się** do istniejącego tekstu zamiast go nadpisywać. Workflow z §17 (screenshot → mikrofon → poprawka → wysłanie razem) działa bez żadnego trybu specjalnego.

### ComposeBar a terminal-first

Rozwiązanie napięcia między §15 (cienki pasek) a §10 (pole z promptem):

**ComposeBar jest zwinięty do jednej linii, dopóki nie jest potrzebny.** Domyślnie widać tylko pasek statusu: `🎤 · Dodaj obraz · ~/Projects/DI · main · ● Claude Ready`. Piszesz bezpośrednio w terminalu, jak zawsze.

Pole tekstowe rozwija się **tylko** gdy pojawi się załącznik albo transkrypcja. Po wysłaniu zwija się z powrotem. Terminal nigdy nie traci fokusu bez powodu (§15: „nie może blokować normalnej pracy terminala").

---

## H. Etapy MVP

Każdy etap kończy się czymś, co da się uruchomić i ocenić.

### Etap 0 — Fundament i weryfikacja największego ryzyka

- `electron-vite` + React + TS + Tailwind, `contextIsolation`/`sandbox`, preload API
- `node-pty` + `@electron/rebuild`, `better-sqlite3`
- **Smoke test:** prawdziwy `claude.exe` w xterm.js — kolory ANSI, polskie znaki i emoji, `Ctrl+C`, resize, permissions prompt, slash command, plan mode

**Dlaczego pierwsze:** jeśli TUI nie renderuje się poprawnie w xterm.js, cała koncepcja aplikacji upada. Sprawdzamy to, zanim napiszemy cokolwiek innego.
**Efekt:** jedno okno, jeden działający terminal Claude Code.

### Etap 1 — Projekty i sesje

- `ClaudeCliLocator` + health check + ekrany błędów (§26: brak instalacji, brak w PATH, brak logowania)
- `ProjectManager`: discovery z `~/.claude/projects`, Add/Remove/Rename/Favorite/Open Folder, wyszukiwarka
- `ClaudeSessionProvider`: skan, head-parsing, cache w SQLite, `chokidar` watcher
- `GitService`: branch
- UI: lewy sidebar projektów + panel sesji

**Efekt:** widzisz swoje 55 projektów i ich sesje z tytułami i datami. Nic jeszcze nie uruchamiasz.

### Etap 2 — Sesje w zakładkach

- `ClaudeProcessManager`: New / Continue / Resume / Fork
- Zakładki, wiele PTY jednocześnie, zamykanie i ponowne otwieranie
- StatusBar: cwd, branch, session ID, PID, uptime, Running/Waiting/Closed
- Persistencja otwartych zakładek

**Efekt:** pełny główny workflow z §33 — klikasz projekt, klikasz Resume, pracujesz w aplikacji.

### Etap 3 — Obrazy (część MVP, nie dodatek — §27)

- `ClipboardService`, `ImageAttachmentProvider`, cache z TTL i cleanupem
- **Eksperymentalna weryfikacja S1 → S2 → S3**, wybór strategii
- Ctrl+V, drag & drop, file picker, ComposeBar, chipy, modal preview, wiele obrazów
- Obsługa błędów z §18

**Efekt:** `Win+Shift+S` → `Ctrl+V` → prompt → Send → Claude widzi obraz.

### Etap 4 — Voice

- `SpeechToTextProvider` + whisper.cpp + downloader modelu + `ffmpeg-static`
- Push-to-talk, waveform, anulowanie, wybór języka
- Integracja voice + image + text (§17)

**Efekt:** mówisz prompt, poprawiasz, wysyłasz razem ze screenshotem.

### Etap 5 — Dashboard, Settings, Command Palette, dopracowanie

- Dashboard (§19), Settings — 5 sekcji (§23), Command Palette `Ctrl+K` (§22)
- Pełna obsługa błędów z §26, reopen sessions after restart
- Dopracowanie wyglądu

**Efekt:** kompletne MVP z §27.

### Poza MVP, ale architektura to przewiduje

- **Split view** (§7): `TerminalManager` trzyma drzewo layoutu paneli, nie płaską listę zakładek — dodanie podziału to zmiana w layoucie, nie w zarządzaniu procesami
- **Capture Screenshot** (§14): kolejne źródło dla `ImageAttachmentProvider`, bez zmian w reszcie
- **Sesje background** (`claude --bg` / `attach` / `logs`): osobny typ sesji w `ClaudeProcessManager`

---

## I. Czego świadomie nie robimy (§32)

- Brak własnego klienta Anthropic API — Claude Code CLI jest jedynym kanałem do modelu
- Brak parsowania TUI dla statusu — tylko twarde, wiarygodne źródła
- Brak duplikowania transkryptów — Claude Code zostaje ich właścicielem
- Brak abstrakcji „na przyszłość" poza trzema wskazanymi w planie (sesje, STT, obrazy)
- Brak split view, Capture Screenshot, sesji background w MVP
