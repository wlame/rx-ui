import { describe, expect, it } from 'vitest';
import {
  TEST_GROUPS,
  TEST_SIGNATURES,
  finding,
  signatureInfo,
  testCatalogue,
} from '../testing/fakeFindings';
import { GROUP_PALETTE } from './groupStyle';
import { HIDDEN_MARKER } from './processContent';
import {
  findingDecorations,
  hiddenMarkerDecorations,
  isSamePaneView,
  matchLineDecorations,
  paneDecorations,
  regexHighlightDecorations,
  selectionDecorations,
  toMonacoLine,
  type LineSource,
} from './editorDecorations';

/** A window holding file lines 101..110 in Monaco lines 1..10. */
const editorWindow = { startLine: 101, lineCount: 10 };

function lines(...text: string[]): LineSource {
  return {
    getLineCount: () => text.length,
    getLineContent: (n: number) => text[n - 1],
  };
}

function spans(decorations: { range: { startColumn: number; endColumn: number } }[]) {
  return decorations.map((d) => [d.range.startColumn, d.range.endColumn]);
}

describe('toMonacoLine', () => {
  it('maps a file line inside the window to its Monaco line', () => {
    expect(toMonacoLine(101, editorWindow)).toBe(1);
    expect(toMonacoLine(110, editorWindow)).toBe(10);
  });

  it('returns null for a file line the window does not hold', () => {
    expect(toMonacoLine(100, editorWindow)).toBeNull();
    expect(toMonacoLine(111, editorWindow)).toBeNull();
  });
});

describe('matchLineDecorations', () => {
  it('marks each matched line in the window and skips the rest', () => {
    const decorations = matchLineDecorations([99, 102, 105, 200], editorWindow);

    expect(decorations.map((d) => d.range.startLineNumber)).toEqual([2, 5]);
    expect(decorations[0].options.className).toBe('monaco-match-line');
  });
});

describe('selectionDecorations', () => {
  it('marks each selected range once, cut to the lines the window holds', () => {
    const decorations = selectionDecorations(
      [
        { start: 95, end: 102 },
        { start: 105, end: 105 },
        { start: 108, end: 140 },
      ],
      editorWindow,
    );

    expect(decorations.map((d) => [d.range.startLineNumber, d.range.endLineNumber])).toEqual([
      [1, 2],
      [5, 5],
      [8, 10],
    ]);
  });

  it('marks nothing for a range outside the window', () => {
    expect(selectionDecorations([{ start: 1, end: 100 }], editorWindow)).toEqual([]);
    expect(selectionDecorations([{ start: 111, end: 200 }], editorWindow)).toEqual([]);
  });

  it('gives the lines a background, a margin bar, bold numbers and minimap and scrollbar marks', () => {
    const [decoration] = selectionDecorations([{ start: 103, end: 104 }], editorWindow);

    expect(decoration.options).toMatchObject({
      isWholeLine: true,
      className: 'monaco-selected-line',
      linesDecorationsClassName: 'monaco-selected-bar',
      lineNumberClassName: 'monaco-selected-line-number',
      minimap: { position: 1 },
      overviewRuler: { position: 7 },
    });
  });
});

describe('regexHighlightDecorations', () => {
  it('highlights the whole match when the pattern has no group', () => {
    expect(spans(regexHighlightDecorations('ab', lines('xab ab')))).toEqual([
      [2, 4],
      [5, 7],
    ]);
  });

  it('highlights a captured group at its own position in the match', () => {
    expect(spans(regexHighlightDecorations('a.(a)', lines('aba')))).toEqual([[3, 4]]);
  });

  it('highlights the whole match of a pattern whose only paren is escaped', () => {
    expect(spans(regexHighlightDecorations('\\(x\\)', lines('f(x)')))).toEqual([[2, 5]]);
  });

  it('highlights only the captured groups when the pattern has them', () => {
    expect(spans(regexHighlightDecorations('user=(u\\d+)', lines('a user=u42 b')))).toEqual([
      [8, 11],
    ]);
  });

  it('stops on a pattern that can match the empty string', () => {
    expect(regexHighlightDecorations('x*', lines('abc')).length).toBeGreaterThan(0);
  });

  it('marks every match of a pattern that can match the empty string, empty ones included', () => {
    expect(spans(regexHighlightDecorations('x*', lines('axb')))).toEqual([
      [1, 1],
      [2, 3],
      [3, 3],
      [4, 4],
    ]);
  });

  it('returns nothing for a pattern that does not compile', () => {
    expect(regexHighlightDecorations('(', lines('abc'))).toEqual([]);
  });
});

