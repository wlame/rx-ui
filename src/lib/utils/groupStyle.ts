/**
 * How a signature group looks: the colour of its findings' bars, marks
 * and ticks, and the class that carries that colour in either theme.
 *
 * Group names come from the backend's catalogue (`GET /v1/signatures`),
 * where a user's signature files may add groups, so no name is written
 * here. A group takes the palette colour at its `order`, the 1-based
 * place the catalogue gives it with the built-in groups first, so a
 * built-in group keeps its colour whatever user files add. A group past
 * the palette's end, or one the catalogue does not name (any group
 * before the catalogue loads), gets a colour chosen by hashing its name,
 * among the colours no listed group takes while any are left.
 */
import type { GroupInfo } from '../types';

/** A group's look: its palette class and its colour on a light background. */
export interface GroupStyle {
  /**
   * The palette class, `group-palette-<n>`. It sets `--rx-group-color` to
   * the group's colour for the theme around it (`paletteStyleSheet`), so
   * a style built on that variable reads in light and dark.
   */
  className: string;
  /** The colour on a light background, for a place a class cannot reach (Monaco's minimap). */
  color: string;
}

/** The palette, in group order: each colour for a light and for a dark background. */
export const GROUP_PALETTE: readonly { light: string; dark: string }[] = [
  { light: '#0ea5e9', dark: '#38bdf8' }, // sky
  { light: '#22c55e', dark: '#4ade80' }, // green
  { light: '#f97316', dark: '#fb923c' }, // orange
  { light: '#a855f7', dark: '#c084fc' }, // purple
  { light: '#14b8a6', dark: '#2dd4bf' }, // teal
  { light: '#e11d48', dark: '#fb7185' }, // rose
  { light: '#84cc16', dark: '#a3e635' }, // lime
  { light: '#eab308', dark: '#facc15' }, // yellow
  { light: '#3b82f6', dark: '#60a5fa' }, // blue
  { light: '#d946ef', dark: '#e879f9' }, // fuchsia
  { light: '#6366f1', dark: '#818cf8' }, // indigo
  { light: '#ec4899', dark: '#f472b6' }, // pink
  { light: '#06b6d4', dark: '#22d3ee' }, // cyan
];

/** Every palette index, in order. */
const PALETTE_INDICES: readonly number[] = GROUP_PALETTE.map((_, index) => index);

/** FNV-1a over the name's UTF-16 code units: stable, and spreads short names well. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The palette index of a group's `order`, or null for an order outside the palette. */
function indexOfOrder(order: number): number | null {
  const index = order - 1;
  return Number.isInteger(index) && index >= 0 && index < GROUP_PALETTE.length ? index : null;
}

/**
 * The palette index of a group without a place in the palette: by its
 * name's hash, among the indices no listed group takes while any are
 * free, over the whole palette when none is.
 */
function hashedIndex(group: string, groups: readonly GroupInfo[]): number {
  const taken = new Set(groups.map((listed) => indexOfOrder(listed.order)));
  const free = PALETTE_INDICES.filter((index) => !taken.has(index));
  const choices = free.length > 0 ? free : PALETTE_INDICES;
  return choices[hashName(group) % choices.length];
}

/** The palette index of a group: at its order, else by its name's hash. */
function paletteIndex(group: string, groups: readonly GroupInfo[]): number {
  const order = groups.find((candidate) => candidate.name === group)?.order;
  const placed = order === undefined ? null : indexOfOrder(order);
  return placed ?? hashedIndex(group, groups);
}

/** The look of one group, given the catalogue's groups (in any order). */
export function groupStyle(group: string, groups: readonly GroupInfo[]): GroupStyle {
  const index = paletteIndex(group, groups);
  return { className: `group-palette-${index}`, color: GROUP_PALETTE[index].light };
}

/**
 * A group's colour on a light and on a dark background, the same as its
 * palette class sets, for Monaco's minimap and scrollbar marks: they take
 * a colour and a dark-theme colour, not a class.
 */
export function groupColors(
  group: string,
  groups: readonly GroupInfo[],
): (typeof GROUP_PALETTE)[number] {
  return GROUP_PALETTE[paletteIndex(group, groups)];
}

/**
 * The palette classes as a stylesheet. Each class sets `--rx-group-color`:
 * the light colour by default and under a light editor (`.vs`), the dark
 * one under the app's dark theme (`.dark`) and under a dark editor
 * (`.vs-dark`). The editor's rules are the more specific, so a light
 * editor in a dark app keeps the light colour. Built from GROUP_PALETTE,
 * so the classes and `GroupStyle.color` cannot disagree.
 */
export function paletteStyleSheet(): string {
  return GROUP_PALETTE.map(({ light, dark }, i) => {
    const name = `group-palette-${i}`;
    return [
      `.${name} { --rx-group-color: ${light}; }`,
      `.dark .${name} { --rx-group-color: ${dark}; }`,
      `.monaco-editor.vs .${name} { --rx-group-color: ${light}; }`,
      `.monaco-editor.vs-dark .${name} { --rx-group-color: ${dark}; }`,
    ].join('\n');
  }).join('\n');
}

const PALETTE_STYLE_ID = 'rx-group-palette';

/** Adds the palette stylesheet to the document once. */
export function installPaletteStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(PALETTE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PALETTE_STYLE_ID;
  style.textContent = paletteStyleSheet();
  document.head.appendChild(style);
}
