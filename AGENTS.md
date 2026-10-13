# AGENTS.md — rx-viewer

Instructions for AI coding agents working in this repository. If a sibling
checkout exists at `../AGENTS.md`, read it first: it holds the rules that bind
this repo to the backends. The ones that bind this repo are repeated below so
this file stands alone.

## What this is

`rx-viewer` is the single shared web frontend for `rx` (Regex Tracer): a
Svelte 4 + TypeScript + Monaco SPA for browsing, searching and inspecting very
large log files through an `rx` backend's HTTP API.

It is a standalone artifact. It builds to a static `dist/`, is published as
`dist.tar.gz` on GitHub Releases, and the backend downloads it at runtime,
caches it under `~/.cache/rx/frontend/` and serves it. One frontend, no
vendoring. From contract 2 (viewer 0.8.0) it works against rx-go only:
rx-python speaks contract 1, which this viewer refuses, and installs only
older viewers.

| Repo                    | Role                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `rx-go`                 | The focus. Reference for the HTTP wire contract. Default port 7777.                   |
| `rx-python`             | The original backend. **Paused** since 2026-10-02. Default port 7777.                 |
| `rx-viewer` (this repo) | Works against rx-go (contract 2). Refuses rx-python (contract 1) until it catches up. |

`rx-rust` also exists beside them. It is frozen. Do not target it.

## Parity rules (binding)

1. **Target the contract, not a backend.** The wire contract is rx-go's
   OpenAPI document, published at `rx-go/docs/api/openapi.json`. The wire
   types are **generated** from it into `src/lib/types.generated.ts` by
   `just gen-types`, and `src/lib/types.ts` aliases them — so they cannot
   drift. `just ci` runs `types-check` and fails when the generated file is
   stale. Never hand-edit a wire type; regenerate.
2. **Never call an endpoint that only one backend has** without a capability
   check. Both backends implement `/health`, `/v1/tree`, `/v1/samples`,
   `/v1/trace`, `/v1/index` (GET and POST) and `/v1/tasks/{id}`.
   `/v1/complexity` exists only in rx-python; this app does not call it. An
   endpoint rx-go adds while rx-python is paused is rx-go-only until
   rx-python catches up: check for it before calling it.
   The log chain routes (`/v1/logs/*`) are such: a chain feature acts only
   while `chainModeOn` (`src/lib/stores/chainMode.ts`) holds, which needs
   `backendHas('log_chains')`. So are the signature and findings routes
   (`/v1/signatures`, `/v1/findings`, `DELETE /v1/tasks/{id}`): call them
   only while `backendHas('signatures')` holds.
3. **Never hardcode signature ids, group names or ports.** A user's
   signature files add to and switch off the built-in catalogue. Drive the
   UI from the live `/v1/signatures` answer (`src/lib/stores/signatures.ts`).
4. **Respect `file_chunks`.** In a trace response `file_chunks` is a
   `{file_id: chunk_count}` map. `relative_line_number` is absolute only when
   the count is 1. `absolute_line_number` is `-1` when unknown. When it is
   unknown, resolve the position through `/v1/samples` by byte offset, which is
   always absolute.
5. **Test against rx-go before a release.** Start it with `--port=8080`, run
   the app, and exercise tree, open file, search, jump to result, index
   and a scan for findings.
   A viewer release changes behaviour for every installed backend on its
   next cache refresh. rx-python is paused and speaks contract 1, which
   this viewer refuses; record a difference between the backends in
   `../tickets/PARITY-DEBT.md`.
6. **Release order:** a viewer change that needs a new backend field ships
   after rx-go has released that field.
7. **Check the contract version.** `/health` reports `contract_version`
   (MAJOR.MINOR). `src/lib/utils/contractVersion.ts` holds the major this
   viewer supports. A different major is refused rather than misread: a
   blocking message names both versions, and `src/lib/contractGate.ts`
   holds every `/v1` request (the first ones wait for the first `/health`
   answer) until `/health`, asked every 10 s meanwhile, reports a
   supported major. Every request goes through `fetchJson`, so it passes
   the gate; do not call `fetch` for `/v1` directly. Bump it together with rx-go's `ContractVersion`.
8. **Check a feature before using it.** `/health` lists the features the
   backend serves (`features`, such as `trace_matching_flags` or
   `time_range`). Ask `backendHas(name)` (`src/lib/stores/health.ts`)
   before sending a parameter or calling an endpoint a feature names; a
   component passes `$health` so it reacts to the answer. A backend that
   lists no features has none of them, and the viewer shows nothing
   extra for it.

## Quick orientation

