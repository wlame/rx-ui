/**
 * The Monaco decorations the editor pane paints, built as plain data.
 *
 * The editor holds a window of the file: Monaco line 1 is file line
 * `startLine`, and `lineCount` lines are loaded. Builders that start from
 * file line numbers take that window and drop what falls outside it, so
 * the conversion happens in one place (`toMonacoLine`). Builders that
 * scan the editor's text take a `LineSource`, which a Monaco model
 * satisfies and a test can fake.
 *
 * The class names here are styled in components/editor/editorDecorations.css.
 */
import type * as Monaco from 'monaco-editor';
import type { Finding, GroupInfo, RegexFilter, SignatureInfo } from '../types';
import type { GutterRun } from './chainZones';
import { groupColors, groupStyle } from './groupStyle';
import type { LineRange } from './lineSelection';
import { memoizeLast } from './memoizeLast';
import { HIDDEN_MARKER } from './processContent';
import { matchedSpans } from './regexMatches';

type Decoration = Monaco.editor.IModelDeltaDecoration;
type DecorationOptions = Monaco.editor.IModelDecorationOptions;

/** Monaco's MinimapPosition.Inline, spelled out so this module needs no Monaco runtime. */
const MINIMAP_INLINE = 1;

/** Monaco's MinimapPosition.Gutter: a thin mark beside the minimap's text. */
const MINIMAP_GUTTER = 2;

/** Monaco's OverviewRulerLane.Full: a mark across the whole width of the scrollbar. */
const OVERVIEW_RULER_FULL = 7;

/** Monaco's OverviewRulerLane.Left: a mark in the left third of the scrollbar. */
const OVERVIEW_RULER_LEFT = 1;

/** The part of the file the editor holds. */
export interface EditorWindow {
  /** File line number shown on Monaco line 1. */
  startLine: number;
  /** How many lines are loaded. */
  lineCount: number;
}

/** Read access to the editor's text; a Monaco model satisfies it. */
export interface LineSource {
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
}

/** Maps a file line number to its Monaco line, or null when the window does not hold it. */
export function toMonacoLine(fileLine: number, editorWindow: EditorWindow): number | null {
  const monacoLine = fileLine - editorWindow.startLine + 1;
  return monacoLine >= 1 && monacoLine <= editorWindow.lineCount ? monacoLine : null;
}

function wholeLine(monacoLine: number, options: DecorationOptions): Decoration {
  return {
    range: { startLineNumber: monacoLine, startColumn: 1, endLineNumber: monacoLine, endColumn: 1 },
    options,
  };
}

function inlineSpan(
  lineNumber: number,
  startColumn: number,
  endColumn: number,
  options: DecorationOptions,
): Decoration {
  return {
    range: { startLineNumber: lineNumber, startColumn, endLineNumber: lineNumber, endColumn },
    options,
  };
}

/** Whole-line decorations for every file line in [first, last] that the window holds. */
function fileLineRange(
  first: number,
  last: number,
  editorWindow: EditorWindow,
  options: DecorationOptions,
): Decoration[] {
  const out: Decoration[] = [];
  for (let fileLine = first; fileLine <= last; fileLine++) {
    const monacoLine = toMonacoLine(fileLine, editorWindow);
    if (monacoLine !== null) out.push(wholeLine(monacoLine, options));
  }
  return out;
}

/** Marks every line a trace search matched. */
export function matchLineDecorations(
  matchedFileLines: readonly number[],
  editorWindow: EditorWindow,
): Decoration[] {
  const options = {
    isWholeLine: true,
    className: 'monaco-match-line',
    glyphMarginClassName: 'monaco-match-glyph',
  };
  return matchedFileLines.flatMap((fileLine) =>
    fileLineRange(fileLine, fileLine, editorWindow, options),
  );
}

/** The color of the selection's marks on the minimap and the scrollbar, in both themes. */
const SELECTION_MARK_COLOR = '#388bfd';

/**
 * Marks the selected lines the window holds: one whole-line decoration
 * per range (clipped to the window) with a background, a bar in the
 * margin, bold line numbers, and marks on the minimap and the scrollbar.
 */
export function selectionDecorations(
  ranges: readonly LineRange[],
  editorWindow: EditorWindow,
): Decoration[] {
  const windowEnd = editorWindow.startLine + editorWindow.lineCount - 1;
  return ranges.flatMap((range) => {
    const first = toMonacoLine(Math.max(range.start, editorWindow.startLine), editorWindow);
    const last = toMonacoLine(Math.min(range.end, windowEnd), editorWindow);
    if (first === null || last === null || first > last) return [];
    return [
      {
        range: { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'monaco-selected-line',
          linesDecorationsClassName: 'monaco-selected-bar',
          lineNumberClassName: 'monaco-selected-line-number',
          minimap: { color: SELECTION_MARK_COLOR, position: MINIMAP_INLINE },
          overviewRuler: { color: SELECTION_MARK_COLOR, position: OVERVIEW_RULER_FULL },
        },
      },
    ];
  });
}