describe('hiddenMarkerDecorations', () => {
  it('puts a marker on each hidden span, carrying the hidden text as its hover', () => {
    const text = `a${HIDDEN_MARKER}b${HIDDEN_MARKER}`;
    const hidden = new Map([
      ['1:0', 'secret1'],
      ['1:1', 'secret2'],
    ]);

    const decorations = hiddenMarkerDecorations('hide', lines(text), hidden);

    expect(spans(decorations)).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(decorations[0].options.inlineClassName).toBe('monaco-hidden-marker-red');
    expect(decorations[1].options.hoverMessage).toEqual({ value: 'secret2' });
  });

  it('colors the markers blue in show-only mode', () => {
    const decorations = hiddenMarkerDecorations('show', lines(HIDDEN_MARKER), new Map());

    expect(decorations[0].options.inlineClassName).toBe('monaco-hidden-marker-blue');
  });
});

describe('paneDecorations', () => {
  const filter = { enabled: true, pattern: 'b', mode: 'highlight' as const, compiledRegex: /b/ };
  const nothingShown = {
    editorWindow,
    matchedFileLines: [],
    selection: [],
    filter: null,
    text: lines('abc', `a${HIDDEN_MARKER}c`),
    hiddenContent: new Map([['2:0', 'b']]),
  };

  it('marks the matched lines and the selected lines together', () => {
    const decorations = paneDecorations({
      ...nothingShown,
      matchedFileLines: [102],
      selection: [{ start: 103, end: 103 }],
    });

    expect(decorations.map((d) => d.range.startLineNumber)).toEqual([2, 3]);
  });

  it('gives a log chain run of gutter lines its line number class', () => {
    const decorations = paneDecorations({
      ...nothingShown,
      gutterRuns: [{ first: 2, last: 3, className: 'chain-gutter-alt' }],
    });

    expect(decorations).toEqual([
      {
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 },
        options: { isWholeLine: true, lineNumberClassName: 'chain-gutter-alt' },
      },
    ]);
  });

  it.each([
    ['highlight', 'monaco-regex-highlight', 1],
    ['hide', 'monaco-hidden-marker-red', 2],
    ['show', 'monaco-hidden-marker-blue', 2],
  ] as const)('marks what a %s filter does on the line it does it', (mode, className, line) => {
    const decorations = paneDecorations({ ...nothingShown, filter: { ...filter, mode } });

    expect(decorations).toHaveLength(1);
    expect(decorations[0].range.startLineNumber).toBe(line);
    expect(decorations[0].options.inlineClassName).toBe(className);
  });

  it.each([
    ['disabled', { ...filter, enabled: false }],
    ['not compiled', { ...filter, compiledRegex: null }],
  ])('marks nothing for a filter that is %s', (_, inactive) => {
    expect(paneDecorations({ ...nothingShown, filter: inactive })).toEqual([]);
  });

  it('marks no filter result before the editor has text', () => {
    expect(paneDecorations({ ...nothingShown, filter, text: null })).toEqual([]);
  });
});

