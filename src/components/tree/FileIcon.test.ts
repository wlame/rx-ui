// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { TreeNode } from '$lib/types';
import FileIcon from './FileIcon.svelte';

let icon: FileIcon | null = null;

/** A file row of the tree named `name`. */
function fileNode(name: string, fields: Partial<TreeNode> = {}): TreeNode {
  return {
    path: `/logs/${name}`,
    name,
    type: 'file',
    children_count: null,
    compression_format: null,
    is_compressed: false,
    is_indexed: false,
    is_text: true,
    not_text_reason: null,
    line_count: null,
    findings: null,
    modified_at: null,
    size: 100,
    size_human: null,
    level: 1,
    expanded: false,
    loading: false,
    children: [],
    ...fields,
  };
}

/** The classes of the file icon drawn for `node`. */
function classesOf(node: TreeNode): string {
  const target = document.createElement('div');
  document.body.appendChild(target);
  icon = new FileIcon({ target, props: { node } });
  return target.querySelector('svg')?.getAttribute('class') ?? '';
}

afterEach(() => {
  icon?.$destroy();
  icon = null;
  document.body.replaceChildren();
});

describe('FileIcon colour', () => {
  it.each(['system.journal', 'user-1000.journal~', 'system@0123abcd-0000000000000001.journal'])(
    'draws %s in the colour of a systemd journal',
    (name) => {
      expect(classesOf(fileNode(name))).toContain('text-cyan-600');
    },
  );

  it('keeps the colour of a log for a .log file', () => {
    expect(classesOf(fileNode('app.log'))).toContain('text-yellow-600');
  });

  it('draws a file of an unknown extension muted', () => {
    expect(classesOf(fileNode('data.unknown'))).toContain('text-gh-fg-muted');
  });
});
