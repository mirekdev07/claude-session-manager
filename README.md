# Claude Session Manager

Graficzny menedżer [Claude Code](https://claude.com/claude-code) dla Windows. Uruchamia
**prawdziwe** `claude.exe` w terminalach wewnątrz aplikacji — to nie jest wrapper wokół API
ani własny klient czatu. Wszystko, co działa w terminalu, działa tu tak samo, bo pod spodem
jest ten sam proces.

Do czego służy:

- **Projekty i sesje pod ręką** — lista katalogów wykryta z `~/.claude/projects`, a przy każdej
  rozmowie tytuł, rozmiar, gałąź gita i szczytowy kontekst.
- **Kilka terminali naraz** — zakładki, widok podzielony, restart zakończonej sesji, przywracanie
  po restarcie aplikacji.
- **Obrazy** — `Ctrl+V`, przeciągnięcie na okno albo zaznaczenie fragmentu ekranu; obraz trafia
  do Claude'a jako natywny załącznik `[Image #N]`, nie jako ścieżka do odczytania.
- **Dyktowanie** — lokalny whisper.cpp, bez wysyłania nagrań gdziekolwiek.
- **Wyszukiwanie pełnotekstowe** po wszystkich rozmowach (SQLite FTS5).
- **Analityka zużycia** liczona lokalnie z transkryptów: udział projektów, „co zjadło kontekst",
  podgląd limitów subskrypcji.

Wszystkie dane zostają na dysku: aplikacja czyta transkrypty, które Claude Code i tak zapisuje,
a własny indeks trzyma w `%APPDATA%\claude-session-manager`. Nic nie jest wysyłane na zewnątrz.

---

## Wymagania

| Składnik | Wersja | Uwagi |
|---|---|---|
| Windows | 10 lub 11, x64 | aplikacja jest wyłącznie windowsowa (ConPTY, instalator NSIS) |
| Node.js | 22 LTS lub nowszy | rozwijane na 25.x; potrzebne tylko do budowania ze źródeł |
| Claude Code | dowolna aktualna | musi być zainstalowany **i zalogowany** |
| whisper.cpp | opcjonalnie | tylko jeśli chcesz dyktować prompty |

### Claude Code

Aplikacja nie zastępuje Claude Code — uruchamia ten, który masz w systemie. Jeśli go jeszcze
nie ma:

```bash
npm install -g @anthropic-ai/claude-code
claude          # pierwsze uruchomienie: logowanie, potem wyjdź przez /exit
```

Sprawdź, że system go widzi:

```bash
where claude
claude --version
```

Jeśli `where claude` nic nie zwraca, a plik masz — ścieżkę można wskazać ręcznie
w Ustawieniach → Claude Code → Własna ścieżka.

---

## Instalacja

### Wariant A — gotowy instalator

Pobierz `Claude Session Manager Setup <wersja>.exe` z zakładki **Releases** i uruchom.
Instalator NSIS pozwala wybrać katalog, zakłada skrót na pulpicie i w menu Start.
Instaluje się dla użytkownika, więc nie potrzebuje uprawnień administratora.

Windows SmartScreen pokaże ostrzeżenie o nieznanym wydawcy — plik nie jest podpisany
certyfikatem. „Więcej informacji" → „Uruchom mimo to".

### Wariant B — ze źródeł

```bash
git clone https://github.com/mirekdev07/claude-session-manager.git
cd claude-session-manager
npm install
```

`npm install` **nie** przebudowuje modułów natywnych i tak ma być — `node-pty`
i `better-sqlite3` dostarczają prebuildy N-API, które działają w Electronie bez kompilacji.

Potem jedno z:

```bash
npm run dev        # tryb deweloperski z hot-reloadem
npm run build      # typecheck + build produkcyjny do out/
npm start          # podgląd zbudowanej wersji
npm run package    # instalator NSIS → release/
```

Po `npm run package` znajdziesz w `release/`:

- `Claude Session Manager Setup <wersja>.exe` — instalator,
- `win-unpacked/Claude Session Manager.exe` — wersja przenośna, działa bez instalacji.

> Uruchamiając `npm run dev` **z wnętrza sesji Claude Code** pamiętaj, że aplikacja czyści
> markery sesji-rodzica przed startem procesu potomnego — jej własne sesje zapiszą się
> poprawnie, ale sesja-rodzic jest wtedy w nietypowym stanie. Do testów wygodniej odpalić
> ją ze zwykłego terminala.

---

## Pierwsze uruchomienie

1. Aplikacja skanuje `~/.claude/projects` i buduje listę projektów oraz rozmów. Przy pierwszym
   razie, gdy masz setki megabajtów transkryptów, pasek postępu na dole lewej kolumny chodzi
   kilkanaście sekund. Interfejs działa w tym czasie normalnie.
2. Projekty wykryte automatycznie trafiają do sekcji **Wykryte**. Kliknij gwiazdkę przy tych,
   których używasz — wskoczą do **Przypięte** na górze.
3. Wybierz projekt i naciśnij **Nowa sesja**.

Wskaźnik zużycia limitów w górnej belce wypełnia się po kilku sekundach — pierwszy odczyt
wymaga uruchomienia `claude -p "/usage"` w tle.

---

## ⚠️ Uprawnienia sesji

Każda sesja uruchamiana z aplikacji (nowa, kontynuowana, wznowiona, fork) startuje z flagą
**`--dangerously-skip-permissions`**, więc Claude nie przerywa pracy pytaniem o zgodę na
narzędzia — sam czyta i zapisuje pliki oraz wykonuje polecenia.

To wygodne przy dłuższej pracy, ale oznacza, że model może zmodyfikować albo usunąć dowolny
plik, do którego masz dostęp, również poza katalogiem projektu. Świadomie zostało to wystawione
jako przełącznik: **Ustawienia → Claude Code → Uruchamiaj bez pytań o zgodę**. Wyłączenie
przywraca normalne pytania Claude Code.

Bezgłowe sondy (`/usage`, generowanie handoffu) flagi nie dostają — nie uruchamiają narzędzi.

`npm run verify:args` sprawdza to na żywo: startuje sesję w każdym trybie i odczytuje linię
poleceń potomka z systemu, zamiast wierzyć lekturze kodu.

---

## Konfiguracja

Ustawienia otwiera ikona koła zębatego w prawym górnym rogu albo `Ctrl+K` → „Ustawienia".

**Claude Code** — wykryta ścieżka i wersja, własna ścieżka do `claude.exe`, dodatkowe argumenty
dopisywane do każdego uruchomienia, przełącznik pytań o zgodę.

**Głos** — silnik whisper.cpp, model, język mowy, liczba wątków CPU. Szczegóły niżej.

**Obrazy** — sposób przekazywania obrazu do sesji (domyślny `bracketed-path` jest jedynym
zmierzonym, przy którym Claude Code tworzy natywny załącznik) i po ilu godzinach sprzątać cache.

**Sesje** — powiadomienia systemowe, progi „zdrowia" sesji w tokenach, przywracanie zakładek
po restarcie.

**Wygląd** — rozmiar i krój czcionki terminala.

### Dyktowanie (whisper.cpp)

Aplikacja pobiera **model** samodzielnie (Ustawienia → Głos → Pobierz), ale **nie pobiera pliku
wykonywalnego** — wskazujesz własny `whisper-cli.exe`.

1. Pobierz build whisper.cpp dla Windows (np. z [releases projektu](https://github.com/ggml-org/whisper.cpp/releases))
   i rozpakuj gdziekolwiek, np. `D:\Tools\whisper`.
2. Ustawienia → Głos → **Wskaż plik** → `whisper-cli.exe`.
3. Wybierz model i naciśnij **Pobierz**. Przy karcie NVIDIA warto wziąć `large-v3-turbo`
   (~1,6 GB); na słabszej maszynie `small` albo `base`.
4. Ustaw **Język mowy**. „Automatyczny" bywa zawodny przy krótkich nagraniach — wymuszenie
   polskiego jest pewniejsze.

Nagrywanie: `Ctrl+Shift+Space` (przytrzymaj) albo ikona mikrofonu. Transkrypcja trafia do pola
tekstowego nad paskiem statusu — nigdy nie jest wysyłana automatycznie.

---

## Skróty

| Skrót | Działanie |
|---|---|
| `Ctrl+K` | paleta poleceń |
| `Ctrl+Shift+F` | wyszukiwanie po wszystkich rozmowach |
| `Ctrl+Shift+Space` | dyktowanie (przytrzymaj) |
| `Ctrl+V` nad terminalem | obraz → załącznik, tekst → zwykłe wklejenie |
| `Ctrl+Shift+C` / `Ctrl+Insert` | kopiuje zaznaczenie z terminala |
| `Ctrl+C` z zaznaczeniem | kopiuje i czyści zaznaczenie; drugie naciśnięcie przerywa pracę Claude'a |
| `Ctrl+C` bez zaznaczenia | przerywa pracę Claude'a (zwykłe zachowanie terminala) |
| `Ctrl+Shift+A` | zaznacza cały bufor |
| prawy przycisk myszy w terminalu | menu: Kopiuj / Wklej / Zaznacz wszystko |
| `Enter` w polu nad terminalem | wysyła prompt razem z załącznikami |
| `Esc` | anuluje nagrywanie, zamyka podgląd, menu i palety |
| środkowy przycisk myszy na zakładce | zamyka zakładkę |

---

## Analityka i zdrowie sesji

Każda sesja ma kropkę zdrowia liczoną ze szczytowego kontekstu (progi w Ustawieniach → Sesje).
Przy wznawianiu ciężkiej sesji aplikacja ostrzega i proponuje **handoff** — nową sesję startującą
od podsumowania zamiast od setek tysięcy tokenów. To jedyna funkcja, która wywołuje model
i kosztuje limit; działa wyłącznie na żądanie, z podglądem i możliwością edycji przed wysłaniem.

Kliknięcie wskaźnika zużycia w belce pokazuje udział projektów w oknie 24 h / 7 dni / 30 dni.
Ikona wykresu przy sesji otwiera „Co zjadło kontekst" — rozbicie na narzędzia i największe
pojedyncze wyniki. Wszystko liczone lokalnie z transkryptów, przyrostowo, bez API i bez kosztu.

Powiadomienie systemowe pojawia się, gdy sesja w nieaktywnej zakładce skończy zleconą pracę.

---

## Rozwój

```bash
npm run verify              # wszystkie zestawy poniżej
npm run verify:transcripts  # odczyt sesji na prawdziwych danych z ~/.claude/projects
npm run verify:storage      # schemat SQLite i zapytania cache
npm run verify:native       # node-pty, better-sqlite3 i start claude.exe w PTY
npm run verify:metrics      # parser przyrostowy metryk zgodny z parsowaniem od zera
npm run verify:usage        # parser raportu /usage na prawdziwym wyjściu CLI
npm run verify:args         # z jakimi argumentami startuje claude w każdym trybie
npm run verify:inject       # która strategia przekazywania obrazów działa
```

Skrypty korzystające z modułów natywnych działają pod środowiskiem Node **Electrona**
(`scripts/run-under-electron.mjs`), bo `node-pty` i `better-sqlite3` są skompilowane pod ABI
Electrona, nie systemowego Node. Testy celowo uruchamiają prawdziwe procesy i czytają prawdziwe
transkrypty — zamiast atrapy sprawdzają to, co faktycznie zobaczy użytkownik.

### Co gdzie leży

```
src/
  main/       proces główny — PTY, odczyt sesji, obrazy, mowa, SQLite
    claude/     lokalizowanie CLI, procesy PTY, parsery transkryptów, /usage, handoff
    images/     cache obrazów, schowek, strategie wstrzykiwania, zrzut ekranu
    ipc/        handlery kanałów IPC, każdy z walidacją zod
    storage/    migracje SQLite, cache sesji, ustawienia
  preload/    most contextBridge; renderer nie dostaje ipcRenderer
  shared/     kontrakt IPC, typy, schematy walidacji i napisy interfejsu
  renderer/   React: projekty, sesje, terminale, obrazy, głos, ustawienia
docs/superpowers/
  specs/      architektura i decyzje projektowe
  plans/      plan wdrożenia z wynikami pomiarów
scripts/      skrypty weryfikujące
```

### Napisy interfejsu

Aplikacja jest po polsku. Wszystkie napisy (interfejs, komunikaty błędów z procesu głównego,
powiadomienia systemowe, eksport, prompt handoffu) leżą w `src/shared/i18n/messages.ts` — klucz,
którego tam nie ma, to błąd kompilacji, nie pusty napis w oknie. Liczba mnoga idzie przez
`Intl.PluralRules`, daty przez `toLocale*String('pl-PL')`.

---

## Rozwiązywanie problemów

**„Nie znaleziono Claude Code"** — zainstaluj CLI i zaloguj się (`claude`), a potem uruchom
aplikację ponownie. Jeśli `claude` jest w nietypowym miejscu, wskaż plik w Ustawieniach →
Claude Code → Własna ścieżka. Aplikacja sama rozwiązuje shim `claude.cmd` do natywnego
`claude.exe`, żeby nie uruchamiać sesji przez pośredni `cmd.exe`.

**Sesje nie zapisują się w `~/.claude/projects`** — zwykle znaczy, że aplikacja została
uruchomiona z wnętrza innej sesji Claude Code i proces potomny odziedziczył markery
sesji-rodzica. Aplikacja je czyści, więc problem dotyczy tylko starszych wersji; w razie
wątpliwości odpal ją ze zwykłego terminala.

**Błąd ładowania modułu natywnego (ABI / `.node`)** — nie przebudowuj ich ręcznie. Prebuildy
N-API są zgodne z Electronem, a `electron-rebuild` psuje działające binaria. Gdyby build ze
źródeł naprawdę był potrzebny, służy do tego `npm run rebuild:from-source`; skrypt obchodzi
problem ze zmienną `NoDefaultCurrentDirectoryInExePath`, przez którą `winpty.gyp` nie potrafi
wywołać własnego pliku wsadowego. Kompilacja wymaga dodatkowo bibliotek **Spectre** dla MSVC —
`node-pty/binding.gyp` wymusza `SpectreMitigation`, a instalacje Visual Studio nie mają ich
domyślnie.

**Dyktowanie zwraca angielski zamiast polskiego** — ustaw jawnie język mowy w Ustawieniach.
Domyślną wartością whisper-cli jest `en`, więc przy „automatycznym" krótkie nagrania bywają
tłumaczone zamiast przepisywane.

**Brak powiadomień systemowych** — sprawdź, czy Windows nie ma włączonego trybu skupienia
i czy powiadomienia dla aplikacji są dozwolone w ustawieniach systemu. Powiadomienie pojawia
się tylko po pracy, którą sam zleciłeś, i tylko gdy okno nie ma fokusu albo patrzysz na inną
zakładkę.

**Obraz ze schowka nie dodaje się jako załącznik** — sprawdź w Ustawieniach → Obrazy, czy
wybrana jest strategia `bracketed-path`. Pozostałe dwie są wariantami zapasowymi i nie tworzą
natywnego załącznika.

---

## Licencja

[MIT](LICENSE).

Projekt nie jest powiązany z Anthropic. „Claude" i „Claude Code" są znakami należącymi
do Anthropic.