describe('findingDecorations', () => {
  /** The bars among `decorations`: the editor lines each covers. */
  function bars(decorations: ReturnType<typeof findingDecorations>) {
    return decorations
      .filter((d) => d.options.glyphMarginClassName)
      .map((d) => [d.range.startLineNumber, d.range.endLineNumber]);
  }

  function hoverOf(decoration: ReturnType<typeof findingDecorations>[number]): string {
    const hover = decoration.options.glyphMarginHoverMessage;
    if (!hover || Array.isArray(hover)) throw new Error('the bar has no single hover');
    return hover.value;
  }

  it('draws a bar in the margin for each finding the window holds, cut to the window', () => {
    const found = [
      finding('python-traceback', 99, 103),
      finding('sql-statement', 105),
      finding('aws-access-key', 111),
      finding('java-exception', 90, 100),
    ];

    const decorations = findingDecorations(found, editorWindow, TEST_GROUPS, TEST_SIGNATURES);

    expect(bars(decorations)).toEqual([
      [1, 3],
      [5, 5],
    ]);
  });

  it("colours a bar by its signature's group, and marks the minimap and the scrollbar", () => {
    const [traceback, sql] = findingDecorations(
      [finding('python-traceback', 102), finding('sql-statement', 104)],
      editorWindow,
      TEST_GROUPS,
      TEST_SIGNATURES,
    );

    expect(traceback.options.glyphMarginClassName).toBe('monaco-finding-bar group-palette-0');
    expect(sql.options.glyphMarginClassName).toBe('monaco-finding-bar group-palette-2');
    expect(sql.options.minimap).toEqual({
      color: GROUP_PALETTE[2].light,
      darkColor: GROUP_PALETTE[2].dark,
      position: 2,
    });
    expect(sql.options.overviewRuler).toEqual({
      color: GROUP_PALETTE[2].light,
      darkColor: GROUP_PALETTE[2].dark,
      position: 1,
    });
  });

  // The selection owns the line backgrounds.
  it('gives no line a background', () => {
    const decorations = findingDecorations(
      [finding('python-traceback', 102, 104)],
      editorWindow,
      TEST_GROUPS,
      TEST_SIGNATURES,
    );

    expect(decorations.every((d) => !d.options.className)).toBe(true);
  });

  it("hovers the bar with the signature's name, level, lines and description", () => {
    const catalogue = [
      signatureInfo('python-traceback', {
        name: 'Python traceback',
        level: 'high',
        description: 'A stack trace that Python printed',
      }),
      signatureInfo('sql-statement', { name: 'SQL statement', group: 'sql', level: 'info' }),
    ];

    const [block, line] = findingDecorations(
      [finding('python-traceback', 102, 104), finding('sql-statement', 106)],
      editorWindow,
      TEST_GROUPS,
      catalogue,
    );

    expect(hoverOf(block)).toBe(
      '**Python traceback** · **high** · lines 102–104\n\nA stack trace that Python printed',
    );
    expect(hoverOf(line)).toBe('**SQL statement** · info · line 106');
  });

  // A user's signature file writes the name and the description; the
  // hover renders Markdown, which must not fetch an image or draw a link.
  it('shows catalogue text as written, with no Markdown of its own', () => {
    const catalogue = [
      signatureInfo('odd', {
        name: 'odd_name*',
        description: '![x](https://example.com/a.png) <b>',
      }),
    ];

    const [bar] = findingDecorations([finding('odd', 102)], editorWindow, TEST_GROUPS, catalogue);

    expect(hoverOf(bar)).toBe(
      '**odd\\_name\\*** · **high** · line 102\n\n' +
        '\\!\\[x\\]\\(https://example\\.com/a\\.png\\) \\<b\\>',
    );
  });

  it('names a signature the catalogue does not hold by its id', () => {
    const [bar] = findingDecorations([finding('gone', 102)], editorWindow, TEST_GROUPS, []);

    expect(hoverOf(bar)).toBe('**gone** · line 102');
    expect(bar.options.glyphMarginClassName).toMatch(/^monaco-finding-bar group-palette-\d+$/);
  });

  it('boxes the value on the first line, in columns of its text', () => {
    // "é" is two bytes and one column; "🙂" is four bytes and two columns.
    const text = lines('', 'é🙂 key=AKIAEXAMPLE', 'x');
    const valued = finding('aws-access-key', 102, 103, { value_start: 11, value_end: 22 });

    const decorations = findingDecorations(
      [valued],
      editorWindow,
      TEST_GROUPS,
      TEST_SIGNATURES,
      text,
    );

    const box = decorations.find((d) => d.options.inlineClassName);
    expect(box?.range).toEqual({
      startLineNumber: 2,
      startColumn: 9,
      endLineNumber: 2,
      endColumn: 20,
    });
    expect(box?.options.inlineClassName).toBe('monaco-finding-value group-palette-1');
  });

  it('boxes no value without the text, or when the window does not hold the first line', () => {
    const valued = { value_start: 0, value_end: 3 };
    const inWindow = finding('aws-access-key', 102, 102, valued);
    const startsBefore = finding('aws-access-key', 100, 102, valued);
    const text = lines('', 'abcdef', 'abcdef');

    const boxes = (found: ReturnType<typeof finding>[], source?: typeof text) =>
      findingDecorations(found, editorWindow, TEST_GROUPS, TEST_SIGNATURES, source).filter(
        (d) => d.options.inlineClassName,
      );

    expect(boxes([inWindow])).toEqual([]);
    expect(boxes([startsBefore], text)).toEqual([]);
    expect(boxes([inWindow], text)).toHaveLength(1);
  });

  it('marks nothing without findings', () => {
    expect(findingDecorations([], editorWindow, TEST_GROUPS, TEST_SIGNATURES)).toEqual([]);
  });
});

