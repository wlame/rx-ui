// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';

type CreateOptions = Monaco.editor.IStandaloneEditorConstructionOptions;

/** The options of each editor the component created, oldest first. */
const created = vi.hoisted(() => ({ options: [] as CreateOptions[] }));

// Monaco does not run in jsdom. The stand-in records the options the
// editor is created with, and answers every other call with a disposable.
vi.mock('monaco-editor', () => {
  const disposable = { dispose: () => {} };
  const calls: Record<string, () => unknown> = { getValue: () => '', getModel: () => null };
  const editor = new Proxy(
    {},
    { get: (_target, name) => calls[String(name)] ?? (() => disposable) },
  );
  return {
    editor: {
      create: (_node: HTMLElement, options: CreateOptions) => {
        created.options.push(options);
        return editor;
      },
      defineTheme: () => {},
      setTheme: () => {},
      setModelLanguage: () => {},
      ScrollType: { Smooth: 0, Immediate: 1 },
    },
  };
});
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({
  default: class {},
}));
// Under vitest `svelte` resolves to its server build, whose onMount does
// nothing, and the editor is created in onMount. The stand-in runs the
// function once the constructor has put the component in the page.
vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  onMount: (run: () => unknown) => queueMicrotask(() => void run()),
}));
vi.mock('$lib/utils/monacoLogLanguage', () => ({
  registerLogLanguage: () => {},
  getLogLanguageThemeRules: () => [],
  getLogLanguageThemeRulesDark: () => [],
}));

import MonacoEditor from './MonacoEditor.svelte';

let mounted: MonacoEditor[] = [];

afterEach(() => {
  for (const component of mounted) component.$destroy();
  mounted = [];
  created.options = [];
});

/** Mount the editor and let its onMount run. */
async function mountEditor(): Promise<void> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted.push(new MonacoEditor({ target, props: { content: 'LINE 1\nLINE 2' } }));
  await Promise.resolve();
}

describe('the options the Monaco editor is created with', () => {
  // The line numbers belong to the selection of lines
  // (selectionController.ts): a press there selects nothing in Monaco.
  it('leaves a press on the line numbers to the selection of lines', async () => {
    await mountEditor();

    expect(created.options).toHaveLength(1);
    expect(created.options[0].selectOnLineNumbers).toBe(false);
  });

  // With no text selected, Cmd/Ctrl+C copies the selected lines.
  it('copies nothing of its own when no text is selected', async () => {
    await mountEditor();

    expect(created.options).toHaveLength(1);
    expect(created.options[0].emptySelectionClipboard).toBe(false);
  });
});
