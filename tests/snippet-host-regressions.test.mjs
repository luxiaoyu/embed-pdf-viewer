import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setTimeout } from 'node:timers';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve('esbuild', { paths: [dirname(require.resolve('vite'))] }),
);
function readSource(path) {
  const baseline = process.env.EMBEDPDF_REGRESSION_SOURCE_ROOT;
  const alternative = baseline && resolve(baseline, relative(process.cwd(), resolve(path)));
  return readFileSync(alternative && existsSync(alternative) ? alternative : path, 'utf8');
}

async function importSource(path, contents, mocks = {}) {
  const result = await build({
    ...(contents === undefined
      ? { entryPoints: [resolve(path)] }
      : {
          stdin: { contents, resolveDir: dirname(resolve(path)), sourcefile: path, loader: 'ts' },
        }),
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'host-regression-inputs',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'ts',
          }));
          builder.onLoad({ filter: /\.tsx?$/ }, ({ path }) => ({
            contents: readSource(path),
            loader: path.endsWith('.tsx') ? 'tsx' : 'ts',
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
}
const { createReadOnlyEngine } = await importSource(
  'packages/core/src/lib/registry/read-only-engine.ts',
);
const { PdfEngine } = await importSource('packages/engines/src/lib/orchestrator/pdf-engine.ts');
const { SearchPlugin } = await importSource('packages/plugin-search/src/lib/search-plugin.ts');
test('read-only search checks the existing permission helper and preserves allowed results', async () => {
  const host = {
    pluginConfig: { respectCopyPermission: true },
    checkPermission: () => false,
    state: { documents: { preview: { query: 'needle', results: [], total: 0 } } },
    getCoreDocument: () => ({ document: { id: 'preview' } }),
  };
  await assert.rejects(
    SearchPlugin.prototype.searchAllPages.call(host, 'needle', 'preview').toPromise(),
    (error) => error.reason.code === 5,
  );
  host.checkPermission = () => true;
  assert.deepEqual(
    await SearchPlugin.prototype.searchAllPages.call(host, 'needle', 'preview').toPromise(),
    { results: [], total: 0 },
  );
});
const { boundedPreviewScale } = await importSource(
  'viewers/snippet/src/components/preview-raster.ts',
);

test('oversized page previews are bounded independently of document byte size', () => {
  for (const [width, height] of [
    [4000, 4000],
    [300, 100000],
    [100000, 300],
  ]) {
    const scale = boundedPreviewScale(width, height, 2) * 2;
    assert.ok(width * height * scale * scale <= 8 * 1024 * 1024 + 1);
    assert.ok(Math.max(width, height) * scale <= 8192 + 1);
  }
});

const { getEffectivePermission } = await importSource('packages/core/src/lib/store/selectors.ts');
test('read-only mode wins over permission overrides without forcing copying on', () => {
  const state = {
    readOnly: true,
    globalPermissions: { enforceDocumentPermissions: false },
    documents: {
      preview: {
        permissions: { overrides: { modifyAnnotations: true } },
        document: { permissions: 0xffffffff },
      },
    },
  };
  assert.equal(getEffectivePermission(state, 'preview', 32), false);
  state.globalPermissions.enforceDocumentPermissions = true;
  state.documents.preview.document.permissions = 4;
  assert.equal(getEffectivePermission(state, 'preview', 16), false);
});

test('a worker crash after readiness makes future operations reject instead of hanging', async () => {
  const { RemoteExecutor } = await importSource(
    'packages/engines/src/lib/orchestrator/remote-executor.ts',
  );
  const listeners = new Map();
  const worker = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    postMessage: () => {},
    terminate: () => {},
  };
  const executor = new RemoteExecutor(worker, { wasmUrl: 'https://example.invalid/pdfium.wasm' });
  listeners.get('message')({ data: { id: '0', type: 'ready' } });
  listeners.get('error')();
  await assert.rejects(
    executor.getMetadata({ id: 'doc' }).toPromise(),
    (error) => error.reason.code === 10,
  );
  executor.destroy();
});

test('read-only registry rejects mutations and exports while preserving rendering', async () => {
  const calls = [];
  const target = Object.fromEntries(
    ['setFormFieldState', 'createPageAnnotation', 'saveAsCopy', 'setMetadata', 'newMutation'].map(
      (name) => [name, () => calls.push(name)],
    ),
  );
  target.renderPage = function () {
    assert.equal(this, target);
    return 'static raster';
  };
  const engine = createReadOnlyEngine(target);
  for (const name of Object.keys(target).filter((name) => name !== 'renderPage')) {
    await assert.rejects(engine[name]().toPromise(), (error) => error.reason.code === 5);
  }
  assert.equal(engine.renderPage(), 'static raster');
  assert.deepEqual(calls, []);
});

test('aborting a URL load cancels the fetch and never opens the worker document', async () => {
  let opened = 0;
  let requestedSignal;
  const engine = new PdfEngine(
    {
      openDocumentBuffer: () => {
        opened += 1;
      },
      destroy: () => {},
    },
    {
      imageConverter: {},
      fetcher: (_url, options) =>
        new Promise((_resolve, reject) => {
          requestedSignal = options.signal;
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    },
  );
  const task = engine.openDocumentUrl({
    id: 'cancel',
    url: 'https://example.invalid/document.pdf',
  });
  task.abort({ code: 9, message: 'closed' });
  await assert.rejects(task.toPromise(), (error) => error.reason.code === 9);
  assert.equal(requestedSignal.aborted, true);
  assert.equal(opened, 0);
  engine.destroy();
});

test('failed resource response is rejected before HTML can enter PDFium', async () => {
  let opened = 0;
  const engine = new PdfEngine(
    {
      openDocumentBuffer: () => {
        opened += 1;
      },
      destroy: () => {},
    },
    {
      imageConverter: {},
      fetcher: async () => new globalThis.Response('missing file', { status: 404 }),
    },
  );
  await assert.rejects(
    engine.openDocumentUrl({ id: 'missing', url: 'https://example.invalid/missing' }).toPromise(),
  );
  assert.equal(opened, 0);
  engine.destroy();
});

test('destroying an engine settles an incomplete URL task as cancelled', async () => {
  let aborted = false;
  const engine = new PdfEngine(
    { destroy: () => {} },
    {
      imageConverter: {},
      fetcher: (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('closed'));
          });
        }),
    },
  );
  const task = engine.openDocumentUrl({
    id: 'destroyed',
    url: 'https://example.invalid/large.pdf',
  });
  engine.destroy();
  await assert.rejects(task.toPromise(), (error) => error.reason.code === 9);
  assert.equal(aborted, true);
});