describe('findingDecorations value box, only where it lands exactly', () => {
  /** A window from file line 1, where a BOM can start the text. */
  const fromLine1 = { startLine: 1, lineCount: 3 };

  /** The box of a value on `fileLine`, bytes `start` to `end`, over the file's lines `text`. */
  function boxOf(text: string[], fileLine: number, start: number, end: number) {
    const valued = finding('aws-access-key', fileLine, fileLine, {
      value_start: start,
      value_end: end,
    });
    const decorations = findingDecorations(
      [valued],
      fromLine1,
      TEST_GROUPS,
      TEST_SIGNATURES,
      lines(...text),
    );
    expect(decorations.some((d) => d.options.glyphMarginClassName)).toBe(true);
    const box = decorations.find((d) => d.options.inlineClassName)?.range;
    return box ? [box.startColumn, box.endColumn] : null;
  }

  // rx-go counts the BOM in line 1's offsets; Monaco drops it from the text.
  it('takes the 3 bytes of a BOM off the offsets on line 1 of a text that starts with one', () => {
    expect(boxOf(['\uFEFFkey=VALUE'], 1, 7, 12)).toEqual([5, 10]);
  });

  // Further on, U+FEFF is a character of the line, which the editor shows.
  it('counts a U+FEFF that does not start the text as a character of the line', () => {
    expect(boxOf(['x', '\uFEFFkey=VALUE'], 2, 7, 12)).toEqual([6, 11]);
  });

  it.each([
    ['a lone carriage return', 'a\rkey=VALUE', 6, 11],
    ['U+240D', 'a\u240Dkey=VALUE', 8, 13],
    ['U+FFFD, a byte that was not UTF-8', 'a\uFFFDkey=VALUE', 8, 13],
  ])('draws no box when the text before the value holds %s', (_name, line, start, end) => {
    expect(boxOf([line], 1, start, end)).toBeNull();
  });

  it('draws the box when such a character comes only after the value', () => {
    expect(boxOf(['key=VALUE\r\uFFFD'], 1, 4, 9)).toEqual([5, 10]);
  });

  it('places a value after multi-byte characters at its columns', () => {
    // "é" is two bytes and one column; "🙂" is four bytes and two columns.
    expect(boxOf(['é🙂 key=VALUE'], 1, 11, 16)).toEqual([9, 14]);
  });
});