/**
 * Highlight-mode filter: the captured groups when the pattern has any,
 * the whole match otherwise. A pattern that does not compile yields
 * nothing; the filter bar reports the error.
 */
export function regexHighlightDecorations(pattern: string, source: LineSource): Decoration[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    return [];
  }
  const options = { inlineClassName: 'monaco-regex-highlight' };
  const out: Decoration[] = [];

  for (let lineNumber = 1; lineNumber <= source.getLineCount(); lineNumber++) {
    for (const span of matchedSpans(source.getLineContent(lineNumber), regex)) {
      out.push(inlineSpan(lineNumber, span.start + 1, span.end + 1, options));
    }
  }
  return out;
}

/**
 * Hide/show-mode filter: a colored marker on every character the filter
 * replaced with HIDDEN_MARKER, with the text it hid as the hover. The key
 * into `hiddenContent` is `"<monaco line>:<marker index on that line>"`,
 * as processContent builds it.
 */
export function hiddenMarkerDecorations(
  mode: 'hide' | 'show',
  source: LineSource,
  hiddenContent: ReadonlyMap<string, string>,
): Decoration[] {
  const inlineClassName =
    mode === 'hide' ? 'monaco-hidden-marker-red' : 'monaco-hidden-marker-blue';
  const out: Decoration[] = [];

  for (let lineNumber = 1; lineNumber <= source.getLineCount(); lineNumber++) {
    let column = 1;
    let markerIndex = 0;
    for (const char of source.getLineContent(lineNumber)) {
      if (char === HIDDEN_MARKER) {
        const hiddenText = hiddenContent.get(`${lineNumber}:${markerIndex}`);
        out.push(
          inlineSpan(lineNumber, column, column + 1, {
            inlineClassName,
            hoverMessage: hiddenText ? { value: hiddenText } : undefined,
          }),
        );
        markerIndex++;
      }
      column++;
    }
  }
  return out;
}

/** The catalogue the finding marks take their colours and hovers from. */
export interface FindingCatalogue {
  /** The catalogue's signatures, opt-in and disabled ones included. */
  list: readonly SignatureInfo[];
  /** The catalogue's groups; a group's `order` sets its colour. */
  groups: readonly GroupInfo[];
}

/** The levels a hover writes in bold. */
const STRONG_LEVELS: ReadonlySet<string> = new Set(['high', 'critical']);