| Where                                                     | What                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/App.svelte`                           | Entry point and root layout                                                                                                                              |
| `src/lib/api.ts`                                          | The entire backend surface: one `api` object, `fetchJson`, `ApiError`                                                                                    |
| `src/lib/types.generated.ts`                              | Generated from rx-go's OpenAPI document — do not edit                                                                                                    |
| `src/lib/types.ts`                                        | Aliases of the generated wire types, plus the app's own types                                                                                            |
| `src/lib/stores/`                                         | `files`, `tree`, `trace`, `health`, `signatures`, `settings`, `notifications`, `version`, `layout`; `paneMemory` keeps each file tab's editor state      |
| `src/lib/utils/processContent.ts`, `editorDecorations.ts` | The editor's regex filter: hide and show rewrite the text, highlight draws decorations                                                                   |
| `src/lib/stores/chainTabs.ts`, `src/lib/utils/chain*.ts`  | Log chains: a chain's tab, its pages, zones, gutter, timeline and search marks, the files panel's chain rows and the mode switch                         |
| `src/lib/utils/urlState.ts`, `src/lib/viewState.ts`       | The view in the URL (no router): one parse/serialize table per key; URL written from stores                                                              |
| `src/lib/utils/lineSelection.ts`, `copyFormat.ts`         | The selected lines as ranges, the URL's `sel`, and the text a copy of lines or of findings puts on the clipboard                                         |
| `src/lib/utils/monacoLanguage.ts`, `monacoLogLanguage.ts` | Monaco language registration and the log grammar                                                                                                         |
| `src/components/editor/`                                  | `MonacoEditor.svelte`, `EditorPane.svelte` (paged large-file viewing), `EditorHeader.svelte` (name, line readout, chips, toolbar)                        |
| `src/components/tree/`, `search/`, `layout/`, `common/`   | Tree, search form and results, chrome (the activity bar, `Sidebar.svelte`), shared widgets                                                               |
| `src/lib/stores/filesView.ts`, `treeFocus.ts`             | The files panel's labels, value and sort; the file tree's current row and Tab stop                                                                       |
| `src/lib/stores/searchDraft.ts`, `trace.ts`               | The search form as the user left it; the search the URL names                                                                                            |
| `src/lib/utils/shortcuts.ts`, `panels.ts`                 | The one shortcut table with its scoped key handlers; the side panel's panels, which the activity bar draws                                               |
| `src/lib/actions/`                                        | Svelte actions: `tooltip`, `modal` (counts an open modal), `takeFocus`, `captureKeydown` (keys first), `measureSize` (an element's height or width)      |
| `src/lib/utils/icons.ts`                                  | The icon table (Lucide outlines); `src/components/common/Icon.svelte` draws it                                                                           |
| `src/lib/utils/treeSort.ts`, `treeRows.ts`, `treeNav.ts`  | The files panel's sort, the rows the tree shows as one list, and the tree's key rules                                                                    |
| `src/lib/utils/tabOrder.ts`, `recentSwitch.ts`            | The open tabs' strip and recent orders; the recent-tab switcher's state machine                                                                          |
| `src/lib/stores/signatures.ts`, `utils/groupStyle.ts`     | The signature catalogue and the colours of its groups (see "Signatures and findings")                                                                    |
| `src/components/findings/`, `src/lib/stores/findings.ts`  | The Findings panel and each file's findings and scans; the pure rules in `utils/findingRows.ts`, `findingsNav.ts`, `findingsPicker.ts`, `virtualList.ts` |
| `stores/editorFindings.ts`, `utils/findingsLabel.ts`      | The findings the editor marks and F8 steps through; the tree label of a scanned file and its tooltip                                                     |
| `src/lib/findingsCopy.ts`, `stores/findingTicks.ts`       | A copy of a group of findings; the ticks of the findings on the timeline (`utils/findingTicks.ts`, `components/layout/FindingTimeline*.svelte`)          |
| `vite.config.ts`                                          | Dev proxy `/v1`, `/health` → `localhost:8080`; Monaco manual chunk                                                                                       |
| `.github/workflows/`                                      | `ci.yml` (build) and `release.yml` (tag → `dist.tar.gz` release)                                                                                         |

## Build, run, test

`just` is the entrypoint. `just --list` shows every recipe.

```bash
just install                      # bun install --frozen-lockfile
just dev                          # dev server :5173, proxies /v1 and /health to localhost:8080
just build                        # production build → dist/ (+ version.json)
just package                      # dist.tar.gz + .sha256, the way a release does
just preview

just gen-types                    # regenerate the wire types from rx-go's spec
just fmt                          # prettier --write
just fmt-check                    # prettier --check (CI gate)
just typecheck                    # svelte-check
just lint                         # eslint
just test                         # vitest run

