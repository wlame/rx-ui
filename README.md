# RX Viewer

The web interface of RX (Regex Tracer), a tool for searching, indexing and
reading very large text files: logs of gigabytes, sometimes code.

## Overview

The viewer is a static single-page app that an `rx` backend serves:

- [rx-go](https://github.com/wlame/rx-go), the Go backend. The viewer is
  built and tested against it.
- [rx-python](https://github.com/wlame/rx-python), the original Python
  backend, on PyPI as `rx-tool`. Its development is paused. It speaks
  contract 1, which this viewer refuses; it installs only older viewers.

The viewer targets the HTTP contract, not a backend. Its wire types are
generated from rx-go's OpenAPI document, and it checks the backend's
contract version before it sends any `/v1` request (see
[The API it calls](#the-api-it-calls)).

## Intended use

rx is built for **internal use on a trusted network. It is not intended to
be exposed to the internet.**

`rx serve` has no identity system: no users, no sessions, no TLS. Reach it
over loopback, a VPN, an SSH tunnel or an authenticating reverse proxy.

rx-go can require one shared token on every `/v1` request (`RX_API_TOKEN`).
The viewer takes the token from the link it is opened with,
`http://loghost:7777/#token=…`, keeps it for the browser tab
(`sessionStorage`), removes it from the address bar, and sends it as
`Authorization: Bearer …`. When the backend answers `401`, the viewer asks
for the token. The token crosses plain HTTP in clear text, so it does not
replace TLS. rx-python has no token support.

The viewer fetches nothing from a third party: everything it needs is in
the bundle, and a `Content-Security-Policy` in `index.html` keeps it that
way.

## Features

- **Activity bar** at the window's left edge: a button for each panel of
  the side panel (Files, Search, Findings) and one for the keyboard
  shortcuts. A click on the shown panel's button hides the side panel.
  Alt+1 or Cmd/Ctrl+Shift+E shows Files, Alt+2 or Cmd/Ctrl+Shift+F shows
  Search and Alt+3 shows Findings, each with the focus in it. A panel
  keeps its state while another is shown.
- **Tooltips with the keys.** A control of the activity bar, the files
  panel's toolbar and column header, or the search options line shows
  its name and its shortcut after half a second of hover, and at once
  when the keyboard focuses it. Keys are written as the platform prints
  them: `⌥G` on a Mac, `Alt+G` elsewhere. Esc hides the tooltip.
- **File tree** of the backend's search roots. Its toolbar groups rotated
  logs into chains (Alt+G), shows or hides the labels of the rows (the
  compression, index, findings and chain marks; Alt+L), and switches the
  value right of each name between the size (a folder's item count) and the
  modification time in the browser's time zone (Alt+V). The column
  header under it sorts each folder's rows by name (Alt+N) or by the
  value shown (Alt+S), and a second click or key press reverses the
  order; folders come first, and names with numbers sort by number
  (`app.log.2` before `app.log.10`). The link keeps each choice. The
  tree works from the keyboard as one Tab stop: arrows, Home and End,
  PageUp and PageDown, Enter to open, typing a name to go to it, and Esc
  back to the open file. A file the backend marks as not text is not
  opened.
- **Tabs** for the open files, reordered by drag and drop. Each tab keeps
  its own filter bar and scroll position. Closing the active tab shows
  the tab used before it. Alt+] and Alt+[ go through the tabs, Alt+Q
  back to the tab used before (held, through all of them as last used),
  and Alt+X closes the tab shown. The tab strip works from the keyboard
  as one Tab stop: ← and → show the tab beside, Home and End the first
  and the last, Delete or Backspace closes the tab.
- **Paged reading of large files.** The editor never loads a whole file:
  it asks `/v1/samples` for windows of 1,000 lines as you scroll and holds
  at most five of them. Line numbers are the file's own, also in gzip and
  seekable-zstd files.
- **Go to a line of the file** with `:` or Cmd/Ctrl+G, or jump to the end.
- **Select lines** in the open file with the mouse or the keys (see the
  table below): whole lines, in up to 100 ranges per tab. The editor
  header counts them, "3 ranges · 21 lines", with Copy (the copy icon)
  and × (clear). Copy, or Cmd/Ctrl+C (without Shift) in the editor while
  no text is highlighted, asks the backend for every range in one samples request
  and copies each range under a header that names the file and its lines,
  `==> app.log:120-134 <==`, an empty line between ranges, at most
  8 MiB in whole ranges; the recent commands record the request's
  command. A drag in the text keeps the editor's highlight, so
  Cmd/Ctrl+C then copies the text dragged over. A tab keeps its
  selection while the editor loads other pages, and the link holds it
  as `sel`. In a log chain's tab each part's lines get a header of their
  own, and Copy works once the chain is ready. Cmd/Ctrl+click in the
  text adds a cursor; a link in the text opens with Alt+click.
- **Search** with one or more regex patterns over files or directories,
  through `/v1/trace`. One line under the patterns holds the options:
  match-case, whole-word and regular-expression toggles when the
  backend's contract has them (Alt+C, Alt+W, Alt+R), Only opened files
  with the number of opened files (Alt+O), and the most matches to find,
  a whole number from 1 to 10,000 (a search with any other value is
  refused, never changed). The panel keeps unsent patterns and options
  while Files is shown. A result opens its file at the match; a line
  number the backend could not know is resolved by byte offset.
- **Regex filter** on the open file: hide or show the matches (or their
  captured groups), or highlight them. Hidden text shows in a hover.
- **Find in the loaded lines** (Cmd/Ctrl+F, Monaco's own find).
- **Syntax highlighting** by file extension through Monaco, with a log
  grammar for logs and unknown file types. It is off by default for files
  of 1 MB and more, and can be switched per file. Invisible characters and
  word wrap can be switched per file as well.
- **Index.** The files panel's context menu builds or rebuilds the line
  index of a text file (Index, or Re-index once indexed); a plain file
  also gets its index on first use. On a backend that serves signatures,
  the menu of a text file also scans it for findings.
- **Index or scan a folder.** A folder's context menu has "Index all
  files" and, on a backend that serves signatures, "Scan all files for
  findings" with the Findings panel's picked signatures. Each asks
  first ("Scan every file under logs/?"), then runs one task over every
  file under the folder and its subfolders, one file at a time, skipping
  the files already up to date and those that are not text. The
  folder's row shows how far it is ("scanning 12/214", "indexing 3/40",
  "stopping…" after Stop), its menu offers Stop while it runs, and a
  notification says how it ended ("Scanned 210 files under logs/,
  skipped 3, failed 1"); the labels of the folder's open rows then
  show what it did. The status bar's equivalent command shows the
  task's own command (`rx index /var/log/app --recursive --threshold=0`,
  `rx scan /var/log/app --recursive --signatures=…`) as soon as it
  starts, as it does for the index and the scan of one file.
- **Findings.** On a backend that serves signatures (rx-go 0.8.0 and
  later), the Findings panel lists the places in the open file that the
  backend's signatures found: tracebacks, secrets, SQL statements and
  more. The editor marks them, F8 and Shift+F8 step through them, the
  timeline ticks them in their groups' colours, a group of them copies
  to the clipboard, a yellow label in the tree says which files were
  scanned, and the tree's context menu scans a file. See
  [Findings](#findings).
- **Log chains.** On a backend that serves them, the rotated files of one
  log (`app.log`, `app.log.1`, `app.log.2.gz`, …) open as one text, in
  time order: see [Log chains](#log-chains).
- **The URL holds the view.** A link or a reload reopens the file at its
  line, with its highlighting, filter and selected lines, the panel
  the side panel shows, the files panel's chain mode, labels, value and
  order, the findings panel's order, and the search. Back and Forward
  step through the files opened, the searches run and the panels
  switched in the activity bar. See
  [Link parameters](#link-parameters).
- **The equivalent command.** The status bar shows the `rx` command the
  backend reports for the last answer, with a copy button (the copy
  icon) and a list of recent commands, each with its own copy button. An
  index or a scan started from the files panel or the Findings panel
  shows its task's command (`rx index`, `rx scan`) as soon as it starts.
  A copy of findings records the `rx trace` command that lists them (see
  [Findings](#findings)).
- **Themes**: system, light and dark for the app (each click on the
  header button changes the look: it switches between system and the
  theme the system does not show), and a choice of editor themes.

### Keyboard shortcuts

Cmd/Ctrl+/ lists every shortcut in the app. They are:

| Where                                    | Keys                         | Action                                                                                                            |
| ---------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Anywhere                                 | Cmd/Ctrl+K                   | Go to the search pattern field                                                                                    |
| Anywhere                                 | Cmd/Ctrl+B                   | Show or hide the sidebar                                                                                          |
| Anywhere                                 | Cmd/Ctrl+/                   | Show or hide the shortcut list                                                                                    |
| Anywhere                                 | Esc                          | Close the shortcut list                                                                                           |
| Panels, from anywhere                    | Alt+1 or Cmd/Ctrl+Shift+E    | Show the files panel and go to the file tree                                                                      |
| Panels, from anywhere                    | Alt+2 or Cmd/Ctrl+Shift+F    | Show the search panel and go to the first pattern field                                                           |
| Panels, from anywhere                    | Alt+3                        | Show the findings panel and go to its list                                                                        |
| Open file tabs, from anywhere            | Alt+]                        | Show the next tab of the strip (after the last, the first)                                                        |
| Open file tabs, from anywhere            | Alt+[                        | Show the previous tab of the strip (before the first, the last)                                                   |
| Open file tabs, from anywhere            | Alt+Q                        | Hold Alt: go back through the tabs as last used; releasing Alt shows the chosen tab                               |
| Open file tabs, from anywhere            | Alt+Shift+Q                  | Hold Alt: go forward through the tabs as last used                                                                |
| Open file tabs, from anywhere            | Alt+X                        | Close the tab shown and show the tab used before it                                                               |
| In the activity bar                      | ↓ or ↑                       | Move down or up through the panel buttons                                                                         |
| In the files panel, while it is shown    | Alt+G                        | Group rotated logs: on or off                                                                                     |
| In the files panel, while it is shown    | Alt+L                        | Show labels: on or off                                                                                            |
| In the files panel, while it is shown    | Alt+V                        | Show the size or the date of each file                                                                            |
| In the files panel, while it is shown    | Alt+N                        | Sort by name, or reverse a sort by name                                                                           |
| In the files panel, while it is shown    | Alt+S                        | Sort by the size or date shown, or reverse that sort                                                              |
| On the Size/Date switch                  | ← or →                       | Choose the value before or after the chosen one                                                                   |
| In the file tree                         | ↓ or ↑                       | Go to the next or the previous row                                                                                |
| In the file tree                         | →                            | Open the folder, or go to its first row                                                                           |
| In the file tree                         | ←                            | Close the folder, or go to the folder that holds the row                                                          |
| In the file tree                         | Home or End                  | Go to the first or the last row                                                                                   |
| In the file tree                         | PageDown or PageUp           | Go one panel height down or up                                                                                    |
| In the file tree                         | Enter or Space               | Open the file, or open or close the folder                                                                        |
| In the file tree                         | Type a name                  | Go to the next row whose name starts with the letters typed                                                       |
| In the file tree                         | Esc                          | Go back to the open file                                                                                          |
| In the search panel                      | Alt+C, Alt+W, Alt+R          | Switch match case, whole word, regular expression                                                                 |
| In the search panel                      | Alt+O                        | Switch Only opened files                                                                                          |
| In a search pattern field or the max box | Enter                        | Run the search                                                                                                    |
| In the findings panel                    | ← or →                       | On the By line/By group switch: choose the other order                                                            |
| In the findings panel                    | ↓ or ↑                       | In the list: go to the next or the previous row                                                                   |
| In the findings panel                    | Home or End                  | In the list: go to the first or the last row                                                                      |
| In the findings panel                    | →                            | By group: open the group or signature, or go to its first row                                                     |
| In the findings panel                    | ←                            | By group: close the group or signature, or go to the one that holds the row                                       |
| In the findings panel                    | Enter                        | In the list: open the finding, or open or close the group or signature                                            |
| In the findings panel                    | Space                        | By group: hide or show the findings of the group or signature                                                     |
| On the open-file tabs                    | → or ←                       | Show the next or the previous tab, round the ends                                                                 |
| On the open-file tabs                    | Home or End                  | Show the first or the last tab                                                                                    |
| On the open-file tabs                    | Delete or Backspace          | Close the tab and show the tab used before it                                                                     |
| In the open file                         | `:` or Cmd/Ctrl+G            | Go to a line of the file; in a log chain's tab, see below                                                         |
| In the open file                         | F8                           | Go to the next finding below the line, among those the findings panel lists                                       |
| In the open file                         | Shift+F8                     | Go to the previous finding above the line, among those the findings panel lists                                   |
| In the open file                         | Cmd/Ctrl+F                   | Find in the lines loaded in the editor                                                                            |
| In the open file                         | Click a line number          | Select that line                                                                                                  |
| In the open file                         | Drag                         | Select the lines the drag touches, in the text or over the line numbers                                           |
| In the open file                         | Shift+click a line number    | Extend the last selected range to that line                                                                       |
| In the open file                         | Cmd/Ctrl+click a line number | Add that line to the selection, or take it out when it is selected                                                |
| In the open file                         | Cmd/Ctrl+drag                | Add the lines the drag touches to the selection                                                                   |
| In the open file                         | Shift+↑ or Shift+↓           | Extend the selection from the cursor, as whole lines                                                              |
| In the open file                         | Esc                          | Clear the selected lines                                                                                          |
| In the open file                         | Cmd/Ctrl+C                   | Copy the selected lines, when no text is selected in the editor                                                   |
| In the go-to-line box                    | Enter                        | Jump to the typed line                                                                                            |
| In the go-to-line box                    | Esc                          | Close the go-to-line box                                                                                          |
| In the editor filter field               | Enter                        | Apply the filter to the open file                                                                                 |
| In the editor filter field               | Esc                          | Close the filter bar (an applied filter stays)                                                                    |
| On the timeline bar                      | ← or →                       | Move the time by 1/200 of the bar, to a whole second                                                              |
| On the timeline bar                      | Shift+← or Shift+→           | Move the time by 1/20 of the bar, to a whole second                                                               |
| On the timeline bar                      | Home or End                  | Move the time to the start or the end of the bar                                                                  |
| On the timeline bar                      | Enter                        | Go to that time in the open file (also in the Go to time box)                                                     |
| On the timeline bar                      | Esc                          | Put the time back where the open file is                                                                          |
| On the timeline bar                      | Drag or click                | Go to the time under the pointer when the button is released                                                      |
| In the picker of a file's time zone      | ↓ or ↑                       | Move down or up through the listed zones and the filter field                                                     |
| In the picker of a file's time zone      | Enter                        | In the filter field: read the file in the first listed zone or the typed offset                                   |
| In the picker of a file's time zone      | Esc                          | Close the picker and keep the zone                                                                                |
| While a panel is open                    | Esc                          | Close the recent commands, the list of a log chain's parts, or the findings panel's signature picker or more menu |
| While a panel is open                    | Alt+Esc or Esc               | Close the list of recently used tabs and stay on the tab shown                                                    |

While a dialog is open (the shortcut list, the API token prompt, the
notice of a backend the viewer cannot read), the keys that show a panel
or the sidebar, Alt+1, Alt+2, Alt+3, Cmd/Ctrl+Shift+E or F, Cmd/Ctrl+K
and Cmd/Ctrl+B, do nothing: the keyboard stays with the
dialog, so Cmd/Ctrl+K does not close the shortcut list; Esc or
Cmd/Ctrl+/ does. Alt+G, Alt+L, Alt+V, Alt+N and Alt+S act only while the
files panel is shown and no dialog is open; otherwise the key is left to
the browser. Alt+G acts only on a backend that serves log chains. Alt+C,
Alt+W, Alt+R and Alt+O act wherever the focus is in the search panel, a
pattern field or not, while no dialog is open; a toggle that is disabled
leaves the key to the browser (the match toggles on a backend that takes
no match options, Only opened files while it is off and no file is open).

Alt+], Alt+[ and Alt+X act from anywhere, a text field or the editor
too, while no dialog is open: Alt+] and Alt+[ go through the tabs in the
order of the strip, round the ends, and Alt+X closes the tab shown and
shows the tab used before it. With one tab open, Alt+] and Alt+[ leave
the key to the browser. The browsers keep their own tab keys (Ctrl+Tab,
Ctrl+PageUp and PageDown, Cmd/Ctrl with a digit, Cmd/Ctrl+W), so the
viewer does not use them.

After a switch by key (Alt+], Alt+[, Alt+X or Alt+Q) the focus goes back
to where it was: from the editor to the editor of the tab now shown,
from the tab strip to the tab now active, also when Alt+X closed the
focused tab. In a panel it stays where it is, and with nothing focused
nothing takes it.

Alt+Q goes back to the tab used before, the way an operating system
switches windows. Hold Alt and press Q: after a quarter of a second a
list of the open tabs shows, the tab shown first and then the others as
they were last used, with the tab used before chosen. Each further Q
chooses the entry after it, Shift+Q the one before, round the ends, and
releasing Alt shows the chosen tab; a click on an entry shows it too. A
quick Alt+Q shows the tab used before without drawing the list. Esc, or
switching to another window, closes the list and stays on the tab
shown. While Alt is held after Alt+Q, the viewer's other keys wait. The
order of use is not part of the link: a link opens with its tab first
and the others in the order of the strip.

The file tree is one Tab stop. Tab enters it on the row that had the
focus last, else on the open file's row, else on the first row, and Tab
again leaves it; Alt+1 goes to the same row. Moving never opens a file:
Enter or Space does. Letters typed within half a second make one name,
and the same letter typed again goes on to the next row that starts with
it. Esc goes back to the open file or chain, when one is open. A key
with Ctrl, Cmd or Alt is never the tree's.

The tab strip is one Tab stop too, on the tab shown. With a tab focused,
← and → show the tab beside it, round the ends, Home and End the first
and the last tab, and Delete (or the Backspace key, which a Mac prints
as "delete") closes it and shows the tab used before it. The keyboard
reaches each tab's close button through Delete only; the button is not
a Tab stop.

Alt+3 has no second key: the browsers keep most Cmd/Ctrl+Shift letters
for themselves. Firefox on Linux takes Alt+1 to Alt+8 for its own tabs;
there, the activity bar's buttons show the panels. On a Mac, F8 and
Shift+F8 usually need fn held (see [Findings](#findings)).

The table in the app is generated from `src/lib/utils/shortcuts.ts`, and a
test fails when this table lacks one of its keys or holds one it lacks.

## Findings

The Findings panel (Alt+3) lists the findings of the file in the active
tab: the places where a signature of the backend's catalogue matched.
The backend keeps them in a cache per file and signature, apart from the
line index; the panel reads that cache and never scans unless asked.

The text of a finding, wherever the viewer shows or copies it (the
excerpt in the list, the lines of a copy and the lines before them),
comes from the backend's findings answers, `GET /v1/findings`, with
`text=true` for a copy. On a server that masks secrets
(`rx serve --mask-secrets` or `RX_MASK_SECRETS`; off by default) the
backend masks it before it answers: a secret value reads like
`AKIA************`, and a line of a private key's body reads
`[masked, N bytes]`. The viewer never builds a
finding's text from the file's lines (`/v1/samples`). Masking is for
findings only: the editor, a search's matches and a copy of selected
lines show the file as it is. rx-go's documentation (Concepts /
Signatures, "Masking") gives the whole rule.

- **State line**: the file's name and how far it is scanned, whatever is
  picked, in the same numbers as its label in the tree: "full · 42
  findings" when every signature of the default set has scanned it,
  "partial · 3 of 64 default signatures · 45 findings" when only some
  signatures have (opt-in ones count among the findings, not among the
  default signatures), or "not scanned". The findings counted are those
  of every signature the cache holds for the file, picked or not.
- **Signatures picker**: the button "Signatures: Default (64)" opens a
  checklist of the signatures, group by group. A group's box picks or
  drops the whole group and shows a dash when the group is partly
  picked; the presets Default, All and None and a filter box sit above
  it. Opt-in signatures (those outside the default set) are marked, and
  so are the signatures the cache already holds for this file (✓). The
  choice is the viewer's own, kept in the browser with the other
  settings and never in the link; Default follows the catalogue. The
  panel lists and scans only the picked signatures.
- **Scan**: "Scan N missing" scans the picked signatures the cache does
  not answer; "Up to date" when there are none. While a scan runs, a
  row under the picker shows a bar of the share of the file read and
  Cancel, which stops it; a cancelled scan writes nothing. The ⋯ menu holds Rescan (every picked signature
  again), Copy all, and how many lines before each finding a copy holds
  (0 to 3). A scan belongs to its file: it runs on while another tab is
  shown, and also when its tab is closed; when it ends, the file's label
  in the tree and the panel show what it found. When the backend already
  ran a scan of the file (another request's), the panel joins it, and
  afterwards scans what that scan left out. When the backend keeps
  nothing of a scan that completed, as for a file that grew while it was
  read, the panel says the file changed while it was scanned: scan again
  when it is quiet. A file nothing picked has scanned yet shows a large
  Scan button, hidden while a scan runs.
- **List**: By line lists the findings in line order: the group's colour,
  the line or lines, the signature's name and the finding's excerpt,
  the start of its first line. By group lists them under each group and
  signature, with their counts; a signature's findings load when it is
  opened, and a capped signature says "showing 10,000 of 48,210". The
  filter box narrows the list to the findings whose excerpt or
  signature name holds what is typed. Only the rows on screen are
  drawn, and they load page by page as the list scrolls.
- **Open a finding**: a click or Enter selects the finding's lines in the
  editor and goes to its first line; the link then holds `sel` and
  `line`.
- **Hide and show**: By group, each group and signature header has an
  eye at its right end, after its Copy button, so the eyes stand in one
  column and the Copy buttons in the column before it. A signature's eye hides its findings (the eye
  shuts) or shows them again: it unchecks or checks the signature's box
  in the picker, so the eye and the box always agree, and a Default
  choice becomes the list of the signatures still picked. A group's eye
  speaks of the signatures listed under it, as their rows do: open while
  all of them are shown, shut while none is, faint while some are; a
  click hides them all when all are shown, and shows them all otherwise.
  It leaves the group's other members (those without findings in the
  file) as they are, so the group's box in the picker, which covers
  every member, can still read partly picked. Space on a header does
  what its eye does. A hidden signature is not listed By line, has no
  marks in the editor, F8 and Shift+F8 pass over it, it has no ticks on
  the timeline, and "Scan N missing" does not scan it. By group it stays
  in its place, greyed, with its count, also when nothing is picked, so
  its eye can show it again: it still opens to list its findings, but a
  click or Enter on one of them opens nothing, and its Copy is off, with
  a tooltip that says "Show the findings of Python traceback to copy
  them". When none of the picked signatures has a finding, the notice
  says "No finding of the picked signatures." above the hidden ones. The
  group view lists a hidden signature only when the cache holds findings
  of it for the file; one never scanned for the file is not listed.
- **Keys**: the list is one Tab stop. ↑ and ↓ move, Home and End go to
  the ends, Enter opens; By group, → opens a group or signature (or goes
  into it), ← closes it (or goes to the one above) and Space hides or
  shows it. Esc closes the picker and the ⋯ menu.
- The panel says why it lists nothing on a backend without signatures,
  on a log chain's tab (findings are per file: open one of its parts), and
  for a file that is not text.
- **In the editor**: each finding the panel lists that touches the
  loaded lines has a bar in the margin left of the line numbers, in its
  group's colour, a mark on the minimap and the scrollbar, and a box
  around its value on its first line (the key a secret signature found,
  for instance). A hover on the bar names the signature, its level, the
  finding's lines and the signature's description. The marks follow the
  picker and the filter, and come again when the editor loads other
  lines or a scan ends. They give no line a background, which belongs to
  the selected lines, and a log chain's tab shows none. A value is boxed
  only where the box lands exactly: not while a hide or show filter
  rewrites the text, and not when the line holds a lone carriage return
  or a byte that is not UTF-8 before the value; the bar and its hover
  stay. On line 1 of a file that starts with a byte order mark, the box
  allows for the mark, which the editor does not show.
- **F8 and Shift+F8** in the editor open the next finding below the line
  and the previous one above it, among those the panel lists, as a click
  in the list does. At either end a notice says "No more findings below"
  or "No more findings above". A Mac keyboard sends F8 only with fn held,
  unless its function keys are set to work as standard keys; without fn
  the key plays or pauses media.
- **Labels in the tree**: a file the cache holds findings for has a
  yellow label with its findings count, beside its other labels in the
  files panel and in the editor header. It is filled when every
  signature of the default set scanned the file, and an outline when
  only some did; opt-in signatures count among the findings, never
  towards a filled label. Its tooltip says "Scanned with all 64 default
  signatures: 42 findings." or "Scanned with 3 of 64 default signatures:
  45 findings. Open Findings to scan the rest." (before the panel has
  read the file, "some of the 64"; with only opt-in signatures, "opt-in
  signatures only"). A scan changes the label at once. Show labels off
  (Alt+L) hides it in the files panel; the editor header shows it with
  the file's other labels.
- **Scan for findings** in a text file's context menu in the files panel
  opens the file, shows this panel and scans the file with the picker's
  choice, as the panel's Scan button does. "Scan all files for findings"
  in a folder's menu scans every file under it with the picker's choice
  (see [Features](#features), "Index or scan a folder").
- **Copy**: By group, each group and signature header has a Copy button
  (the copy icon; its tooltip says what it copies, "Copy the findings of
  the group traceback"), and the ⋯ menu's Copy all copies every finding
  the panel lists. A
  copy takes the findings the panel lists under it (the picker's choice
  and the filter) and puts each on the clipboard under a header with its
  lines and signature, and with the lines before it that the ⋯ menu
  chose (0 to 3, one by default), an empty line between findings:

  ```
  ==> app.log:120-134  python-traceback  (1 line before) <==
  2026-10-10 12:00:01 ERROR job 7 failed
  Traceback (most recent call last):
  …
  ```

  The header names the lines before only when the finding has some (a
  finding on line 1 has none). The text is the backend's, masked as
  said above. A copy holds at most 8 MiB, in whole findings; when the
  findings do not all fit, its last line says
  "[37 of 120 findings copied: the copy stops at 8.0 MB]". A signature
  that stores fewer findings than it found (the backend keeps the first
  10,000 by default) copies those it stores, and the last line says
  "(of 48,210 found, 10,000 stored)". A notification says what was
  copied: "Copied 120 findings (1.2 MB)". The recent commands record
  an `rx trace` command for the copied findings, which the viewer
  writes itself: `rx trace --signatures=group:traceback -B 1 app.log`
  for a group, `--signatures=python-traceback` for a signature, and the
  picked signatures for Copy all (`--signatures=default` for the default
  set); `-B` is left out with no line before. A group's command names
  the whole group, and the filter text has no `rx` flag, so with a
  picker that leaves out some of the group's signatures, or with a
  filter, the command lists more findings than the copy holds. The
  headers' Copy buttons and eyes are not Tab stops, so the list stays
  one; when a screen reader focuses one, Enter or Space presses it and
  the header stays as it was. Copy all is in the ⋯ menu, which the
  keyboard reaches.

- **Timeline ticks**: the timeline bar of a file marks where its
  findings are in time: a thin, short tick in the group's colour for
  each group with findings in a column of the bar's pixels, each group
  on a line of its own; with many groups the lines overlap, and every
  tick stays 5 px tall. The group view's headers carry the same
  colours, so the panel reads as the legend. The ticks show the
  findings the panel lists (the picker's choice and the filter), also
  while the panel is hidden, and come again when the bar's width
  changes, when a scan changes what the file holds and when the file is
  read in another zone (the zone control at the left of the bar), so a
  tick sits where the bar prints its findings' time. A tick stands for
  its group's findings in its column: a hover says "3 findings at
  12:00:01: python-traceback ×2, java-exception ×1", the count of each of
  the group's signatures there, at the time of the column's middle, where
  the tick sits (a column spans the file's time divided by the bar's
  width, so on a long file its findings can lie a little before or after
  that time). A click opens the group's first finding in the column, as
  a click in the list does. A finding without a time has no tick, and a
  file whose time range the backend cannot read (a compressed file
  before its index) has none.

## Log chains

A log chain is the set of files one rotated log leaves in a directory
(`syslog`, `syslog.1`, `syslog.2.gz`, …, or `app-2026-10-01.log.gz` and
`app.log`), read as one text with the oldest line first. The backend finds
the chains by their file names and orders the parts by their timestamps;
the viewer shows what it answers. Chains need a backend whose `/health`
lists the `log_chains` feature (rx-go); with any other, nothing below
shows.

**Chain mode.** The "Group rotated logs" toggle in the files panel's
toolbar (or Alt+G) turns it on; it is off by default. The link holds it as
`chains=1`; a link without it opens with the mode off, whatever mode was
chosen before. With the mode on, each folder shows one row per chain in
place of its parts, with its name, `chain · N` (its parts), its size,
`idx` once every part but the active file is indexed, and marks for
missing or unreadable parts, a chain of more than 10,000 parts, and an
invalid chain. With the date shown, a chain's row shows the newest
modification time of its parts. Every file that is not a part stays
listed. The parts themselves are not listed: turn the mode off to see
them, or open the parts list in the chain's tab. A click or Enter opens
the chain's tab; the row's menu indexes or re-indexes the parts. Turning
the mode off turns each chain's tab into the file tab of the part that
holds its line, at that line; turning it on turns the file tabs of parts
into their chain's tab at the same line.

**The chain's tab.** Opening a chain starts the index builds of its
parts. Until they end the chain is _pending_: the tab shows each part's
own line numbers, muted, and pages within one part, then into the next.
Once it is _ready_ the gutter shows the chain's global line numbers, and
the tab stays on the same line. Every second part's numbers are in a
second colour. A line of text between two parts names the part below it
with its times and its lines, and marks a time gap or a missing part; it
is no line, so it moves no number, mark or jump. The caption reads
`syslog [3/12]`, where 3 is the part of the top line. A row under the
header shows the chain's state, lines, time range and index progress,
and a parts list whose entries go to a part's first line. The status
bar's equivalent command is the `rx logs samples` command of the lines
shown, with each part's `rx samples PART --lines=A-B` under it.

**Keys and jumps.** In a chain's tab the go-to box (`:` or Cmd/Ctrl+G)
takes a line of the chain (`123456`) or a line of a part
(`syslog.3.gz:500`). The timeline bar spans the chain, with a tick where
each part starts, a band over each time gap and a dot where missing
parts would be; it, the Go to time box and the timestamps stash jump
once the chain is ready. The zone button sets a zone for the chain alone.

**Search.** With the mode on, a search covers the same folders as log
chains (`/v1/logs/trace`). A match reads `syslog:123456`, its line in the
chain, with `syslog.3.gz:500`, its part's line, beside it (only the part's
line while the chain is pending); a click opens the chain's tab there.

**Rotation.** When the chain's files change on disk while its tab is open
(the backend answers 409), a notice says how ("renamed 2, new 1,
removed 1"), and the tab reloads and finds its line again by its time and
text; a notice says so when the line's text is not found again, and what
the view shows instead. The search marks of the tab are dropped (search
again). A chain that is invalid after the change, or no chain any more,
becomes the file tab of the file that held the line, or closes with a
notice when that file is gone. Switching the mode checks the files first:
a chain's tab finds its line in the renamed file before it becomes a
file tab, and a file tab's line is looked for by its time and text when
the chain shows other text at that line. Every time a tab shows its line
again (after a change of the files, a reload in another zone, the end of
the chain's indexing, a mode switch) it checks the line against the one
it showed, by its text and its time, or by either one when the other is
not known (a time read in another zone is not known): another line
leaves the screen and the line is looked for by its time, with a notice
when it is not found. A file tab a chain's tab becomes says so
when the file holds other text at the line, or no longer reaches it.

## Link parameters

The address bar holds the view; a link or a reload opens the same view.
An unknown or invalid value is read as absent. `category`, which viewers
before contract 2 wrote, is ignored, and the address bar drops it.

| Parameter                                     | What it holds                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `file`                                        | The active file's absolute path                                                                                            |
| `chain`                                       | The active log chain's handle: its folder and name, `/var/log/syslog`                                                      |
| `part`                                        | With `chain`: the file name of the part that holds the line, `syslog.3.gz`                                                 |
| `line`                                        | The line the view is anchored on; with `part`, the line in that part                                                       |
| `time`                                        | The time the file jumped to, or a chain's line time, `2026-10-03T14:00:00.123Z`                                            |
| `fp`                                          | With `chain`: the fingerprint of the chain's files the line was read in, 16 hex digits                                     |
| `sel`                                         | The selected lines as `rx samples --lines=` writes them, `120-134,200`; in a chain, `syslog.3.gz:120-134`                  |
| `highlight`                                   | `1` or `0`: syntax highlighting on or off; absent, the file's size decides                                                 |
| `filter`, `filter_mode`                       | The editor's regex filter and what it does: `highlight` (default), `hide` or `show`                                        |
| `tab`                                         | The panel the side panel shows: `files`, `search` or `findings`; absent, Search for a link that holds a search, else Files |
| `findings_by`                                 | `group`: the Findings panel lists by group; absent, by line                                                                |
| `chains`                                      | `1`: chain mode on; absent, off, whatever mode was chosen before                                                           |
| `labels`                                      | `0`: the files panel hides the labels of its rows; absent, it shows them                                                   |
| `show`                                        | `date`: the files panel shows each row's modification time; absent, its size                                               |
| `sort`                                        | The files panel's order: `name-desc`, `size-asc`, `size-desc`, `date-asc` or `date-desc`; absent, `name-asc`               |
| `regexp`                                      | A search pattern, once per pattern                                                                                         |
| `max_results`, `only_opened`                  | The search's cap (1 to 10,000, default 100) and "Only opened files"                                                        |
| `ignore_case`, `word_regexp`, `fixed_strings` | The search's matching toggles                                                                                              |
| `offsets`                                     | `1`: the search results show byte offsets                                                                                  |
| `stash`                                       | The timestamps stash: up to 7 instants, comma-separated                                                                    |
| `ftz`                                         | A zone chosen for a file, `ftz=UTC@/var/log/app.log`, or for a chain, `ftz=UTC@chain:/var/log/syslog`; once per file       |

`sel` keeps the ranges that are a line `N` or a range `A-B` with whole
numbers 1 ≤ A ≤ B, the first 100 of them, and the address bar is
rewritten without the others: `sel=a-3,5-2,0,7` becomes `sel=7`. A
range past the end of the file is cut at its last line once the viewer
knows it. A link with `sel` and no `line` (nor `time`) opens at the
first range; with a `line`, the line decides where the view is.

In a chain's tab each range names the part it is in, by its file name
and in that part's own line numbers: `sel=syslog.3.gz:120-134`. The name
is read up to the last `:`, so a name may hold one. A range that runs
from one part into the next is written as two, one per part. `fp` goes
with the ranges, and a link whose `fp` is not the chain's now drops them,
as it drops its `line`: after a rotation a part's name may hold another
file. A chain whose index is still being built keeps the ranges of the
parts it can place next to the part it shows.

A `sort` on the value the link does not show is read as a sort on the
value it shows, in the same direction: `?sort=date-desc` without
`show=date` opens sorted by size, largest first, and the address bar is
rewritten to `?sort=size-desc`.

A chain's tab writes `chain`, `part`, `line`, `time` and `fp` together:
`?chains=1&chain=/var/log/syslog&part=syslog.3.gz&line=500&time=2026-10-03T14:00:00.123Z&fp=3f9a0c51e2d87b46`.
A link with `chain` turns chain mode on. A link with `chains=1` and a
`file` that names a part of a chain opens the chain's tab at that part
and line. A rotation after a link was made gives the name of its `part`
to another file, and changes the chain's fingerprint. A link whose `fp`
is not the chain's now never shows the line its `part` and `line` name
in the files as they are: it goes by its `time`, on the same line of its
part where several lines share that time, with a notice that the files
changed since the link was made (or that no line has its time now); a
link without a `time` (a line without a timestamp) opens at the chain's
start with a notice that the line could not be found again. Any other
link opens at `part` and `line` only while that line has the link's
`time`, when it names one, and otherwise goes by the time the same way:
an active file rewritten in place (by a program that truncates its log
when it starts) keeps the chain's fingerprint, so an equal `fp` does not
prove the line is the same. A link without `fp`, such as one written by
hand, names the files as they are when it is opened: without a `time`, a
notice says the view shows that line as the files are now. A `file`
link carries no fingerprint either: a
link with `chains=1` and a `file` that names a part is checked the same
way, so without a `time` it gets that notice too. A link whose `part` is
gone goes by its time too. Back and Forward check an entry the
same way; a time is not used when the chain is read in another zone
than when the entry was made.

## The API it calls

| Request                 | What for                                                 |
| ----------------------- | -------------------------------------------------------- |
| `GET /health`           | Connection status, backend version, contract version     |
| `GET /v1/tree`          | The file tree, and a file's size when a search opens it  |
| `GET /v1/samples`       | A window of a file's lines, by line range or byte offset |
| `GET /v1/time-range`    | A file's first and last time                             |
| `GET /v1/trace`         | Search                                                   |
| `GET /v1/index`         | A file's stored index: its line count and kind           |
| `POST /v1/index`        | Build an index of a file, or of every file of a folder   |
| `GET /v1/tasks/{id}`    | Follow an index task, a findings scan or a folder task   |
| `GET /v1/signatures`    | The signature catalogue, once, on a backend that has it  |
| `GET /v1/findings`      | A file's findings; a copy's text (`text=true`)           |
| `POST /v1/findings`     | Scan a file, or every file of a folder, for the picks    |
| `DELETE /v1/tasks/{id}` | Cancel a findings scan, or stop a folder task            |
| `GET /v1/logs/*`        | Log chains: list, describe, samples and search           |
| `POST /v1/logs/index`   | Build the line indexes of a chain's parts                |
| `GET /version.json`     | The viewer's own version, from its bundle                |

`/health` reports `contract_version` (`MAJOR.MINOR`). The viewer reads
contract major 2 (`src/lib/utils/contractVersion.ts`), which rx-go serves
from 0.8.0; rx-python speaks contract 1. A backend on another major is
refused with a blocking message, and every `/v1` request waits until
`/health` reports a major the viewer reads. The rx-go
documentation describes each endpoint.

## Development

### Prerequisites

- [just](https://github.com/casey/just), the single entrypoint.
- [Bun](https://bun.sh/) 1.0 or later, **or** Docker. Every recipe runs bun
  from the `PATH` when it is installed and from the `oven/bun` image when it
  is not, so a machine that keeps no JavaScript runtime needs only Docker.
- A checkout of `rx-go` beside this repository, for the generated wire
  types (`just gen-types`, `just types-check`).

### Setup

```bash
just install    # install dependencies from the lockfile
just dev        # dev server on :5173 (just dev 5174 for another port)
just ci         # the gates CI runs: format, types, lint, tests, build
just shell      # a shell in the oven/bun image, with this repo mounted
```

### Dev server

The dev server runs on `http://localhost:5173` and forwards the backend's
paths, `/v1` and `/health`, to `http://localhost:8080`. Start a backend
there first:

```bash
rx serve --port=8080 --search-root=/var/log
just dev
```

When the dev server runs in Docker, it reaches the backend on the host
through `host.docker.internal`; `RX_DEV_PROXY_TARGET` overrides the target
either way.

## Building

```bash
just build      # production build into dist/
just package    # dist.tar.gz and its .sha256, the way a release does
```

`dist/` holds `index.html`, the bundled `assets/`, `favicon.svg` and
`version.json`.

## Versions

The git tag is the version. `package.json` stays at `0.0.0`; `just build`
writes the version from `git describe` into `dist/version.json`, which the
header shows and the backends read to name the bundle they cache:

```json
{
  "version": "v0.8.0",
  "buildDate": "2026-10-03T02:00:00Z",
  "commit": "<full commit hash>"
}
```

### Backends only install a compatible viewer

Each backend accepts a range of viewer versions and does not install a
release outside it. Today rx-go (`internal/frontend/compat.go`) accepts
`0.8.0 <= v < 0.9.0`, the viewers that speak contract 2, and rx-python,
which is paused, `0.2.0 <= v < 0.4.0`.
A minor version past that range needs a backend release that widens it
first; see the parity rules in `AGENTS.md`.

## Release workflow

```
Cut (locally or on Actions) → Tag → Build → Create Release → dist.tar.gz
                                                             + .sha256
                                                                  ↓
Backend serve → Check latest release → Verify sha256 → Cache → Serve
```

### Cutting a release

Two ways, same result. Neither needs a version edited anywhere.

**On GitHub Actions** — nothing needed locally except `gh`:

```bash
just release-remote minor     # or: patch, major
gh run watch
```

Or from the GitHub UI: _Actions → Release → Run workflow_, and pick the
part to bump.

**Locally** — needs just, and bun or Docker:

```bash
just release-dry minor        # preview, changes nothing
just release minor            # gates, changelog, commit, tag
git push origin main && git push origin v0.8.0
```

Either way `just ci` runs first, so a release cannot be cut from a tree
that does not pass; `[Unreleased]` in `CHANGELOG.md` is promoted to the new
version heading, and the commit and tag are created. The build then
packages `dist.tar.gz` with its sha256 sidecar and creates the GitHub
Release with that version's changelog section as the notes.

A release is refused if you are not on `main`, if the working tree is
dirty (untracked files included), if the tag already exists, or if
`[Unreleased]` is empty.

The dispatch and tag-push paths are one workflow rather than two because
a push made with the default `GITHUB_TOKEN` does not trigger further
workflows — a separate "cut" workflow that pushed a tag would never fire
the build.

### The sidecar is not optional

Both backends fetch `<asset>.sha256` and verify the bundle before
unpacking it. A digest that does not match is refused and the previously
cached bundle is kept. A release that ships without the sidecar still
installs, with a warning, so older releases stay usable — do not rely on
that for new ones.

## Browser support

The viewer uses `Array.prototype.at` and regex match indices, which put
its floor at Chrome and Edge 92, Firefox 90 and Safari 15.4.

## Contributing

1. Read `AGENTS.md`: it holds the rules that keep the viewer on the
   contract rather than on one backend.
2. Make the change with its tests, and run `just ci`.
3. Check it in a browser against rx-go (`rx serve --port=8080`, then
   `just dev`): tree, open file, search, jump to a result, index, and a
   scan for findings.
4. Add an entry under `[Unreleased]` in `CHANGELOG.md`.

## License

MIT

## Links

- [rx-go](https://github.com/wlame/rx-go), with the API documentation
- [rx-python](https://github.com/wlame/rx-python)
- [Issues](https://github.com/wlame/rx-viewer/issues)
