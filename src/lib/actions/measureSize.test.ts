// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureHeight, measureWidth } from './measureSize';

/** An element whose height is `height.px`, as a browser's layout would give it. */
function elementOfHeight(height: { px: number }): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => height.px });
  return element;
}

/** A ResizeObserver whose observers a test calls itself. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  isDisconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.isDisconnected = true;
  }
}

afterEach(() => {
  FakeResizeObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('measureHeight', () => {
  it('reports the height at once, and again when a ResizeObserver sees it change', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const height = { px: 1000 };
    const element = elementOfHeight(height);
    const heights: number[] = [];

    const action = measureHeight(element, (px) => heights.push(px));
    height.px = 2000;
    FakeResizeObserver.instances[0].callback();
    action.destroy();

    expect(heights).toEqual([1000, 2000]);
    expect(FakeResizeObserver.instances[0].observed).toEqual([element]);
    expect(FakeResizeObserver.instances[0].isDisconnected).toBe(true);
  });

  it("follows the window's size where there is no ResizeObserver, until destroyed", () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const height = { px: 300 };
    const heights: number[] = [];

    const action = measureHeight(elementOfHeight(height), (px) => heights.push(px));
    height.px = 600;
    window.dispatchEvent(new Event('resize'));
    action.destroy();
    height.px = 900;
    window.dispatchEvent(new Event('resize'));

    expect(heights).toEqual([300, 600]);
  });

  it('reports to the callback it was last given', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const height = { px: 300 };
    const first: number[] = [];
    const second: number[] = [];

    const action = measureHeight(elementOfHeight(height), (px) => first.push(px));
    action.update((px) => second.push(px));
    window.dispatchEvent(new Event('resize'));
    action.destroy();

    expect(first).toEqual([300]);
    expect(second).toEqual([300]);
  });
});

describe('measureWidth', () => {
  it("reports the width at once, and again when the window's size changes", () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const width = { px: 640 };
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => width.px });
    const widths: number[] = [];

    const action = measureWidth(element, (px) => widths.push(px));
    width.px = 800;
    window.dispatchEvent(new Event('resize'));
    action.destroy();

    expect(widths).toEqual([640, 800]);
  });
});
