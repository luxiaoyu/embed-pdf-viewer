import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve('esbuild', { paths: [dirname(require.resolve('vite'))] }),
);

async function importSource(path) {
  const result = await build({
    entryPoints: [resolve(path)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const { createTextSelectionHandler } = await importSource(
  'packages/plugin-selection/src/lib/handlers/text-selection.handler.ts',
);
const { createPointerProvider } = await importSource(
  'packages/plugin-interaction-manager/src/shared/utils.ts',
);
const { SelectionPlugin } = await importSource(
  'packages/plugin-selection/src/lib/selection-plugin.ts',
);
const { wheelZoomFactor } = await importSource(
  'packages/plugin-zoom/src/shared/utils/zoom-gesture-logic.ts',
);
const { zoomRequestForArea } = await importSource('packages/plugin-zoom/src/lib/zoom-to-area.ts');

function selectionHandlers() {
  let selecting = false;
  let activePointerId;
  let ends = 0;
  const updates = [];
  const geometry = {
    runs: [
      {
        charStart: 0,
        rect: { x: 0, y: 0, width: 60, height: 20 },
        glyphs: [
          { x: 0, y: 0, width: 20, height: 20, flags: 0 },
          { x: 30, y: 0, width: 20, height: 20, flags: 0 },
        ],
      },
    ],
  };
  const makeHandler = (page) =>
    createTextSelectionHandler({
      getGeometry: () => geometry,
      isEnabled: () => true,
      onBegin: (_glyph, _mode, pointerId) => {
        selecting = true;
        activePointerId = pointerId;
      },
      onUpdate: (glyph) => updates.push([page, glyph]),
      onEnd: () => {
        selecting = false;
        activePointerId = undefined;
        ends += 1;
      },
      onClear: () => {
        selecting = false;
        activePointerId = undefined;
      },
      isSelecting: () => selecting,
      isActivePointer: (pointerId) =>
        activePointerId === undefined || activePointerId === pointerId,
      setCursor: () => {},
    });
  return { makeHandler, updates, getEnds: () => ends, isSelecting: () => selecting };
}

test('dragging onto the next page ends on that page pointerup', () => {
  const state = selectionHandlers();
  const first = state.makeHandler(0);
  const second = state.makeHandler(1);
  const event = { target: {}, currentTarget: {} };

  first.onPointerDown({ x: 5, y: 5 }, event, 'pointerMode');
  first.onPointerMove({ x: 35, y: 5 }, event, 'pointerMode');
  second.onPointerMove({ x: 5, y: 5 }, event, 'pointerMode');
  assert.equal(state.isSelecting(), true);
  assert.deepEqual(state.updates, [
    [0, 1],
    [1, 0],
  ]);

  second.onPointerUp({ x: 5, y: 5 }, event, 'pointerMode');
  assert.equal(state.isSelecting(), false);
  assert.equal(state.getEnds(), 1);

  // A window capture handler may finish the selection before the original
  // page receives pointerup. Its stale drag anchor must not emit a second end.
  first.onPointerUp({ x: 35, y: 5 }, event, 'pointerMode');
  assert.equal(state.getEnds(), 1);

  first.onPointerMove({ x: 35, y: 5 }, event, 'pointerMode');
  assert.deepEqual(state.updates, [
    [0, 1],
    [1, 0],
  ]);
  first.onPointerDown({ x: 5, y: 5 }, event, 'pointerMode');
  first.onPointerUp({ x: 5, y: 5 }, event, 'pointerMode');
  assert.equal(state.getEnds(), 1);
});

test('cross-page pointercancel also ends the active selection', () => {
  const state = selectionHandlers();
  const second = state.makeHandler(1);
  const first = state.makeHandler(0);
  const event = { target: {}, currentTarget: {} };
  first.onPointerDown({ x: 5, y: 5 }, event, 'pointerMode');
  first.onPointerMove({ x: 35, y: 5 }, event, 'pointerMode');
  second.onPointerCancel({ x: 5, y: 5 }, event, 'pointerMode');
  assert.equal(state.isSelecting(), false);
  assert.equal(state.getEnds(), 1);
});

test('a second touch cannot update or end the first touch selection', () => {
  const state = selectionHandlers();
  const first = state.makeHandler(0);
  const second = state.makeHandler(1);
  const firstTouch = { target: {}, currentTarget: {}, pointerId: 11, pointerType: 'touch' };
  const secondTouch = { ...firstTouch, pointerId: 12 };

  first.onPointerDown({ x: 5, y: 5 }, firstTouch, 'pointerMode');
  first.onPointerMove({ x: 35, y: 5 }, firstTouch, 'pointerMode');
  second.onPointerMove({ x: 5, y: 5 }, secondTouch, 'pointerMode');
  second.onPointerUp({ x: 5, y: 5 }, secondTouch, 'pointerMode');
  assert.equal(state.isSelecting(), true);
  assert.deepEqual(state.updates, [[0, 1]]);

  second.onPointerMove({ x: 5, y: 5 }, firstTouch, 'pointerMode');
  second.onPointerUp({ x: 5, y: 5 }, firstTouch, 'pointerMode');
  assert.deepEqual(state.updates, [
    [0, 1],
    [1, 0],
  ]);
  assert.equal(state.isSelecting(), false);
  assert.equal(state.getEnds(), 1);
  // The first page still has an old drag anchor after a cross-page release.
  first.onPointerDown({ x: 5, y: 5 }, secondTouch, 'pointerMode');
  first.onPointerMove({ x: 35, y: 5 }, secondTouch, 'pointerMode');
  assert.equal(state.isSelecting(), true);
});

test('a new pointer can replace a stale anchor after release on another page', () => {
  const state = selectionHandlers();
  const first = state.makeHandler(0);
  const second = state.makeHandler(1);
  const firstTouch = { target: {}, currentTarget: {}, pointerId: 11, pointerType: 'touch' };
  const nextTouch = { ...firstTouch, pointerId: 12 };

  first.onPointerDown({ x: 5, y: 5 }, firstTouch, 'pointerMode');
  second.onPointerUp({ x: 5, y: 5 }, firstTouch, 'pointerMode');
  first.onPointerDown({ x: 5, y: 5 }, nextTouch, 'pointerMode');
  first.onPointerMove({ x: 35, y: 5 }, nextTouch, 'pointerMode');
  assert.equal(state.isSelecting(), true);
});

test('the page pointer provider forwards native pointer identity', () => {
  const element = new EventTarget();
  element.style = {};
  element.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const received = [];
  const documentScope = {
    getActiveInteractionMode: () => ({ wantsRawTouch: true }),
    getActiveMode: () => 'pointerMode',
    getCurrentCursor: () => 'auto',
    onModeChange: () => () => {},
    onCursorChange: () => () => {},
  };
  const capability = {
    forDocument: () => documentScope,
    getHandlersForScope: () => ({ onPointerDown: (_position, event) => received.push(event) }),
    getExclusionRules: () => ({}),
    isPaused: () => false,
    onHandlerChange: () => () => {},
  };
  const cleanup = createPointerProvider(
    capability,
    { type: 'page', documentId: 'doc', pageIndex: 0 },
    element,
  );

  try {
    const event = new Event('pointerdown');
    Object.assign(event, { clientX: 5, clientY: 6, pointerId: 11, pointerType: 'touch' });
    element.dispatchEvent(event);
    assert.equal(received[0]?.pointerId, 11);
    assert.equal(received[0]?.pointerType, 'touch');
  } finally {
    cleanup();
  }
});

test('the window release watcher ignores another touch and its mouse event', () => {
  const originalWindow = globalThis.window;
  const target = new EventTarget();
  globalThis.window = target;
  let ends = 0;
  const scope = {
    selecting: new Map([['doc', true]]),
    stopReleaseWatch: new Map(),
    stopWatchingRelease: SelectionPlugin.prototype.stopWatchingRelease,
    endSelection(documentId) {
      ends += 1;
      this.selecting.set(documentId, false);
      this.stopWatchingRelease(documentId);
    },
  };

  try {
    SelectionPlugin.prototype.watchReleaseOutsidePages.call(
      scope,
      'doc',
      'pointerMode',
      11,
      'touch',
    );
    const release = (type, pointerId) => {
      const event = new Event(type);
      event.pointerId = pointerId;
      target.dispatchEvent(event);
    };
    release('pointerup', 12);
    release('mouseup', 12);
    assert.equal(ends, 0);
    release('pointercancel', 11);
    assert.equal(ends, 1);
    release('pointerup', 11);
    assert.equal(ends, 1);

    scope.selecting.set('doc', true);
    SelectionPlugin.prototype.watchReleaseOutsidePages.call(
      scope,
      'doc',
      'pointerMode',
      1,
      'mouse',
    );
    release('mouseup', 1);
    assert.equal(ends, 2);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('one wheel notch is bounded while small trackpad deltas stay smooth', () => {
  const zoomOut = wheelZoomFactor(120, 0, 800);
  const zoomIn = wheelZoomFactor(-120, 0, 800);
  assert.ok(zoomOut > 0.85 && zoomOut < 1);
  assert.ok(zoomIn > 1 && zoomIn < 1.2);
  assert.ok(Math.abs(zoomOut * zoomIn - 1) < 1e-10);
  assert.ok(wheelZoomFactor(1, 0, 800) > 0.99);
  assert.ok(wheelZoomFactor(1000, 0, 800) >= zoomOut);
  assert.equal(wheelZoomFactor(Number.NaN, 0, 800), 1);
});

test('marquee zoom uses the rotated page rect and its centering offset', () => {
  const calls = [];
  const sourceRect = { origin: { x: 100, y: 200 }, size: { width: 100, height: 50 } };
  const scroll = {
    getLayout: () => ({ totalContentSize: { width: 800, height: 600 } }),
    getRectPositionForPage(...args) {
      calls.push(args);
      const scale = args[2];
      // A 600x800 page rotated 90 degrees: the requested source rectangle
      // appears at x=550, y=100 with width=50 and height=100.
      return {
        origin: { x: 550 * scale, y: 100 * scale },
        size: { width: 50 * scale, height: 100 * scale },
      };
    },
  };

  const request = zoomRequestForArea({
    scroll,
    pageIndex: 0,
    rect: sourceRect,
    oldZoom: 1,
    viewport: { clientWidth: 1000, clientHeight: 500, scrollLeft: 0, scrollTop: 0 },
    viewportGap: 20,
  });

  assert.deepEqual(request, { level: 4.6, center: { vx: 675, vy: 170 } });
  assert.deepEqual(calls, [
    [0, sourceRect, 1],
    [0, sourceRect, 1],
  ]);
});

test('a one-axis marquee still fits its nonzero dimension', () => {
  const scroll = {
    getLayout: () => ({ totalContentSize: { width: 800, height: 600 } }),
    getRectPositionForPage(_page, rect, scale) {
      return {
        origin: { x: rect.origin.x * scale, y: rect.origin.y * scale },
        size: { width: rect.size.width * scale, height: rect.size.height * scale },
      };
    },
  };
  const request = (width, height) =>
    zoomRequestForArea({
      scroll,
      pageIndex: 0,
      rect: { origin: { x: 100, y: 200 }, size: { width, height } },
      oldZoom: 1,
      viewport: { clientWidth: 1000, clientHeight: 500, scrollLeft: 0, scrollTop: 0 },
      viewportGap: 20,
    });

  assert.equal(request(100, 0)?.level, 9.6);
  assert.equal(request(0, 100)?.level, 4.6);
  assert.equal(request(0, 0), null);
});
