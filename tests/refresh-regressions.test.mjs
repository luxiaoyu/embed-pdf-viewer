import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

function loadTypeScript(file, mocks = {}, cache = new Map()) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} };
  cache.set(path, module);
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const require = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('.'))
      return loadTypeScript(resolve(dirname(path), `${name}.ts`), mocks, cache);
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function('require', 'module', 'exports', source)(require, module, module.exports);
  return module.exports;
}

class FakeBasePlugin {
  constructor(id, registry) {
    this.registry = registry;
    this.engine = registry.engine;
    this.coreState = registry.state;
    this.coreStore = registry.store;
    this.logger = { debug() {} };
  }
  getActiveDocumentId() {
    return 'doc';
  }
  getCoreDocument(id) {
    return this.coreState.core.documents[id];
  }
  dispatch(action) {
    this.registry.dispatched?.push(action);
  }
}

function scopedEmitter() {
  const listeners = new Map();
  return {
    forScope: (id) => (listener) => {
      listeners.set(id, listener);
      return () => listeners.delete(id);
    },
    emit: (id, value) => listeners.get(id)?.(value),
    onGlobal() {},
    clearScope() {},
    clear() {},
  };
}

test('thumbnail refresh removes and aborts old tasks before publishing the new generation', () => {
  const { Task } = loadTypeScript('packages/models/src/task.ts');
  const listeners = new Map();
  const tasks = [];
  const registry = {
    state: {
      core: {
        documents: {
          doc: { document: { pages: [{ index: 0, size: { width: 100, height: 200 } }] } },
        },
      },
    },
    store: { onAction: (type, listener) => listeners.set(type, listener) },
    getPlugin: (name) =>
      name === 'render'
        ? {
            provides: () => ({
              forDocument: () => ({
                renderPageRect: () => {
                  const task = new Task();
                  tasks.push(task);
                  return task;
                },
              }),
            }),
          }
        : undefined,
  };
  const { ThumbnailPlugin } = loadTypeScript(
    'packages/plugin-thumbnail/src/lib/thumbnail-plugin.ts',
    {
      '@embedpdf/core': {
        BasePlugin: FakeBasePlugin,
        createScopedEmitter: scopedEmitter,
        REFRESH_PAGES: 'REFRESH_PAGES',
      },
      '@embedpdf/models': { ignore() {}, PdfErrorCode: { Cancelled: 3 } },
    },
  );
  const plugin = new ThumbnailPlugin('thumbnail', registry, {});
  plugin.onDocumentLoadingStarted('doc');
  const thumbnails = plugin.buildCapability().forDocument('doc');
  const old = thumbnails.renderThumb(0, 2);
  let next;
  thumbnails.onRefreshPages(() => {
    next = thumbnails.renderThumb(0, 2);
  });
  listeners.get('REFRESH_PAGES')({ payload: { documentId: 'doc', pageIndexes: [0] } });
  assert.equal(old.state.stage, 3);
  assert.notEqual(next, old);
  assert.equal(thumbnails.renderThumb(0, 2), next);
  old.resolve('stale pixels');
  assert.equal(old.state.stage, 3);
  next.resolve('current pixels');
  assert.equal(thumbnails.renderThumb(0, 2).state.result, 'current pixels');
});

test('a late thumbnail result cannot paint after its effect is replaced', (t) => {
  const effects = [];
  const updates = [];
  const callbacks = [];
  const objectUrls = [];
  const originalUrl = URL.createObjectURL;
  const originalWindow = globalThis.window;
  t.after(() => {
    URL.createObjectURL = originalUrl;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  URL.createObjectURL = (value) => {
    objectUrls.push(value);
    return 'blob:test';
  };
  globalThis.window = { devicePixelRatio: 2 };
  const { ThumbImg } = loadTypeScript(
    'packages/plugin-thumbnail/src/shared/components/thumbnail-img.tsx',
    {
      '@framework': {
        useEffect: (effect) => effects.push(effect),
        useState: (initial) => [initial, (value) => updates.push(value)],
        useRef: (current) => ({ current }),
      },
      '@embedpdf/models': { ignore() {}, PdfErrorCode: { Cancelled: 3 } },
      '../hooks': {
        useThumbnailPlugin: () => ({}),
        useThumbnailCapability: () => ({
          provides: {
            forDocument: () => ({
              renderThumb: () => ({ wait: (callback) => callbacks.push(callback), abort() {} }),
            }),
          },
        }),
      },
      'react/jsx-runtime': { jsx: () => null },
    },
  );
  ThumbImg({ documentId: 'doc', meta: { pageIndex: 0 } });
  const cleanupOld = effects[1]();
  cleanupOld();
  ThumbImg({ documentId: 'doc', meta: { pageIndex: 0 } });
  const cleanupNew = effects[3]();
  callbacks[1]('current pixels');
  callbacks[0]('stale pixels'); // A worker may finish even after its task was canceled.
  assert.deepEqual(objectUrls, ['current pixels']);
  assert.deepEqual(updates, ['blob:test']);
  cleanupNew();
});

test('tile refreshes in the same millisecond still replace their image generation', async (t) => {
  t.mock.method(Date, 'now', () => 12345);
  const document = { pages: [{ index: 0, size: { width: 100, height: 200 } }] };
  const registry = {
    state: { core: { documents: { doc: { document, scale: 1, rotation: 0 } } } },
    store: { onAction() {} },
    dispatched: [],
    getPlugin: (name) => ({
      provides: () =>
        name === 'scroll'
          ? {
              onScroll() {},
              forDocument: () => ({
                getMetrics: () => ({ pageVisibilityMetrics: [{ pageNumber: 1 }] }),
              }),
            }
          : name === 'viewport'
            ? { forDocument: () => ({ getMetrics: () => ({}) }) }
            : {},
    }),
  };
  const { TilingPlugin } = loadTypeScript('packages/plugin-tiling/src/lib/tiling-plugin.ts', {
    '@embedpdf/core': {
      BasePlugin: FakeBasePlugin,
      createBehaviorEmitter: () => ({ on() {}, emit() {} }),
      REFRESH_PAGES: 'REFRESH_PAGES',
    },
    '@embedpdf/models': {},
    './utils': { calculateTilesForPage: () => [{ id: 'tile' }] },
  });
  const plugin = new TilingPlugin('tiling', registry, {});
  await plugin.recalculateTiles({ documentId: 'doc', pageIndexes: [0] });
  await plugin.recalculateTiles({ documentId: 'doc', pageIndexes: [0] });
  const ids = registry.dispatched.map((action) => action.payload.tiles[0][0].id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});