just ci                           # exactly what GitHub CI runs
just check                        # ci + package + audit
```

`just ci` is `fmt-check types-check typecheck lint test build`, in that order, and
`.github/workflows/ci.yml` runs `just ci` — the two cannot disagree.

Run a backend on the proxy port first: `rx serve --port=8080 --search-root=/var/log`
(rx-go). Bun is the package manager; Node is not used for tooling.
Every recipe runs bun from the `PATH` when it is installed and from the
`oven/bun` image when it is not (`scripts/bun.sh`, and
`scripts/with-bun.sh` for the gates, `fmt` and `gen-types`), so the gates
run on a host that keeps no JavaScript runtime. `just bun <args>` runs any
other bun command the same way, and `just shell` opens the image.

**Nothing but a fixed string is pasted into a shell line.** A recipe that
takes arguments has `[positional-arguments]` and reads `"$1"` or `"$@"`; a
computed value (the version, from a tag name) is exported and read as
`"$BUILD_VERSION"`; a workflow passes every `${{ … }}` to a `run:` script
through `env:`. A tag name may hold a quote, `;` or `$(`.
`src/lib/testing/releasePath.test.ts` fails on any other `{{…}}` in a
recipe, and on any `${{` in a workflow (`.yml` or `.yaml`) or a file
under `.github/actions` that stands outside the places GitHub hands to
no shell and no script (an `if`, an `env` value other than of a
variable whose value is code, such as `BASH_ENV` or `NODE_OPTIONS`, an
action input other than one that holds code or makes a container's
command, `script`, `command`, `cmd`, `run`, `shell`, `entrypoint` or
`args`, under any `with`, since a container action whose `action.yml`
names neither takes the last two as its command:
`EXPRESSION_PLACES`, `CODE_ENV_NAMES` and `CODE_INPUTS` in
`releasePath.ts`). Keys
compare in upper case, as the runner names an input's variable
(`Script` and `ſcript` are `SCRIPT`). It reads those files with a YAML
parser, so no spelling of a step (a flow mapping, a quoted key, an
alias, a merge key, an escape) gets past it, and refuses a file with a
line break another YAML reader may read otherwise (a lone CR, U+0085,
U+2028, U+2029). It also
checks that `release.yml` refuses a tag that is not exactly `vX.Y.Z`
before anything runs.

**`just typecheck` is green and must stay that way.** `svelte-check` reports
0 errors and 0 warnings. The a11y suppression that used to hide warnings is
gone from `vite.config.ts`; fix a warning rather than filtering it. A
`svelte-ignore` takes bare rule names on one line — put the justification in a
separate comment above, or eslint reads every word as another rule.

## Architecture notes

- Svelte 4 stores, no router. The view a link should restore lives in the
  URL: `urlState.ts` reads and writes every key from one table and is the
  only module that writes the view to `history` (`apiToken.ts` only strips
  the token); `viewState.ts` writes the URL from the stores and restores
  the stores from a URL. A component never writes the URL. A change of a
  key that is a step (open a file, run a search, show another panel)
  is a `pushState`, every other change a `replaceState`, and `popstate`
  restores the entry. `line` is the file's anchor line, whose rule is in
  `utils/anchorLine.ts`.
- Every open tab has a tab key (`utils/tabKey.ts`), held in
  `OpenFile.path`: a file's path, or `chain:<handle>` for a log chain,
  whose handle is usually its active file's path. Everything that belongs
  to a tab is keyed by it (the open tabs, their request slots,
  `paneMemory`, search matches, index follows, task polls and the file
  zones, `ftz=<zone>@<key>`), so a chain and the file at its handle never
  share state. Code that reads a file (samples, index, time range) takes
  the file's path, which is its key.
- The files store keeps two orders of the open tabs: the strip's
  (`openFiles`, which drag and drop changes) and the recent order
  (`recentTabs`, most recently used first). Every change of the store
  goes through its `update`, which follows the tabs with `followTabs`
  (`utils/tabOrder.ts`): the active tab comes first, a closed tab
  leaves, a new one joins at the end, and when the active tab closes the
  most recent remaining one becomes active. So no way of showing a tab
  (a click, a link, a jump, a chain's own steps, a key) needs code of its
  own. A chain mode switch, whose opening and closing would reorder it,
  puts each turned tab in the place of the tabs it replaced
  (`replaceInRecent` in `turnTabs`). The recent order is session state
  and stays out of the URL; a link opens with its tab first and the
  others in strip order.
- The tab strip (`components/layout/TabStrip.svelte`) is a WAI-ARIA tab
  list with automatic activation: one Tab stop on the active tab, ←/→
  round the ends, Home/End, Delete closes. A tab is a `<button
role="tab">` that also carries the drag handlers; its close button is a
  sibling inside a `role="presentation"` wrapper, `tabindex="-1"` and
  `aria-hidden`, so the tab list holds only tabs. The editor area in
  `MainContent.svelte` is the `tabpanel` every tab controls.
- The recent-tab switcher (`components/layout/RecentTabsSwitcher.svelte`,
  drawn by `App.svelte`) runs the pure state machine of
  `utils/recentSwitch.ts`. It counts as a modal dialog from the first
  Alt+Q, its list shows after `RECENT_LIST_DELAY_MS` (a quick Alt+Q draws
  nothing), and a keyup without Alt held shows the chosen tab. Esc, the
  window's `blur` and `visibilitychange` close it without a switch, and a
  tab that closes meanwhile leaves its list.
- Log chains act only while `chainModeOn` holds (`stores/chainMode.ts`:
  the "Group rotated logs" toggle button, `chains=1`, and `log_chains` in
  `/health`), and only through the `/v1/logs` routes. The mode is not
  remembered: a link without `chains=1` opens with it off. The files panel
  shows a chain's row in place of its parts (`utils/chainTree.ts`) and
  never lists the parts; they are reached by turning the mode off or from
  the parts list of the chain's tab. A chain's tab (`stores/chainTabs.ts`)
  numbers its lines by global line once the chain is ready and by each
  part's base before (`utils/chainWindow.ts`), and a link names its
  anchor as `chain`, `part` (a bare file name), `line` (in that part),
  `time` and `fp`, the fingerprint of the files it read the line in. A
  link whose `fp` is not the chain's now never reads its part's line: it
  goes by its time, or to the start, with a notice (`showChangedLink`).
  Any other link's part's line is checked against its time
  (`checkLinkLine`): an active file rewritten in place keeps the `fp`.
  The go-to box reads a global line or `part:line`
  (`parseChainLineTarget`, `utils/chainParts.ts`). Switching the mode
  turns tabs over through `stores/chainModeSwitch.ts`; a 409 is compared
  by `utils/chainChanges.ts`. A tab never shows another file's line in
  silence: every place that shows a chain's line again after its files
  may have changed (a 409, a reload, a 404, a zone change, a mode
  switch, a link through `checkLinkLine`) checks it against
  the line it knew through `checkShownLine` (`utils/knownLine.ts`, by
  text and time, a time only in the zone it was read in; `checkLine` in
  `chainTabs.ts` for a chain's tab, `fileLineNotice` for the file tab it
  becomes). A new such place uses them too. The README's "Log chains" and "Link parameters" sections
  describe what a user sees.
- Svelte 4 counts an object prop as changed at every update of its
  owner, so a `$:` statement that reads `file` reruns at each progress
  tick and scroll. Work over the held lines goes through
  `utils/memoizeLast.ts` (or a memo such as `chainZonesMemo`), and a
  component that hands an object to Monaco checks it is another object
  first (`applyViewZones`, `redrawGutter`, `isSamePaneView`).
- A tab's selected lines are `OpenFile.selectedLines`: ranges of file
  lines, 1-based and inclusive, sorted and merged, at most 100
  (`utils/lineSelection.ts`, pure). Only `files.setSelection` sets them,
  and the store cuts them at the file's last line once it knows it, so
  they live apart from the loaded window and survive paging, tab
  switches and a reload. `components/editor/selectionController.ts`
  hears the Monaco editor (mouse down for the modifiers and the gutter,
  `onDidChangeCursorSelection`, mouse up or key up to commit, Esc in a
  capture `keydown`). The line numbers are the controller's: Monaco does
  not select there (`selectOnLineNumbers: false`), and a gesture there
  takes its lines from the pointer. A drag in the text is Monaco's
  selection, read as whole lines, and it stays, so Cmd/Ctrl+C copies the
  text. Monaco's selection never shows a line that is not selected: a
  gesture on the line numbers, Esc and a selection set elsewhere
  (`followSelection`, as by the header's ×) collapse it to a cursor.
  With no text selected, Cmd/Ctrl+C copies the selected lines
  (`emptySelectionClipboard: false`, so a cursor never copies its line).
  It never commits a selection change Monaco makes itself (a page load,
  the API, Monaco's own Esc); the pane wires it to the store.
  `selectionDecorations` (`utils/editorDecorations.ts`) draws them,
  `SelectionChip.svelte` in the header counts them and
  copies them (`selectionCopy.ts`: one samples request, the text from
  `utils/copyFormat.ts`, within 8 MiB). The URL holds them as `sel`; a
  chain's tab holds them in its own numbers and the URL names each range
  in its part (`utils/chainSelection.ts`), split at part edges, moved
  when the tab numbers its lines anew and dropped when the chain's files
  change or a link's `fp` is not the chain's.
- The status bar's equivalent command comes from `stores/commands.ts`,
  which records the backend's `cli_command` of each answer to a user
  action (search, file window, index). Record a new action's
  command there; never build a command in the viewer. The one exception
  is a copy of findings: the backend's command of a findings answer
  names the picker's selection, not the group or signature a header
  narrows it to, so `findingsCopyCommand` (`findingsCopy.ts`) writes
  `rx trace --signatures=group:<g> -B <N> <path>` (a signature's id, or
  the picked signatures for Copy all), quoting each word as rx quotes
  its own commands. A group's command names the whole group, not the
  picked signatures in it, and `rx trace` has no flag for the filter
  text, so with a picker that narrows the group or with a filter text
  the command lists more findings than the copy holds.
- Every keyboard shortcut and mouse gesture is a row of one table,
  `src/lib/utils/shortcuts.ts`. The key handlers ask it whether a key is
  theirs and the help dialog (Cmd/Ctrl+/) lists it, so add a shortcut
  there, never as a bare `event.key` check. A handler calls
  `preventDefault` only when it acted. A row belongs to a scope
  (`SHORTCUT_SCOPES`, in the help's order: anywhere, panels, open file
  tabs, activity bar, files panel, Size/Date switch, file tree, search
  panel, search field, findings panel, tab strip, then the editor's and
  the dialogs');
  the help lists a scope
  only once it has a row. The README's table lists the same rows, and a
  test fails when the two differ: change both in one commit.
  - A scope's handler is a pure function that is given only the actions
    of the controls that call it, and matches the ids it is given:
    `handleGlobalKey` (`KeyboardShortcuts.svelte`, on the window in the
    capture phase, since Monaco binds Cmd/Ctrl+K and Cmd/Ctrl+/ itself),
    `handleFileTabsKey` (`KeyboardShortcuts.svelte` too: Alt+], Alt+[ and
    Alt+X, acting only while no modal dialog is open),
    `handleRecentTabsKey` (`RecentTabsSwitcher.svelte`, on the window in
    the capture phase: Alt+Q, Alt+Shift+Q and its Esc),
    `handleFilesPanelKey` (`FilesToolbar.svelte` and `TreeHeader.svelte`,
    each with its own controls' actions, acting only while
    `filesPanelShown` holds and no modal dialog is open) and
    `handleSearchPanelKey` (the search panel's root element, wherever the
    focus is inside it), and `handleFilePaneKey` (`EditorPane.svelte`, on
    the pane in the capture phase through `use:captureKeydown`
    (`actions/captureKeydown.ts`), outside text fields: `:` and
    Cmd/Ctrl+G, F8 and Shift+F8, before Monaco's own bindings of them).
    An action, not `onMount`, so a component test hears the keys too.
    Each tab of the strip checks its rows with `isShortcut`. The file
    tree has one `keydown` on `role="tree"`:
    it checks the chord rows with `isShortcut`, then gives the other keys
    to `treeKeyAction`. An Alt+letter or Alt+digit row matches by `code`,
    because a Mac's Option changes `key` (`©`, `¡`, `Dead`, `‘` for
    Option+], `œ` for Option+Q). The keys
    shown on a Mac (`⌥G`) or elsewhere (`Alt+G`) come from
    `shortcutKeys(id, platform)`.
  - The one exception to the one-table rule: Esc hides a tooltip through
    a local chord (`HIDE_KEY` in `actions/tooltip.ts`), not through a
    row. The help lists what a key does in the viewer, and the tooltip's
    Esc does nothing else; it does not cancel the key, so a dialog around
    the trigger still closes on the same press.
- The side panel is an activity bar (`components/layout/ActivityBar.svelte`)
  and a host (`Sidebar.svelte`) with three panels: Files (Alt+1), Search
  (Alt+2) and Findings (Alt+3). `PANELS` (`utils/panels.ts`) has a row per
  panel (id, label, icon, the shortcut row that shows it) and
  `Sidebar.svelte` has its view in `PANEL_VIEWS`, so a further panel is
  one row and one view, plus its `SidebarTab` value, its `tab=` value in
  `TAB_PARAM_VALUES` and its focus request in `FOCUS_REQUESTS`. Every
  panel stays mounted and the ones not shown are `hidden`: the tree
  keeps its open folders, the search form its unsent edits, the
  findings list its loaded pages, and a link's search runs on load
  whichever panel is shown. A modal dialog is therefore never drawn
  inside a panel, where a panel switch or Back would hide it while
  `modalOpen` still counts it: a panel that opens one has `App.svelte`
  draw it. A component shows a panel through `showPanel(id, focus)` or
  `clickPanelButton(id)` (`stores/layout.ts`); only `restoreView` sets
  `sidebarTab` itself, from a link.
  A focus request (`treeFocusRequested`, `searchFocusRequested`,
  `findingsFocusRequested`, `editorFocusRequested`,
  `tabStripFocusRequested`) is a flag that the target answers after the
  next update and resets, so a panel is drawn before it takes the
  focus. An editor pane mounted with the request
  raised answers once it is drawn, and while its Monaco editor is not
  ready it holds the focus and hands it on when the editor is.
  A switch of tabs by key (Alt+], Alt+[, Alt+X, an Alt+Q switch) goes
  through `stores/tabFocus.ts`: it notes where the focus was (the editor
  area, the tab strip, elsewhere, nothing) and raises the request of
  that place after the switch, so the focus returns to the new tab's
  editor or the strip's active tab and stays in a panel. The switcher
  notes the place at its first Alt+Q, before its list takes the focus.
  The `tab` key of the URL holds the panel.
- Every element with `aria-modal="true"` carries `use:modal`
  (`actions/modal.ts`), which counts the dialog in `modalOpen`
  (`stores/layout.ts`) while it is in the page. While `modalOpen` holds,
  the panel keys, Cmd/Ctrl+K, Cmd/Ctrl+B, the open file tab keys and
  the keys of the activity bar, the tab strip, the file tree, the
  Size/Date switch and the files and search panels do nothing and are
  not cancelled (the recent-tab switcher's own Alt+Q is the one key that
  acts in its own dialog), so the keyboard stays with
  the dialog; a key handler outside a dialog checks it on its first
  line, and a button whose Enter would act behind a dialog checks it in
  its click handler. A source test (`actions/modal.test.ts`) fails
  when a component has more `aria-modal="true"` than `use:modal`, or the
  other way round. The shortcut list's Close button carries
  `use:takeFocus` (`actions/takeFocus.ts`): it takes the focus when the
  list opens and gives it back to the control that had it when the list
  closes.
- Icons are rows of `ICONS` in `utils/icons.ts`: Lucide 24×24 outlines as
  data (a tag and its attributes), drawn by `components/common/Icon.svelte`
  with `<svelte:element>`, never `{@html}`; its `data-icon` names the
  icon drawn, for tests. The file's header holds
  Lucide's ISC notice, the Lucide version the shapes come from, and the
  MIT notice of Feather, from which `search`, `arrow-up` and `arrow-down`
  derive. The header is a legal comment (`/*! … */`), which the build
  keeps in the bundle; a plain `/** */` comment would be dropped. A
  shape from another source brings its own notice and version into that
  header.
- `use:tooltip={{ label, shortcut?, detail?, placement? }}`
  (`actions/tooltip.ts`) is the viewer's tooltip. It shares one
  `#rx-tooltip` element, appears after 500 ms of hover and at once when
  the keyboard focuses the control (`:focus-visible`), and shows the keys
  of the shortcut row it names; give a control a tooltip that names its
  row rather than writing keys in its label. It sets text with
  `textContent` only, so a label may hold a file name.
- `stores/filesView.ts` holds what the files panel shows: its labels, its
  value column and its sort. The URL holds all three (`labels=0`,
  `show=date`, `sort=<key>-<dir>`) and `viewState.ts` keeps them equal.
  The panel orders every folder's rows itself: `utils/treeSort.ts` sorts
  (folders first, names without case and with numbers read as numbers,
  an unknown value last) and `shownChildren` (`utils/chainTree.ts`)
  applies it with the chain rows. `utils/treeRows.ts` lists the rows on
  screen, depth first, as `VisibleRow`s, and `utils/treeNav.ts` decides
  from those rows what a key does (`treeKeyAction`, `fallbackFocus`);
  both are pure, and the tree's view and its ARIA levels read the same
  list. `stores/treeFocus.ts` joins them to the page: the current row,
  the visible rows and the tree's one Tab stop. When the focused row goes
  (a folder closes, a mode or a sort moves it) `fallbackFocus` names the
  row that takes its place.
- `stores/searchDraft.ts` holds the search panel's form (patterns,
  toggles, Only opened files, and the max box's text as typed) and
  outlives the panel. `searchRequest` (`stores/trace.ts`) is the search
  the URL names. A run builds it from the draft, after `parseMaxResults`
  has read the max: 1 to 10,000, refused and never changed. A link or Back
  fills the draft from it (`draftFromSearch`), except for the search
  already run, so an unsent edit survives a step through files.
- Monaco is code-split into its own chunk (about 3.3 MB, 860 KB gzip). Check the
  bundle delta before adding Monaco features.
- Large files are never loaded whole. The editor requests windows through
  `/v1/samples` by line range or byte offset. A feature that needs "the whole
  file" is wrong by construction. An open file holds at most `HELD_PAGES`
  pages (`src/lib/utils/slidingWindow.ts`): a page loaded at one end drops
  lines at the other, and the editor keeps the file line at the top of the
  view in place when lines come or go above it.
- Content is set with Monaco `setValue`, never `innerHTML` or `{@html}`. Log
  content is untrusted.
- The app ships with no third-party runtime requests. Do not add a CDN script
  or stylesheet; bundle it.
- The API token (a backend started with `RX_API_TOKEN`) arrives as
  `#token=…` in the link, is moved to `sessionStorage` and stripped from the
  address bar on load (`src/lib/utils/apiToken.ts`), and is sent as
  `Authorization: Bearer …` on every request. `sessionStorage`, not memory
  only: a script in the page could read either (it could wrap `fetch`), and
  memory would lose the token on every reload. Not `localStorage`: it would
  outlive the tab. A 401 opens `TokenPrompt.svelte`.

## Signatures and findings

rx-go finds places worth noticing in a file (tracebacks, secrets, SQL,
bursts) by named signatures, built in or from the user's YAML files, and
caches each file's findings per signature.

- **Gates.** The viewer reads contract major 2 only, so rx-python
  (contract 1) is refused. Every signature and findings call
  (`api.getSignatures`, `getFindings`, `startFindingsScan`, `cancelTask`)
  goes through `fetchJson` and only while `backendHas('signatures')`.
- **The catalogue** (`stores/signatures.ts`): `loadSignatures` asks
  `GET /v1/signatures` once; `App.svelte` calls it when `/health` lists
  `signatures`, and it does nothing before that, on a backend without the
  feature or once loaded (a failed ask is tried again at the next call).
  `signatures` holds every loaded signature in catalogue order, opt-in
  ones and the built-ins a user file disabled (`disabled_by`) included,
  the groups and the load errors. `defaultSetIds` names the default set:
  `default` and no `disabled_by`.
- **The group palette** (`utils/groupStyle.ts`):
  `groupStyle(group, groups)` gives a group's `className` and `color`. A
  group takes the colour at its catalogue `order` (13 colours, the
  built-in groups first); a group past the 13th, or one the catalogue
  does not name, gets one by a hash of its name, among the colours no
  listed group takes while any are left. `installPaletteStyles`
  (App's mount) adds the `group-palette-<n>` classes; each sets
  `--rx-group-color` for the app's theme (`.dark`) and, more
  specifically, for Monaco's (`.vs`, `.vs-dark`), so build a group's
  look on that variable.
- **Findings.** `GET /v1/findings` (`FindingsQuery`) reads the cache and
  never scans. A scan is `POST /v1/findings`, which answers a task to
  follow with `getTaskStatus`; `cancelTask` stops it (a 409 for one that
  ended), and a poll ends on its `cancelled`. Follow a scan with
  `watchTask` (`utils/taskPolling.ts`), never `taskPolls`, which is keyed
  by tab and holds index tasks only (its result is a line index).
- **Finding text.** Every text of a finding the viewer shows or copies
  comes from `GET /v1/findings`, masked and clipped by the backend: the
  `excerpt` of each finding, and `lines` and `before` with `text=true`.
  Never from `/v1/samples`, which gives the file's lines unmasked (the
  editor, a search's matches and a copy of selected lines show the
  file as it is; masking is for findings). The editor's finding hover
  is built from the catalogue, never from the file.
- **The findings store** (`stores/findings.ts`) keys everything by the
  file's path: `findingsByFile` holds each file's summary (the last
  `GET /v1/findings` for the picker's selection and the filter `q`), its
  `fileSummary`, its scan, its current finding and its loaded pages.
  Each summary request comes with a summary of every signature
  (`signatures=all&limit=1`), from which `fileSummary` holds what the
  file holds, whatever is picked: its state, K of the M default
  signatures current, and N, the findings of every current entry
  (`utils/findingsSummary.ts` `fileSummaryOf`), and `fileCounts` keeps
  that read's `counts`, the findings of every current signature, picked
  or not, from which the group view lists the hidden ones; it also
  labels the file in the tree (`tree.markFindings`), so the panel and
  the label never show different numbers. A scan is followed there, not in a component,
  so it outlives a tab switch and the file's tab; only `cancelScan`
  stops it, and its end records its `cli_command` and reads the
  summaries again. When the summary then lists every requested signature
  missing although the result checked them all, the backend kept nothing
  (rx-go answers a file that grew during the scan without caching it):
  the scan's end is `notKept` and the panel says why, with no second
  scan. When a POST joined another request's scan that left a
  requested signature out, the store posts once more for what is still
  missing. Pages hold `FINDINGS_PAGE_SIZE` findings; each list (the line
  list `LINE_LIST`, or one signature's in the group view) is a sparse
  array as long as the list, and each page is asked once per summary,
  never while a new summary is on its way. A signature's pages are read
  with the panel's selection and `signature=<id>` (`pageQuery`); a
  signature the choice hides (`hidesSignature`), which the selection
  leaves out, is read with `signatures=all` instead.
  The panel drops the findings of closed tabs (`forgetFindings`), never
  those of a running scan.
- **The Findings panel** (`components/findings/`) asks only while it is
  shown: when it shows a file, and again when the picker's choice or the
  filter changes. The picker's choice is `AppSettings.findingsPicker`
  (`null`: the default set), parsed by `parseSettings`, never in the URL;
  `utils/findingsPicker.ts` turns it into the request's selection
  (`selectionOf`: none for the default set, `all`, or ids). Its state
  line says `fileSummary` ("partial · K of M default signatures · N
  findings"); its scan button speaks of the selection sent ("Scan N
  missing", from its `missing`). While a scan runs, the button and the
  large Scan button are gone, and `FindingsScanProgress.svelte` draws
  the bar, the share read and Cancel in a row of their own under the
  picker's row (`data-findings-controls`), so Cancel never shares the
  width with the picker. The list measures its own height
  (`measureHeight` in `actions/measureSize.ts`) to know which rows are
  on screen.
  `findings_by=group` is `ViewState.findingsBy` (`stores/layout.ts`
  `findingsBy`). The picker and the ⋯ menu are popovers, not dialogs:
  they carry no `use:modal`, and the panel opens no modal dialog. The
  list is a virtual list of fixed-height rows (`ROW_HEIGHT_PX` in
  `FindingsList.svelte`, the rows on screen from `utils/virtualList.ts`)
  with one Tab stop that is always drawn; its key rules are
  `utils/findingsNav.ts`, under the `findingsPanel` scope,
  silenced by `modalOpen`. Group and signature headers end in
  `FindingsHeaderActions`: a Copy slot and then an eye slot, each of one
  fixed width and drawn even when empty, so the Copy buttons stand in
  one column and the eyes in the next, whatever a row's name or depth.
  Its `header-actions` slot is for the action on the whole header, which
  the panel fills with Copy, the `copy` icon with a `use:tooltip` that says what
  it copies (`tabindex="-1"`, so the list stays one Tab stop; its
  `mousedown` is cancelled, so a press leaves the focus and the list's
  keys where they were; its click stops there, so the header neither
  opens nor closes; the list leaves Enter and Space to a control in
  `data-header-actions`, so a Copy that a script or assistive
  technology focuses copies on Enter, and the arrows still move; a
  click in it never reaches the row, a disabled Copy's included),
  and they carry their group's palette mark, so the group view is the
  legend of the timeline's ticks.
- **Hiding a signature** is unchecking it: the picker's choice stays
  the one setting, so nothing else stores what is hidden. Each header of
  the group view has an eye (`FindingsEye.svelte`, which
  `FindingsHeaderActions` draws after Copy, in `data-header-actions`;
  `aria-pressed` true, mixed or false). A click on it, or
  Space on the focused header (`findingsToggleShown`), stores
  `choiceAfterEye` (`utils/findingRows.ts`): the picker's own
  `toggleSignature`, or `toggleGroup` over the signatures the group
  lists that a choice can pick (the group row's `ids`), then
  `pickerChoice`, so the presets keep working. A group's eye
  (`groupCheckState` over those `ids`) says what the rows under it
  show; a member without findings in the file is not listed and the
  eye leaves it as it is, so the group's box in the picker, which
  covers every member, can read otherwise. The marks, F8, the ticks and the scan follow `panelFilters`,
  so a hidden signature leaves them with no code of its own.
  `groupRows(counts, shown, pages, collapsed, catalogue)` lists from
  `fileCounts`: each shown signature with findings (`shownSignatures`:
  the picked ones, and ids the catalogue does not name that the summary
  lists, which have no eye) and each active signature the choice hides
  that holds findings, `hidden`, in its place; a hidden signature never
  scanned for the file is not listed. A hidden row is greyed
  (`data-hidden`, `opacity-50` on all but its eye), its findings are
  inert (a click gives the focus only, Enter does nothing, never
  current) and its header's Copy is off (`FindingsHeaderCopy.svelte`:
  the disabled button lets the pointer through to a `data-copy-off`
  frame whose tooltip says to show the findings to copy them); a group
  is greyed when every signature it lists is hidden. While the group
  view lists a hidden signature (`holdsHiddenFindings`), the panel
  draws the list under its notice (nothing picked, not scanned, or "No
  finding of the picked signatures"), so the eyes stay reachable.
- **Copy a group** (`findingsCopy.ts`): `copyFindings(path, target)`,
  the target a group, a signature or all, with the panel's filters, the
  ⋯ menu's `copyLinesBefore` and `text=true` (see "Finding text").
  Pages of `FINDINGS_COPY_PAGE_SIZE` (10,000), each with `max_bytes`
  set to what is left of `COPY_BUDGET_BYTES`
  (8 MiB), until the list ends, a finding comes back `lines_truncated`
  or the budget is spent: the backend's budget counts per request.
  `formatCopyBlocks` (`utils/copyFormat.ts`, shared with the selection
  copy) writes `==> file:A-B  <signature>  (N lines before) <==` with
  the lines before the finding has, and a last line when the copy is cut
  (`total`: the answer's) or a signature is capped (`cap`). The command
  it records is the one exception to commands from the backend: the
  viewer writes it (see the status bar's equivalent command above).
- **Ticks on the timeline**: `TimelineBar` draws `FindingTimelineLayer`
  on a file's track (never a chain's), so a hidden timeline asks
  nothing. The layer measures the track (`measureWidth`,
  `measureHeight`), takes a new
  width after `RESIZE_WAIT_MS`, and asks `ticksRequestOf`
  (`stores/findingTicks.ts`): `ticks=<width>` (at most 4,000),
  `limit=1`, the panel's filters and `file_tz` when the tab reads the
  file in a chosen zone, keyed by the width, the filters, the zone, the
  axis and the file's `fileSummary` and tree label, and none for a file
  known to hold no findings (`holdsNoFindings`, shared with the editor
  marks). `FindingTimelineMarks` draws `tickMarks` (`utils/findingTicks.ts`):
  one tick per group per column at the middle of the column's instants
  placed with `fractionOf`, so it sits where the axis prints its
  findings' times; a lane per group present, in catalogue order, placed
  by `tickBox(trackHeight, lanes, lane)` in px (5 px tall, at least 3,
  the lanes overlapping when they do not fit, always inside the track;
  the browser lays the track out, so the size is a pure function with a
  table test rather than CSS `calc`). A tick stands for its group's
  findings in its column: its title counts that group's signatures
  there, and its click is `openTickFinding(path, firstLine, signatures)`:
  `signature=` the group's signatures in the column,
  `after_line=<first line - 1>` and `limit=1` with the panel's filters,
  then `openFinding`. A tick's `pointerdown` stops there (the track would
  scrub and jump on release). Ticks are buttons with `tabindex="-1"`.
- **In the editor** (`stores/editorFindings.ts`): `requestWindowFindings`
  asks `GET /v1/findings` with `lines=<window>`, `limit=10000` and the
  panel's filters (`panelFilters` in `stores/findings.ts`: the picker's
  selection and `q`) once per key: the window, the filters, the file's
  `fileSummary` state and N, and its tree label. The newest answer wins
  (`LatestRequestMap`). It asks nothing for a chain tab, with nothing
  picked, or for a file known to hold none (its `fileSummary` says none,
  or, before one, the tree lists it without a label). The pane passes
  `$markInputs`, so a new choice, filter, summary or label asks again.
  `findingDecorations` (`utils/editorDecorations.ts`) draws
  `PaneView.findings` with `PaneView.signatures`: a glyph-margin bar
  (`monaco-finding-bar` and the group's palette class; Monaco joins every
  glyph class of one line into one element, so the bar is a `::before`
  beside a search match's glyph), minimap and scrollbar marks in
  `groupColors`, a hover built from the catalogue only (escaped
  Markdown, so a user's description draws no image or link), and a box
  around `value_start`–`value_end`, only where it lands exactly: bytes
  turned into UTF-16 columns over the window's lines as the file has them
  (`PaneView.fileText`, `fileLinesSource` over `file.lines`), the BOM's 3
  bytes taken off on line 1 (rx-go counts it, Monaco drops it), no box
  after a lone `\r`, U+240D or U+FFFD on the line, nor while a hide or
  show filter rewrites the text. `paneDecorations` keeps the finding
  marks (`memoizeLast`) while the findings, window, catalogue and lines
  are the same, so a click that changes the selection builds none of
  them again. `FileBadges` draws the label through `FindingsBadge.svelte`
  only for a labelled file, so only those rows hear the findings store.
  `stepFinding` is F8 and Shift+F8: `after_line` or `before_line` of the
  anchor line with `limit=1`, then `openFinding`, or a notice at the end.
  The pane's capture-phase handler (`handleFilePaneKey`) stops the key
  only when the step acted, so Monaco's own F8 (its next problem) never
  runs in a file's tab and still does in a chain's.
- **The tree label** (`FileBadges`, `utils/findingsLabel.ts`): from
  `TreeEntry.findings`, which `tree.markFindings` changes when a scan
  ends; the editor header falls back to the store's `fileSummary` for a
  file the tree does not list, and shows none in a chain tab. The
  tooltip says K only from a `fileSummary` whose state and N equal the
  label's (the listing can be newer), "some of the M" otherwise, and
  "opt-in signatures only" for K = 0; hovering asks nothing.
- **Scan for findings** (`scanForFindings.ts`) is the tree menu's item on
  a text file (`treeMenuItems(entry, { canScanFindings })`, never on a
  chain row): open the file, `showPanel('findings', false)`, then
  `startScan` with `pickedIds` of the picker's choice.
- **The old analysis is gone.** `category`, its link key, is in
  `RETIRED_PARAMS` (`utils/urlState.ts`): a link that holds it opens
  without it, and the address bar drops it.

## Coding standards

- TypeScript strict; `svelte-check` must pass with zero errors.
- Keep components under about 400 lines; split by responsibility (search,
  go-to-line, filter, rendering).
- Every request that can be superseded (file window loads, searches) carries an
  `AbortController` and a sequence number; a stale response is dropped.
- Do not suppress warning classes globally. Fix or annotate accessibility
  findings one by one.
- Long flags use `=` in docs and printed commands.
- Comments describe the code as it is. No references to plans or review rounds.

## Testing

- Unit tests with `vitest` for the pure modules: `processContent.ts`,
  `urlState.ts`, `format.ts`, `monacoLogLanguage.ts`, `api.ts` with a stubbed
  `fetch`, and the line-number resolution logic in the search flow.
- Tests run in Node. A component test mounts the Svelte component in
  jsdom: its first line is `// @vitest-environment jsdom`
  (`src/components/editor/RegexFilterPanel.test.ts`). jsdom does no
  layout, so a test gives a scroll position or size itself.
- In a component test `onMount` does not run (vitest resolves `svelte`
  to its server entry), so a window listener belongs in
  `<svelte:window>`. A test that needs it mocks `svelte` with an
  `onMount` that runs its function in a microtask, once the component
  is in the page, as `MonacoEditor.test.ts` does to read the options
  the editor is created with (ESLint forbids `svelte/internal`). A test whose component reaches `$lib/stores`
  imports `$lib/testing/matchMediaStub` first.
- Names: `describe(unit) / it("scenario returns expected")`.
- Some tests read the repository's own files and fail when a rule is
  broken: `src/lib/testing/releasePath.test.ts` (recipes and workflows),
  `src/lib/actions/modal.test.ts` (modal dialogs) and the README table
  test in `src/lib/utils/shortcuts.test.ts`.
- End-to-end smoke against a real backend is manual until a Playwright job
  exists; record the manual check in the pull request or final report.
- The completion gate before you say "done":

```bash
just ci
```

Paste the output.

## Git, changelog, release

- Commit: one imperative sentence, capital, full stop, no prefix, no body.
- Version comes from the git tag. `package.json` stays at `0.0.0`; the build
  stamps `git describe` into `dist/version.json`, which the header reads
  (`scripts/version-json.sh`, which refuses a version with a character
  other than letters, digits, `.`, `_`, `+` and `-`).
  A release stamps the tag it was started for instead
  (`just --set version "$TAG" package`) and fails unless `version.json`
  holds exactly that tag. Do not commit a real version.
- Release: `just release-dry patch` previews, `just release patch` runs the
  gates, promotes the changelog, commits and tags, then prints the push
  commands rather than running them. Pushing the tag runs `release.yml`,
  which builds with a frozen lockfile, packages `dist/` with `index.html` at
  the archive root, and publishes `dist.tar.gz` with its `.sha256` sidecar.
  Backends verify that sidecar and only install a version inside their
  supported range, so a minor bump needs a matching backend release.
- **A minor bump is not released until rx-go accepts it.** Each backend
  hardcodes the window it was checked against — `MaxViewerVersionExclusive`
  in `rx-go/internal/frontend/compat.go` and `MAX_VIEWER_VERSION_EXCLUSIVE`
  in `rx-python/src/rx/frontend_manager.py`. Publish a viewer past the
  window and that backend refuses to install it: `rx serve` comes up with
  no interface and redirects to its API docs, which is how v0.3.0 shipped
  on 2026-09-03 against backends that stopped at 0.2.x. Widen rx-go's
  constant, with its test, and release rx-go before you cut the viewer
  release. rx-python's window stays where it is while it is paused; add a
  `../tickets/PARITY-DEBT.md` row instead.
- rx-go keeps a real bundle as a test fixture
  (`rx-go/internal/webapi/testdata/rx-viewer-v0.2.0-dist.tar.gz`). If the bundle
  layout changes, refresh that fixture in rx-go.
- Never push. Working files go in the gitignored `.claude/`.

## Gotchas

- A partially installed `node_modules` makes `svelte-check` fail with
  `Cannot find module`; re-run `bun install`. A `node_modules` copied from
  macOS does not work on Linux.
- `dist/` and `dist.tar.gz` are gitignored; the workflow produces them.
- Relative asset paths must stay relative; backends serve the app from a cache
  directory with an SPA fallback.
- On the macOS host the recipes run bun in Docker, in a colima VM that
  shares the host's files over sshfs and caches each file's size for up
  to 20 seconds. In that time a file the host made longer reads in the
  container cut off at its old size. So no gate reads the sources
  through the mount: every gate (`fmt-check`, `types-check`,
  `typecheck`, `lint`, `test`, `build`), `fmt` and `gen-types` run on a
  snapshot of the repo that `scripts/bun-on-snapshot.sh` pipes to the
  container (through `scripts/with-bun.sh`), with rx-go's OpenAPI
  document in it and `node_modules` mounted read-only. `just ci` runs
  all six gates in one container on one snapshot. A gate's commands live
  in `scripts/gates.sh`, which `scripts/with-bun.sh` runs directly where
  bun is on the `PATH`; add or change a gate there. The snapshot script
  writes back only the files the command changed, and only when the
  host's copy still equals the snapshot
  (otherwise it prints `not written:` and fails; run it again), and
  `build` replaces the host's `dist/` when it succeeds. `dev`,
  `test-watch`, `preview`, `install` and `just bun` still use the
  mount, so right after an edit they can see the old text.
- Backend responses use `file` and `pattern` IDs (`f1`, `p1`) with lookup maps
  in the response, not paths, to keep payloads small.

## Open work

Audit tickets live in `../tickets/` (outside this repo). Read
`../tickets/README.md` before taking one. Do not create a "known issues" list
in this file; file a ticket.

## What NOT to do

- Do not hardcode signature ids, group names or ports.
- Do not call an endpoint one backend lacks without a capability check.
- Do not build a finding's text from `/v1/samples`; it is not masked.
- Do not hand-edit `types.generated.ts` or write a wire type by hand — run
  `just gen-types`.
- Do not treat `relative_line_number` as absolute when `file_chunks` is not 1.
- Do not load a whole file into the editor.
- Do not add CDN scripts or styles.
- Do not use `{@html}` or `innerHTML` for file content.
- Do not commit a real version into `package.json`.
- Do not silence a warning class in the build config.
