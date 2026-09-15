# Claude Session Manager

A desktop manager for [Claude Code](https://claude.com/claude-code) on Windows. It runs the
**real** `claude.exe` inside terminals in the app — this is not an API wrapper or a custom chat
client. Anything that works in your terminal works here, because underneath it is the same
process.

> **Note:** the application interface is in **Polish**. The code, comments and this document are
> the only English-facing parts. All UI strings live in one file (`src/shared/i18n/messages.ts`),
> so translating the app is a single-file job.

What it gives you:

- **Projects and sessions at hand** — a list of directories discovered from `~/.claude/projects`,
  with each conversation's title, size, git branch and peak context.
- **Several terminals at once** — tabs, split view, restarting a finished session, restoring tabs
  after an app restart.
- **Images** — `Ctrl+V`, drag onto the window, or grab a region of the screen. The image reaches
  Claude as a native `[Image #N]` attachment, not as a path to be read back.
- **Dictation** — local whisper.cpp; recordings never leave the machine.
- **Full-text search** across every conversation (SQLite FTS5).
- **Usage analytics** computed locally from transcripts: share per project, "what ate the
  context", subscription limits at a glance.

All data stays on disk: the app reads transcripts Claude Code writes anyway and keeps its own
index in `%APPDATA%\claude-session-manager`. Nothing is sent anywhere.

---

## Requirements

| Component | Version | Notes |
|---|---|---|
| Windows | 10 or 11, x64 | Windows-only (ConPTY, NSIS installer) |
| Node.js | 22 LTS or newer | developed on 25.x; needed only to build from source |
| Claude Code | any current release | must be installed **and logged in** |
| whisper.cpp | optional | only if you want to dictate prompts |

### Claude Code

The app does not replace Claude Code — it launches the one you already have. If you don't:

```bash
npm install -g @anthropic-ai/claude-code
claude          # first run: sign in, then leave with /exit
```

Check that the system can find it:

```bash
where claude
claude --version
```

If `where claude` finds nothing but you do have the file, point at it manually under
Settings → Claude Code → custom path.

---

## Installation

### Option A — prebuilt installer

Download `Claude Session Manager Setup <version>.exe` from **Releases** and run it. The NSIS
installer lets you pick a directory and creates desktop and Start menu shortcuts. It installs
per-user, so it needs no administrator rights.

Windows SmartScreen will warn about an unknown publisher — the binary is not code-signed.
Choose "More info" → "Run anyway".

### Option B — from source

```bash
git clone https://github.com/mirekdev07/claude-session-manager.git
cd claude-session-manager
npm install
```

`npm install` does **not** rebuild native modules, and that is intentional — `node-pty` and
`better-sqlite3` ship **N-API** prebuilds that run under Electron without compilation.

Then one of:

```bash
npm run dev        # development mode with hot reload
npm run build      # typecheck + production build into out/
npm start          # preview the built version
npm run package    # NSIS installer → release/
```

After `npm run package` you get, in `release/`:

- `Claude Session Manager Setup <version>.exe` — the installer,
- `win-unpacked/Claude Session Manager.exe` — a portable build that runs without installing.

> Running `npm run dev` **from inside a Claude Code session** is worth a thought: the app clears
> the parent-session markers before starting its child process, so its own sessions record
> correctly, but the parent session is then in an unusual state. For testing, a plain terminal
> is easier.

---

## First run

1. The app scans `~/.claude/projects` and builds the list of projects and conversations. On the
   first run, with hundreds of megabytes of transcripts, the progress bar at the bottom of the
   left column runs for a dozen or so seconds. The interface stays usable meanwhile.
2. Automatically discovered projects land in the **Wykryte** (Discovered) section. Click the star
   on the ones you actually use and they move to **Przypięte** (Pinned) at the top.
3. Pick a project and press **Nowa sesja** (New session).

The usage indicator in the top bar fills in after a few seconds — the first reading has to run
`claude -p "/usage"` in the background.

---

## ⚠️ Session permissions

Every session started from the app (new, continued, resumed, forked) launches with
**`--dangerously-skip-permissions`**, so Claude never stops to ask for consent to use a tool —
it reads and writes files and runs commands on its own.

That is convenient for long stretches of work, but it means the model can modify or delete any
file you have access to, including outside the project directory. This is deliberately exposed
as a switch: **Settings → Claude Code → "Uruchamiaj bez pytań o zgodę"**. Turning it off restores
Claude Code's normal prompts.

Headless probes (`/usage`, handoff generation) do not get the flag — they run no tools.

`npm run verify:args` checks this for real: it starts a session in every mode and reads the
child's command line from the operating system instead of trusting a reading of the code.

---

## Configuration

Settings open from the gear icon in the top-right corner, or `Ctrl+K` → "Ustawienia".

**Claude Code** — detected path and version, custom `claude.exe` path, extra arguments appended
to every launch, the permission-prompt switch.

**Głos (Voice)** — whisper.cpp engine, model, speech language, CPU threads. Details below.

**Obrazy (Images)** — how an image is handed to the session (the default `bracketed-path` is the
only measured method where Claude Code creates a native attachment) and how many hours before the
cache is swept.

**Sesje (Sessions)** — system notifications, session "health" thresholds in tokens, restoring tabs
after a restart.

**Wygląd (Appearance)** — terminal font size and family.

### Dictation (whisper.cpp)

The app downloads the **model** on its own (Settings → Głos → Pobierz), but it does **not**
download the executable — you point it at your own `whisper-cli.exe`.

1. Grab a Windows build of whisper.cpp (for example from the
   [project releases](https://github.com/ggml-org/whisper.cpp/releases)) and unpack it anywhere,
   e.g. `D:\Tools\whisper`.
2. Settings → Głos → **Wskaż plik** (Choose file) → `whisper-cli.exe`.
3. Pick a model and press **Pobierz** (Download). With an NVIDIA card `large-v3-turbo` (~1.6 GB)
   is worth it; on a weaker machine use `small` or `base`.
4. Set the **speech language**. "Automatic" is unreliable on short recordings — forcing the
   language is safer.

Recording: `Ctrl+Shift+Space` (hold) or the microphone icon. The transcript lands in the text box
above the status bar — it is never sent automatically.

---

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | command palette |
| `Ctrl+Shift+F` | search across all conversations |
| `Ctrl+Shift+Space` | dictate (hold) |
| `Ctrl+V` over the terminal | image → attachment, text → ordinary paste |
| `Ctrl+Shift+C` / `Ctrl+Insert` | copy the terminal selection |
| `Ctrl+C` with a selection | copies and clears the selection; a second press interrupts Claude |
| `Ctrl+C` without a selection | interrupts Claude (normal terminal behaviour) |
| `Ctrl+Shift+A` | select the whole buffer |
| right click in the terminal | menu: Copy / Paste / Select all |
| `Enter` in the box above the terminal | sends the prompt together with attachments |
| `Esc` | cancels recording, closes preview, menus and palettes |
| middle click on a tab | closes the tab |

---

## Analytics and session health

Every session carries a health dot derived from its peak context (thresholds under Settings →
Sesje). When you resume a heavy session the app warns you and offers a **handoff** — a new session
that starts from a summary instead of hundreds of thousands of tokens. This is the only feature
that calls the model and spends quota; it runs on demand only, and you see and can edit the
summary before it is sent.

Clicking the usage indicator in the top bar shows the share per project over 24 h / 7 days /
30 days. The chart icon next to a session opens "what ate the context" — a breakdown by tool and
the largest individual results. Everything is computed locally from transcripts, incrementally,
with no API calls and no cost.

A system notification appears when a session in an inactive tab finishes work you asked for.

---

## Development

```bash
npm run verify              # every suite below
npm run verify:transcripts  # session reading against real data in ~/.claude/projects
npm run verify:storage      # SQLite schema and cache queries
npm run verify:native       # node-pty, better-sqlite3 and starting claude.exe in a PTY
npm run verify:metrics      # incremental metrics parser matches a full parse from scratch
npm run verify:usage        # /usage report parser against real CLI output
npm run verify:args         # what arguments claude actually starts with, per mode
npm run verify:inject       # which image-handoff strategy works
```

Scripts touching native modules run under **Electron's** Node
(`scripts/run-under-electron.mjs`), because `node-pty` and `better-sqlite3` are built against
Electron's ABI, not the system Node's. The tests deliberately spawn real processes and read real
transcripts — instead of mocks, they check what the user will actually see.

### Layout

```
src/
  main/       main process — PTY, session reading, images, speech, SQLite
    claude/     locating the CLI, PTY processes, transcript parsers, /usage, handoff
    images/     image cache, clipboard, injection strategies, screen capture
    ipc/        IPC channel handlers, each with zod validation
    storage/    SQLite migrations, session cache, settings
  preload/    contextBridge; the renderer never receives ipcRenderer
  shared/     IPC contract, types, validation schemas and UI strings
  renderer/   React: projects, sessions, terminals, images, voice, settings
docs/superpowers/
  specs/      architecture and design decisions
  plans/      implementation plan with measurement results
scripts/      verification scripts
```

### UI strings

The interface is in Polish. Every string (UI, main-process error messages, system notifications,
export, the handoff prompt) lives in `src/shared/i18n/messages.ts` — a key that is not there is
a compile error, not an empty label in the window. Plurals go through `Intl.PluralRules`, dates
through `toLocale*String('pl-PL')`. Translating the app means replacing that one catalogue.

---

## Troubleshooting

**"Nie znaleziono Claude Code" (Claude Code not found)** — install the CLI, sign in (`claude`),
then restart the app. If `claude` lives somewhere unusual, point at the file under Settings →
Claude Code. The app resolves the `claude.cmd` shim to the native `claude.exe` on its own, so
sessions do not run through an intermediate `cmd.exe`.

**Sessions are not saved to `~/.claude/projects`** — usually means the app was started from inside
another Claude Code session and the child process inherited the parent-session markers. The app
clears them, so this only affects older builds; if in doubt, start it from a plain terminal.

**Native module fails to load (ABI / `.node`)** — do not rebuild them by hand. The N-API prebuilds
are Electron-compatible and `electron-rebuild` destroys working binaries. If a source build is
genuinely needed, use `npm run rebuild:from-source`; the script works around the
`NoDefaultCurrentDirectoryInExePath` environment variable, which stops `winpty.gyp` from invoking
its own batch file. Compiling also needs the MSVC **Spectre** libraries — `node-pty/binding.gyp`
forces `SpectreMitigation` and Visual Studio installs do not ship them by default.

**Dictation returns English instead of your language** — set the speech language explicitly.
`whisper-cli` defaults to `en`, so on "automatic" short recordings are translated rather than
transcribed.

**No system notifications** — check that Windows focus assist is off and that notifications are
allowed for the app. A notification only fires after work you asked for, and only when the window
is unfocused or you are looking at another tab.

**A clipboard image is not added as an attachment** — under Settings → Obrazy, make sure the
`bracketed-path` strategy is selected. The other two are fallbacks and do not produce a native
attachment.

---

## License

[MIT](LICENSE).

Not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.
