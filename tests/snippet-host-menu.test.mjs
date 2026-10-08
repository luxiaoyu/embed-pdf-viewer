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

test(
  'hosted mobile menus receive command clicks and backdrop dismissal',
  { skip: !playwright && 'Install Playwright or set EMBEDPDF_BROWSER_TEST_MODULES' },
  async () => {
    const mocks = {
      '@embedpdf/plugin-ui/preact': `
        export const useUIContainer = () => ({getContainer: globalThis.getReviewMenuContainer});
        export const useUISchema = () => ({menus:{}});
        export const getUIItemProps = item => ({'data-epdf-i':item.id});`,
      '@embedpdf/plugin-commands/preact': `
        export const useCommand = () => ({label:'Menu command',visible:true,disabled:false,
          execute:()=>globalThis.reviewMenuStats.commands++});`,
      '@embedpdf/plugin-i18n/preact': `
        export const useTranslations = () => ({translate:key=>key});`,
    };
    const menu = resolve('viewers/snippet/src/ui/schema-menu.tsx');
    const bundle = await build({
      stdin: {
        contents: `import {h,render} from 'preact';
          import {SchemaMenu} from ${JSON.stringify(menu)};
          globalThis.openReviewMenu = () => {
            const root=globalThis.getReviewMenuContainer();
            render(null,root);
            render(h(SchemaMenu,{documentId:'doc',
              schema:{id:'menu-root',items:[{id:'menu-command',type:'command',commandId:'find'}]},
              onClose:()=>globalThis.reviewMenuStats.closes++}),root);
          };`,
        sourcefile: 'host-menu-regression.tsx',
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
          name: 'menu-regression-inputs',
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
      const page = await browser.newPage({ viewport: { width: 500, height: 600 } });
      await page.setContent(`<button id="under" style="position:fixed;inset:0;width:100%;height:100%">Underlying page</button>
        <div id="overlay" style="position:fixed;inset:0;pointer-events:none"></div>`);
      await page.evaluate(() => {
        globalThis.reviewMenuStats = { commands: 0, closes: 0, underlying: 0 };
        globalThis.document.querySelector('#under').onclick = () =>
          globalThis.reviewMenuStats.underlying++;
        const shadow = globalThis.document.querySelector('#overlay').attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>
          #ui{position:relative;width:100%;height:100%}
          .absolute{position:absolute}.inset-0{inset:0}.inset-x-0{left:0;right:0}.bottom-0{bottom:0}
          .z-40{z-index:40}.z-50{z-index:50}.flex{display:flex}.flex-col{flex-direction:column}
          button{width:100%;height:48px}
        </style><div id="ui"></div>`;
        globalThis.getReviewMenuContainer = () => shadow.querySelector('#ui');
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(() => globalThis.openReviewMenu());
      const command = page.locator('[data-epdf-i="menu-command"]');
      await command.waitFor();
      assert.equal(
        await command.evaluate((element) => globalThis.getComputedStyle(element).pointerEvents),
        'auto',
      );
      await command.click();
      await page.waitForFunction(() => globalThis.reviewMenuStats.closes === 1);
      assert.deepEqual(await page.evaluate(() => globalThis.reviewMenuStats), {
        commands: 1,
        closes: 1,
        underlying: 0,
      });
      await page.evaluate(() => globalThis.openReviewMenu());
      await command.waitFor();
      await page.mouse.click(10, 10);
      await page.waitForFunction(() => globalThis.reviewMenuStats.closes === 2);
      assert.deepEqual(await page.evaluate(() => globalThis.reviewMenuStats), {
        commands: 1,
        closes: 2,
        underlying: 0,
      });
    } finally {
      await browser.close();
    }
  },
);
