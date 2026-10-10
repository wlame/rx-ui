// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { GroupInfo } from '../types';
import { GROUP_PALETTE, groupStyle, installPaletteStyles, paletteStyleSheet } from './groupStyle';

/** A catalogue's groups with these names, in this order, numbered from 1. */
function groupList(...names: string[]): GroupInfo[] {
  return names.map((name, i) => ({
    name,
    description: '',
    order: i + 1,
    count: 1,
    builtin: true,
  }));
}

// The built-in groups, in the order the catalogue gives them.
const BUILTIN_GROUPS = groupList(
  'traceback',
  'crash',
  'secret',
  'pii',
  'sql',
  'http',
  'severity',
  'system',
  'lifecycle',
  'structure',
  'time',
);

const LIGHT_COLORS = GROUP_PALETTE.map((pair) => pair.light);

describe('groupStyle', () => {
  it('colours a group by its order in the catalogue', () => {
    for (const group of BUILTIN_GROUPS) {
      expect(groupStyle(group.name, BUILTIN_GROUPS)).toEqual({
        className: `group-palette-${group.order - 1}`,
        color: GROUP_PALETTE[group.order - 1].light,
      });
    }
  });

  it('goes by the order a group carries, not by its place in the list', () => {
    const reversed = [...BUILTIN_GROUPS].reverse();

    expect(groupStyle('sql', reversed)).toEqual(groupStyle('sql', BUILTIN_GROUPS));
    expect(groupStyle('sql', reversed).color).toBe(GROUP_PALETTE[4].light);
  });

  it('gives as many groups as the palette has colours different colours', () => {
    const groups = groupList(...GROUP_PALETTE.map((_, i) => `group-${i}`));

    const colors = groups.map((group) => groupStyle(group.name, groups).color);

    expect(new Set(colors).size).toBe(GROUP_PALETTE.length);
  });

  // A user file may add groups after the built-in ones; past the palette
  // a colour is chosen by the name, the same on every call.
  it('gives a user group past the 13th a palette colour by its name', () => {
    const groups = [
      ...BUILTIN_GROUPS,
      ...groupList('team-a', 'team-b', 'team-c', 'team-d').map((group) => ({
        ...group,
        order: group.order + BUILTIN_GROUPS.length,
        builtin: false,
      })),
    ];
    const past = groups.filter((group) => group.order > GROUP_PALETTE.length);

    expect(past.map((group) => group.name)).toEqual(['team-c', 'team-d']);
    for (const group of past) {
      const style = groupStyle(group.name, groups);
      const index = LIGHT_COLORS.indexOf(style.color);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(style.className).toBe(`group-palette-${index}`);
      expect(groupStyle(group.name, [...groups].reverse())).toEqual(style);
    }
    expect(groupStyle('team-a', groups).color).toBe(GROUP_PALETTE[11].light);
  });

  it('keeps a group the catalogue does not name off the colours the listed groups take', () => {
    const listed = BUILTIN_GROUPS.map((group) => groupStyle(group.name, BUILTIN_GROUPS).color);

    for (const name of ['team', 'audit', 'billing', 'payments', 'k8s', 'mail']) {
      const style = groupStyle(name, BUILTIN_GROUPS);
      expect(listed).not.toContain(style.color);
      expect(LIGHT_COLORS).toContain(style.color);
    }
  });

  it('colours a group by its name while the catalogue has not loaded', () => {
    const style = groupStyle('traceback', []);

    expect(LIGHT_COLORS).toContain(style.color);
    expect(groupStyle('traceback', [])).toEqual(style);
  });
});

describe('paletteStyleSheet', () => {
  // The app's dark theme is `.dark` on the page; Monaco names its own
  // theme's base on `.monaco-editor`, and a light editor may sit in a
  // dark app.
  it('defines every palette class for the light and the dark theme, in the app and in the editor', () => {
    const css = paletteStyleSheet();

    GROUP_PALETTE.forEach(({ light, dark }, i) => {
      const name = `group-palette-${i}`;
      expect(css).toContain(`.${name} { --rx-group-color: ${light}; }`);
      expect(css).toContain(`.dark .${name} { --rx-group-color: ${dark}; }`);
      expect(css).toContain(`.monaco-editor.vs .${name} { --rx-group-color: ${light}; }`);
      expect(css).toContain(`.monaco-editor.vs-dark .${name} { --rx-group-color: ${dark}; }`);
    });
  });
});

describe('installPaletteStyles', () => {
  afterEach(() => document.head.replaceChildren());

  it('adds the palette stylesheet to the page once', () => {
    installPaletteStyles();
    installPaletteStyles();

    const sheets = document.head.querySelectorAll('style#rx-group-palette');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].textContent).toBe(paletteStyleSheet());
  });
});
