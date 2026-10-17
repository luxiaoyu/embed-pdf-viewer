import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve('esbuild', { paths: [dirname(require.resolve('vite'))] }),
);
let playwright;
for (const name of ['playwright', '@playwright/test']) {
  try {
    const paths = process.env.EMBEDPDF_BROWSER_TEST_MODULES
      ? [process.env.EMBEDPDF_BROWSER_TEST_MODULES, process.cwd()]
      : [process.cwd()];
    playwright = require(require.resolve(name, { paths }));
    break;
  } catch {
    // Browser coverage is optional in installations containing only the SDK build tools.
  }
}

async function assertActiveTab(page, documentId, tabId) {
  await page.waitForFunction(
    ({ documentId, tabId }) =>
      document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-label') ===
        tabId &&
      document.querySelector('[role="tabpanel"][aria-hidden="false"]')?.textContent ===
        `${documentId}:${tabId}`,
    { documentId, tabId },
  );
  assert.equal(await page.getByRole('tab', { name: tabId, exact: true }).isVisible(), true);
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test(
  'sidebar defaults follow bookmark results without replacing reader choices or later documents',
  { skip: !playwright && 'Install Playwright or set EMBEDPDF_BROWSER_TEST_MODULES' },
  async (t) => {
    const mocks = {
      '@embedpdf/core/preact': `
        export const useDocumentState = id => globalThis.sidebarReview.documents[id];`,
      '@embedpdf/models': `export const PdfErrorCode = {Cancelled:'cancelled'};`,
      '@embedpdf/plugin-bookmark/preact': `
        export const useBookmarkCapability = () => ({provides:globalThis.sidebarReview.bookmark});`,
      '@embedpdf/plugin-i18n/preact': `
        export const useTranslations = () => ({translate:key=>key});`,
      '@embedpdf/plugin-ui/preact': `
        export const useUIContainer = () => ({getContainer:globalThis.sidebarReview.getContainer});
        export const useItemRenderer = () => ({
          renderCustomComponent:globalThis.sidebarReview.renderContent});`,
    };
    const sidebar = resolve('viewers/snippet/src/ui/schema-sidebar.tsx');
    const bundle = await build({
      stdin: {
        contents: `import {h,render} from 'preact';
          import {SchemaSidebar} from ${JSON.stringify(sidebar)};
          const schema = {id:'navigation',position:{placement:'left'},width:280,
            content:{type:'tabs',tabs:['outline','thumbnails'].map(id=>({id,label:id,componentId:id}))}};
          const state = globalThis.sidebarReview = {
            documents:{},tasks:[],getContainer:()=>document.querySelector('#ui'),
            renderContent:(id,documentId)=>h('div',{},documentId+':'+id),
            bookmark:{forDocument:documentId=>({getBookmarks:()=>({
              wait:(success,failure)=>state.tasks.push({documentId,success,failure,aborted:false}),
              abort:()=>{state.tasks.findLast(task=>task.documentId===documentId).aborted=true;}
            })})},
            open:(documentId,ready=true)=>{
              state.documents[documentId] ??= {document:undefined};
              if(ready) state.documents[documentId].document ??= {id:documentId};
              render(h(SchemaSidebar,{schema,documentId,isOpen:true,onClose:()=>{}}),
                document.querySelector('#mount'));
            }
          };`,
        sourcefile: 'sidebar-defaults-regression.tsx',
        resolveDir: resolve('viewers/snippet'),
        loader: 'tsx',
      },
      tsconfig: resolve('viewers/snippet/tsconfig.json'),
      platform: 'browser',
      format: 'iife',
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'sidebar-regression-inputs',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
            );
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'ts',
            }));
            builder.onLoad({ filter: /\.tsx?$/ }, ({ path }) => {
              const baseline = process.env.EMBEDPDF_REGRESSION_SOURCE_ROOT;
              const alternative = baseline && resolve(baseline, relative(process.cwd(), path));
              return {
                contents: readFileSync(
                  alternative && existsSync(alternative) ? alternative : path,
                  'utf8',
                ),
                loader: path.endsWith('.tsx') ? 'tsx' : 'ts',
              };
            });
          },
        },
      ],
    });
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      for (const [presentation, width] of [
        ['sidebar', 1000],
        ['drawer', 500],
      ]) {
        await t.test(presentation, async () => {
          const page = await browser.newPage({ viewport: { width, height: 700 } });
          try {
            await page.setContent(`<style>
              body{margin:0}#ui{position:relative;width:100vw;height:100vh}
              .absolute{position:absolute}.inset-0{inset:0}.inset-x-0{left:0;right:0}
              .bottom-0{bottom:0}.z-40{z-index:40}.z-50{z-index:50}
              .flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}
              .h-full{height:100%}.min-h-0{min-height:0}.relative{position:relative}
              button{height:32px}
            </style><div id="ui"><div id="mount"></div></div>`);
            await page.addScriptTag({ content: bundle.outputFiles[0].text });
            const open = async (documentId, ready = true) => {
              await page.evaluate(
                ({ documentId, ready }) => globalThis.sidebarReview.open(documentId, ready),
                { documentId, ready },
              );
              await assertActiveTab(page, documentId, 'outline');
              assert.equal(
                await page.locator('[data-sidebar-id]').getAttribute('data-sidebar-presentation'),
                presentation,
              );
              if (ready) {
                await page.waitForFunction(
                  (id) => globalThis.sidebarReview.tasks.some((task) => task.documentId === id),
                  documentId,
                );
              }
            };
            const finish = async (documentId, result) => {
              await page.evaluate(
                ({ documentId, result }) => {
                  const task = globalThis.sidebarReview.tasks.find(
                    (task) => task.documentId === documentId,
                  );
                  if (result === 'error') task.failure(new Error('Bookmark read failed'));
                  else task.success({ bookmarks: result });
                },
                { documentId, result },
              );
              await settle(page);
            };

            await open('empty', false);
            assert.equal(await page.evaluate(() => globalThis.sidebarReview.tasks.length), 0);
            await open('empty');
            await finish('empty', []);
            await assertActiveTab(page, 'empty', 'thumbnails');

            await open('outlined');
            await finish('outlined', [{ id: 'chapter' }]);
            await assertActiveTab(page, 'outlined', 'outline');

            await open('failed');
            await finish('failed', 'error');
            await assertActiveTab(page, 'failed', 'outline');

            await open('reader-choice');
            await page.getByRole('tab', { name: 'thumbnails', exact: true }).click();
            await assertActiveTab(page, 'reader-choice', 'thumbnails');
            await page.getByRole('tab', { name: 'outline', exact: true }).click();
            await finish('reader-choice', []);
            await assertActiveTab(page, 'reader-choice', 'outline');

            await open('old');
            await open('replacement');
            assert.equal(
              await page.evaluate(
                () =>
                  globalThis.sidebarReview.tasks.find((task) => task.documentId === 'old').aborted,
              ),
              true,
            );
            // Deliver after abort as well: a task implementation may already have queued its callback.
            await finish('old', []);
            await assertActiveTab(page, 'replacement', 'outline');
            await finish('replacement', []);
            await assertActiveTab(page, 'replacement', 'thumbnails');
            await open('next-document');
          } finally {
            await page.close();
          }
        });
      }
    } finally {
      await browser.close();
    }
  },
);
