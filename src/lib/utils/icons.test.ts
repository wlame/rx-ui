import { describe, expect, it } from 'vitest';
import { ICONS, type IconName, type IconShape } from './icons';

const ICON_NAMES: readonly IconName[] = [
  'files',
  'search',
  'keyboard',
  'layers',
  'tag',
  'square-stack',
  'arrow-up',
  'arrow-down',
  'radar',
  'eye',
  'eye-off',
  'copy',
];

const SHAPE_TAGS: readonly IconShape['tag'][] = ['path', 'circle', 'rect', 'line', 'polyline'];

describe('ICONS', () => {
  it('has a row for every icon name and no other', () => {
    expect(Object.keys(ICONS).sort()).toEqual([...ICON_NAMES].sort());
  });

  it.each(ICON_NAMES)('draws %s with at least one shape of a known tag', (name) => {
    const shapes = ICONS[name];

    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(SHAPE_TAGS).toContain(shape.tag);
      expect(Object.keys(shape.attrs).length).toBeGreaterThan(0);
      for (const value of Object.values(shape.attrs)) expect(typeof value).toBe('string');
    }
  });

  // The shapes are Lucide's, as its ISC notice in icons.ts covers them.
  it('draws eye, eye-off and copy as lucide-static 1.54.0 ships them', () => {
    expect(ICONS.eye).toEqual([
      {
        tag: 'path',
        attrs: {
          d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
        },
      },
      { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
    ]);
    expect(ICONS['eye-off']).toEqual([
      {
        tag: 'path',
        attrs: {
          d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
        },
      },
      { tag: 'path', attrs: { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' } },
      {
        tag: 'path',
        attrs: {
          d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
        },
      },
      { tag: 'path', attrs: { d: 'm2 2 20 20' } },
    ]);
    expect(ICONS.copy).toEqual([
      { tag: 'rect', attrs: { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' } },
      { tag: 'path', attrs: { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' } },
    ]);
  });

  it('gives a path its outline and nothing that runs', () => {
    for (const shapes of Object.values(ICONS)) {
      for (const shape of shapes) {
        for (const attribute of Object.keys(shape.attrs)) expect(attribute).not.toMatch(/^on/i);
        if (shape.tag === 'path') expect(shape.attrs.d).toMatch(/^[mM]/);
      }
    }
  });
});