/** Every character Markdown may read as syntax: ASCII punctuation, which a backslash escapes. */
const MARKDOWN_SYNTAX = /[\\`*_{}[\]()#+\-.!|<>~&]/g;

/**
 * `text` as Markdown that shows it as written: a signature's name and
 * description come from a user's file, and the hover must not render
 * them as an image (a request) or a link.
 */
function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SYNTAX, '\\$&');
}

/**
 * The hover of a finding's bar, from the catalogue only: the signature's
 * name, its level (bold when high or critical), the finding's lines and
 * the description. A finding's text never appears here: it would come
 * from the editor's lines, which no redaction masked.
 */
function findingHover(finding: Finding, signature: SignatureInfo | undefined): string {
  const { start_line: start, end_line: end } = finding;
  const lines = start === end ? `line ${start}` : `lines ${start}–${end}`;
  const parts = [`**${escapeMarkdown(signature?.name ?? finding.signature)}**`];
  if (signature) {
    const level = escapeMarkdown(signature.level);
    parts.push(STRONG_LEVELS.has(signature.level) ? `**${level}**` : level);
  }
  parts.push(lines);
  const head = parts.join(' · ');
  return signature?.description ? `${head}\n\n${escapeMarkdown(signature.description)}` : head;
}

/** How many bytes UTF-8 takes for one code point. */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/** The UTF-8 byte order mark: rx-go counts it in line 1's offsets, and Monaco drops it from the text. */
const BOM = '\uFEFF';
const BOM_BYTES = 3;

/**
 * Characters after which the editor's columns are no longer the file's
 * bytes: a lone carriage return, which the editor drops or shows as
 * U+240D, and U+FFFD, which stands for a byte that was not UTF-8.
 */
const DRIFTING_CHARACTERS: ReadonlySet<string> = new Set(['\r', '\u240D', '\uFFFD']);

/**
 * The Monaco column at `byteOffset` bytes of `line`'s UTF-8 text: Monaco
 * counts UTF-16 code units, a finding's value counts bytes. An offset
 * inside a character gives the column after it; one past the end, the
 * column after the last character. Null when a character before the
 * offset makes the editor's columns drift from the bytes.
 */
function columnAtByte(line: string, byteOffset: number): number | null {
  let bytes = 0;
  let units = 0;
  for (const char of line) {
    if (bytes >= byteOffset) break;
    if (DRIFTING_CHARACTERS.has(char)) return null;
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    units += char.length;
  }
  return units + 1;
}

/**
 * The box around a finding's value, on its first line, where it lands
 * exactly; null when it has none to show, or when its columns in the
 * editor are not known for sure. Line 1 of a text that starts with a BOM
 * counts the BOM's 3 bytes, which the editor does not show.
 */
function valueBox(
  finding: Finding,
  editorWindow: EditorWindow,
  fileText: LineSource | null,
  className: string,
): Decoration | null {
  const { value_start: start, value_end: end } = finding;
  const line = toMonacoLine(finding.start_line, editorWindow);
  if (fileText === null || line === null || start === undefined || end === undefined) return null;
  let content = fileText.getLineContent(line);
  let shift = 0;
  if (finding.start_line === 1 && content.startsWith(BOM)) {
    content = content.slice(BOM.length);
    shift = BOM_BYTES;
  }
  if (start < shift) return null;
  const startColumn = columnAtByte(content, start - shift);
  const endColumn = columnAtByte(content, end - shift);
  if (startColumn === null || endColumn === null || endColumn <= startColumn) return null;
  return inlineSpan(line, startColumn, endColumn, {
    inlineClassName: `monaco-finding-value ${className}`,
  });
}

/**
 * The window's lines as the file has them, the samples answer's text,
 * for the value boxes: the editor drops a BOM and carriage returns.
 */
export function fileLinesSource(lines: readonly { content: string }[]): LineSource {
  return {
    getLineCount: () => lines.length,
    getLineContent: (lineNumber) => lines[lineNumber - 1]?.content ?? '',
  };
}

/**
 * Marks the findings the window holds: for each, a bar in the glyph
 * margin over its lines (cut to the window) in its group's colour, with
 * the signature's hover, marks on the minimap and the scrollbar, and a
 * box around its value on its first line when the window's lines as the
 * file has them (`fileText`, `fileLinesSource`) are given. No line gets a
 * background: the selection owns those.
 */
export function findingDecorations(
  findings: readonly Finding[],
  editorWindow: EditorWindow,
  groups: readonly GroupInfo[],
  catalogue: readonly SignatureInfo[],
  fileText: LineSource | null = null,
): Decoration[] {
  const signatureOf = new Map(catalogue.map((signature) => [signature.id, signature]));
  const windowEnd = editorWindow.startLine + editorWindow.lineCount - 1;
  const out: Decoration[] = [];
  for (const finding of findings) {
    const first = toMonacoLine(Math.max(finding.start_line, editorWindow.startLine), editorWindow);
    const last = toMonacoLine(Math.min(finding.end_line, windowEnd), editorWindow);
    if (first === null || last === null || first > last) continue;
    const signature = signatureOf.get(finding.signature);
    const group = signature?.group ?? '';
    const { className } = groupStyle(group, groups);
    const { light, dark } = groupColors(group, groups);
    out.push({
      range: { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: 1 },
      options: {
        isWholeLine: true,
        glyphMarginClassName: `monaco-finding-bar ${className}`,
        glyphMarginHoverMessage: { value: findingHover(finding, signature) },
        minimap: { color: light, darkColor: dark, position: MINIMAP_GUTTER },
        overviewRuler: { color: light, darkColor: dark, position: OVERVIEW_RULER_LEFT },
      },
    });
    const box = valueBox(finding, editorWindow, fileText, className);
    if (box) out.push(box);
  }
  return out;
}

/** What the pane shows that its decorations mark. */
export interface PaneView {
  editorWindow: EditorWindow;
  /** File lines a trace search matched. */
  matchedFileLines: readonly number[];
  /** The selected file lines (`utils/lineSelection.ts`). */
  selection: readonly LineRange[];
  filter: Pick<RegexFilter, 'enabled' | 'pattern' | 'mode' | 'compiledRegex'> | null;
  /** The editor's text, or null before the editor has a model. */
  text: LineSource | null;
  /** What the hide/show filter replaced, as processContent built it. */
  hiddenContent: ReadonlyMap<string, string>;
  /** A log chain's gutter classes, in runs of editor lines; none for a file. */
  gutterRuns?: readonly GutterRun[];
  /** The findings of the file around the window; none in a log chain's tab. */
  findings?: readonly Finding[];
  /** The catalogue the findings are marked by. */
  signatures?: FindingCatalogue;
  /** The window's lines as the file has them (`fileLinesSource`), which the value boxes count in. */
  fileText?: LineSource | null;
}

/** Whether two values of a field of a pane view are the same. */
type SameField<T> = (a: T, b: T) => boolean;

const isSameObject = <T>(a: T, b: T): boolean => a === b;

/**
 * How each field of two pane views is compared: as the same object,
 * except the window, which a tab's update builds anew from numbers that
 * say the same.
 */
const SAME_PANE_FIELDS: { [K in keyof Required<PaneView>]: SameField<PaneView[K]> } = {
  editorWindow: (a, b) => a.startLine === b.startLine && a.lineCount === b.lineCount,
  matchedFileLines: isSameObject,
  selection: isSameObject,
  filter: isSameObject,
  text: isSameObject,
  hiddenContent: isSameObject,
  gutterRuns: isSameObject,
  findings: isSameObject,
  signatures: isSameObject,
  fileText: isSameObject,
};

const PANE_FIELDS = Object.keys(SAME_PANE_FIELDS) as (keyof PaneView)[];

function isSameField<K extends keyof PaneView>(key: K, a: PaneView, b: PaneView): boolean {
  return SAME_PANE_FIELDS[key](a[key], b[key]);
}

/**
 * Whether two pane views mark the same: every field the same. Objects
 * built from the lines or the text (the matched lines, the hidden
 * content, the gutter runs) and the findings count only as the same
 * object, so a view whose decorations would differ is never taken for
 * the same one.
 */
export function isSamePaneView(a: PaneView, b: PaneView): boolean {
  return PANE_FIELDS.every((key) => isSameField(key, a, b));
}

/** The line numbers of each run of editor lines in the run's class. */
export function gutterDecorations(runs: readonly GutterRun[]): Decoration[] {
  return runs.map((run) => ({
    range: { startLineNumber: run.first, startColumn: 1, endLineNumber: run.last, endColumn: 1 },
    options: { isWholeLine: true, lineNumberClassName: run.className },
  }));
}

/** The decorations of each filter mode, over the editor's text. */
const FILTER_DECORATIONS: Record<
  RegexFilter['mode'],
  (pattern: string, text: LineSource, hiddenContent: ReadonlyMap<string, string>) => Decoration[]
> = {
  highlight: (pattern, text) => regexHighlightDecorations(pattern, text),
  hide: (_, text, hiddenContent) => hiddenMarkerDecorations('hide', text, hiddenContent),
  show: (_, text, hiddenContent) => hiddenMarkerDecorations('show', text, hiddenContent),
};

const NO_FINDINGS: readonly Finding[] = [];
const NO_GROUPS: readonly GroupInfo[] = [];
const NO_SIGNATURES: readonly SignatureInfo[] = [];

/**
 * The marks of the findings, built again only for other findings, window,
 * catalogue or lines: a click that changes the selection redraws the
 * pane, and a window holds up to 10,000 findings with their hovers.
 */
const findingMarksOf = memoizeLast(
  (
    findings: readonly Finding[],
    startLine: number,
    lineCount: number,
    groups: readonly GroupInfo[],
    catalogue: readonly SignatureInfo[],
    fileText: LineSource | null,
  ) => findingDecorations(findings, { startLine, lineCount }, groups, catalogue, fileText),
);

/**
 * Every decoration of the pane: matched lines, the findings, the selected
 * lines, what an active filter does, and a log chain's gutter classes. A
 * filter is active when it is enabled and its pattern compiled. While a
 * hide or show filter rewrites the text, its columns are not the file's,
 * so no finding's value is boxed.
 */
export function paneDecorations(view: PaneView): Decoration[] {
  const { editorWindow, filter, text } = view;
  const isFilterActive = Boolean(filter?.enabled && filter.compiledRegex);
  const isTextRewritten = isFilterActive && filter?.mode !== 'highlight';
  return [
    ...matchLineDecorations(view.matchedFileLines, editorWindow),
    ...findingMarksOf(
      view.findings ?? NO_FINDINGS,
      editorWindow.startLine,
      editorWindow.lineCount,
      view.signatures?.groups ?? NO_GROUPS,
      view.signatures?.list ?? NO_SIGNATURES,
      isTextRewritten ? null : (view.fileText ?? null),
    ),
    ...selectionDecorations(view.selection, editorWindow),
    ...(filter && isFilterActive && text
      ? FILTER_DECORATIONS[filter.mode](filter.pattern, text, view.hiddenContent)
      : []),
    ...gutterDecorations(view.gutterRuns ?? []),
  ];
}