test('plugin category overrides survive while read-only restrictions remain enforced', () => {
  const ts = require('typescript');
  const path = 'viewers/snippet/src/components/app.tsx';
  const ast = ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const objects = new Map();
  const categoryInitializers = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      /^(?:disabledCategories|readOnlyDisabledCategories)$/.test(node.name.getText(ast))
    ) {
      categoryInitializers.push([node.name.getText(ast), node.initializer.getText(ast)]);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === 'createPluginRegistration' &&
      ['CommandsPluginPackage', 'UIPluginPackage'].includes(node.arguments[0]?.getText(ast))
    ) {
      objects.set(node.arguments[0].getText(ast), node.arguments[1].getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const configured = (config, plugin) => {
    const context = { config, DEFAULTS: { commands: {}, ui: {} } };
    for (const [name, expression] of categoryInitializers) {
      context[name] = runInNewContext(`(${expression})`, context);
    }
    return Array.from(runInNewContext(`(${objects.get(plugin)})`, context).disabledCategories);
  };
  for (const [plugin, key] of [
    ['CommandsPluginPackage', 'commands'],
    ['UIPluginPackage', 'ui'],
  ]) {
    assert.deepEqual(configured({ [key]: { disabledCategories: ['document-print'] } }, plugin), [
      'document-print',
    ]);
    assert.deepEqual(
      configured({ disabledCategories: ['annotation'], [key]: { disabledCategories: [] } }, plugin),
      [],
    );
    assert.deepEqual(configured({ disabledCategories: ['annotation'] }, plugin), ['annotation']);
    const readOnly = configured(
      { readOnly: true, [key]: { disabledCategories: ['custom'] } },
      plugin,
    );
    assert.ok(readOnly.includes('custom'));
    assert.ok(readOnly.includes('document-print'));
    assert.ok(readOnly.includes('annotation'));
  }
});

test('direct engine closes cached pages, documents and buffers before destroying PDFium', async () => {
  const { PdfiumNative } = await importSource('packages/engines/src/lib/pdfium/engine.ts');
  const calls = [];
  const module = {
    PDFiumExt_Init() {},
    FPDF_LoadPage: () => 30,
    FPDF_ClosePage: () => calls.push('page'),
    FPDF_CloseDocument: () => calls.push('document'),
    FPDF_DestroyLibrary: () => calls.push('library'),
    pdfium: { wasmExports: { malloc: () => 10, free: () => calls.push('buffer') } },
  };
  const native = new PdfiumNative(module, { fontFallback: null });
  const buffer = native.memoryManager.malloc(1024);
  native.cache.updateConfig({ pageTtl: 10 });
  native.cache.setDocument('doc', buffer, 20);
  native.cache.getContext('doc').acquirePage(0).release();
  const engine = new PdfEngine(native, { imageConverter: {} });
  try {
    await engine.destroy().toPromise();
    assert.deepEqual(calls, ['page', 'document', 'buffer', 'library']);
    assert.equal(native.cache.getCacheStats().documents, 0);
    assert.equal(native.memoryManager.getStats().totalAllocated, 0);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(calls, ['page', 'document', 'buffer', 'library']);
  } finally {
    native.cache.closeAllDocuments();
  }
});

for (const framework of ['vue', 'svelte']) {
  test(`${framework} shortcut listeners honor the filter and defaultPrevented`, async () => {
    const { CommandsPlugin } = await importSource(
      'packages/plugin-commands/src/lib/commands-plugin.ts',
    );
    const path =
      framework === 'vue'
        ? 'packages/plugin-commands/src/vue/components/keyboard-shortcuts.vue'
        : 'packages/plugin-commands/src/svelte/components/KeyboardShortcuts.svelte';
    let source;
    if (framework === 'vue') {
      const compiler = createRequire(resolve('packages/plugin-commands/package.json'))(
        'vue/compiler-sfc',
      );
      source = compiler.compileScript(compiler.parse(readSource(path)).descriptor, {
        id: 'shortcut-regression',
      }).content;
    } else {
      source = readSource(path).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
    }
    const originalDocument = globalThis.document;
    const listeners = new Map();
    let allowed = false;
    let executed = 0;
    let checked = 0;
    const plugin = {
      shortcutFilter: () => {
        checked++;
        return allowed;
      },
      shouldHandleShortcut: CommandsPlugin.prototype.shouldHandleShortcut,
    };
    globalThis.__embedPdfShortcutFixture = {
      commands: {
        getCommandByShortcut: () => ({ id: 'find' }),
        resolve: () => ({ disabled: false, visible: true }),
        execute: () => executed++,
      },
      plugin,
    };
    globalThis.document = {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    };
    const mocks = {
      vue: `export const defineComponent = value => value;
        export const onMounted = fn => globalThis.__embedPdfShortcutFixture.mount = fn;
        export const onUnmounted = fn => globalThis.__embedPdfShortcutFixture.cleanup = fn;`,
      svelte: `export const onMount = fn => globalThis.__embedPdfShortcutFixture.mount = fn;`,
      '../hooks':
        framework === 'vue'
          ? `export const useCommandsCapability = () => ({provides:{value:globalThis.__embedPdfShortcutFixture.commands}});
           export const useCommandsPlugin = () => ({plugin:{value:globalThis.__embedPdfShortcutFixture.plugin}});`
          : `export const useCommandsCapability = () => ({provides:globalThis.__embedPdfShortcutFixture.commands});
           export const useCommandsPlugin = () => ({plugin:globalThis.__embedPdfShortcutFixture.plugin});`,
    };
    let cleanup;
    try {
      const component = await importSource(path, source, mocks);
      component.default?.setup({}, { expose() {} });
      cleanup = globalThis.__embedPdfShortcutFixture.mount();
      const event = (defaultPrevented = false) => ({
        key: 'f',
        metaKey: true,
        defaultPrevented,
        composedPath: () => [{ tagName: 'DIV' }],
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {},
      });
      listeners.get('keydown')(event());
      assert.equal(executed, 0);
      assert.equal(checked, 1);
      allowed = true;
      const accepted = event();
      listeners.get('keydown')(accepted);
      assert.equal(executed, 1);
      assert.equal(accepted.defaultPrevented, true);
      listeners.get('keydown')(event(true));
      assert.equal(executed, 1);
      assert.equal(checked, 2);
      (cleanup ?? globalThis.__embedPdfShortcutFixture.cleanup)();
      assert.equal(listeners.size, 0);
    } finally {
      if (listeners.size) (cleanup ?? globalThis.__embedPdfShortcutFixture.cleanup)?.();
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      delete globalThis.__embedPdfShortcutFixture;
    }
  });
}

test('relative zoom-out clamps to minZoom while invalid absolute requests are ignored', async () => {
  const { ZoomPlugin } = await importSource('packages/plugin-zoom/src/lib/zoom-plugin.ts');
  const zooms = [];
  const scope = {
    minZoom: 0.05,
    maxZoom: Number.POSITIVE_INFINITY,
    zoomStep: 0.1,
    zoomRanges: [],
    getDocumentStateOrThrow: () => ({ currentZoomLevel: 0.1 }),
    coreState: { core: { documents: { doc: {} } } },
    viewport: {
      forDocument: () => ({
        getMetrics: () => ({ clientWidth: 800, clientHeight: 600 }),
        scrollTo() {},
      }),
      isGated: () => false,
    },
    viewportPlugin: { setViewportScrollMetrics() {} },
    computeScrollForZoomChange: () => ({ desiredScrollLeft: 0, desiredScrollTop: 0 }),
    dispatch() {},
    dispatchCoreAction() {},
    zoom$: { emit: (event) => zooms.push(event.newZoom) },
    handleRequest: ZoomPlugin.prototype.handleRequest,
    stepFor: ZoomPlugin.prototype.stepFor,
  };
  ZoomPlugin.prototype.zoomOut.call(scope, 'doc');
  assert.deepEqual(zooms, [0.05]);
  zooms.length = 0;
  for (const level of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    ZoomPlugin.prototype.handleRequest.call(scope, { level }, 'doc');
  }
  assert.deepEqual(zooms, []);
  ZoomPlugin.prototype.handleRequest.call(scope, { level: 20 }, 'doc');
  assert.deepEqual(zooms, [20]);
});