describe('paneDecorations with findings', () => {
  const valued = finding('aws-access-key', 102, 102, { value_start: 0, value_end: 3 });
  const view = {
    editorWindow,
    matchedFileLines: [],
    selection: [],
    filter: null,
    text: lines('abc', 'abc'),
    hiddenContent: new Map<string, string>(),
    findings: [valued],
    signatures: testCatalogue(),
    fileText: lines('abc', 'abc'),
  };

  // A click changes the selection; the findings' marks are not built again.
  it('keeps the marks of the findings it built for the same findings, window and text', () => {
    const first = paneDecorations(view);
    const second = paneDecorations({
      ...view,
      editorWindow: { ...editorWindow },
      selection: [{ start: 103, end: 103 }],
    });

    const bar = (decorations: typeof first) =>
      decorations.find((d) => d.options.glyphMarginClassName);
    expect(bar(second)).toBe(bar(first));
    expect(bar(paneDecorations({ ...view, findings: [valued] }))).not.toBe(bar(first));
  });

  it("marks the findings with the bar, the marks and the value's box", () => {
    const decorations = paneDecorations(view);

    expect(
      decorations.map((d) => d.options.glyphMarginClassName ?? d.options.inlineClassName),
    ).toEqual(['monaco-finding-bar group-palette-1', 'monaco-finding-value group-palette-1']);
  });

  // The value's offsets count the file's bytes, which the editor's text
  // need not show all of (a BOM, a carriage return).
  it("places the value's box over the file's lines, not the editor's text", () => {
    const multiByte = finding('aws-access-key', 102, 102, { value_start: 2, value_end: 4 });

    const decorations = paneDecorations({
      ...view,
      findings: [multiByte],
      text: lines('abcd', 'abcd'),
      fileText: lines('éxy', 'éxy'),
    });

    const box = decorations.find((d) => d.options.inlineClassName)?.range;
    expect([box?.startColumn, box?.endColumn]).toEqual([2, 4]);
  });

  // A hide or show filter rewrites the text, so its columns are not the file's.
  it.each(['hide', 'show'] as const)(
    'boxes no value while a %s filter rewrites the text',
    (mode) => {
      const filter = { enabled: true, pattern: 'q', mode, compiledRegex: /q/ };

      const decorations = paneDecorations({ ...view, filter });

      expect(
        decorations.some((d) => d.options.inlineClassName?.startsWith('monaco-finding-value')),
      ).toBe(false);
      expect(decorations.some((d) => d.options.glyphMarginClassName)).toBe(true);
    },
  );
});

describe('isSamePaneView', () => {
  const view = {
    editorWindow,
    matchedFileLines: [102],
    selection: [],
    filter: null,
    text: lines('abc'),
    hiddenContent: new Map<string, string>(),
    gutterRuns: [],
    findings: [],
    signatures: testCatalogue(),
    fileText: lines('abc'),
  };

  // A tab's update builds the view anew: the window is a new object that
  // says the same.
  it('is the same view when the window says the same in a new object', () => {
    expect(isSamePaneView(view, { ...view, editorWindow: { ...editorWindow } })).toBe(true);
  });

  it.each([
    ['a window that starts elsewhere', { editorWindow: { ...editorWindow, startLine: 102 } }],
    ['a window of other length', { editorWindow: { ...editorWindow, lineCount: 11 } }],
    ['other matched lines, the same numbers in a new list', { matchedFileLines: [102] }],
    ['another selection, the same lines in a new list', { selection: [] }],
    [
      'a filter',
      { filter: { enabled: true, pattern: 'b', mode: 'highlight' as const, compiledRegex: /b/ } },
    ],
    ['another text', { text: lines('abc') }],
    ['another hidden-content map', { hiddenContent: new Map<string, string>() }],
    ['other gutter runs', { gutterRuns: [] }],
    ['other findings, the same ones in a new list', { findings: [] }],
    ['another catalogue', { signatures: testCatalogue() }],
    ['other lines of the file', { fileText: lines('abc') }],
  ])('is another view with %s', (_name, change) => {
    expect(isSamePaneView(view, { ...view, ...change })).toBe(false);
  });
});
