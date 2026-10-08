# Read-only application previews

Build with `pnpm build:snippet`. Distribute the Snippet entry together with all
referenced chunks, PDFium WASM, locally configured fallback fonts and licenses.
`dist/host-contract.d.ts` is a standalone host declaration that does not require
installing the plugin packages in the embedding application.

Initialize one container per document with `readOnly: true`, an absolute local
`wasmUrl`, local font URLs, and `onNavigate(uri)` for application-owned navigation.
Read-only mode omits interactive form renderers, paints static form appearances,
disables mutation commands, makes permission checks deny mutations regardless of
overrides, and rejects engine writes/exports through the registry. Text-copy
permissions continue to come from the PDF. Existing annotation notes remain
readable without exposing editing controls.

Keep the element returned by `init()`. Its `registry` promise settles on core
initialization; subscribe to document events and immediately read the current
document state because an initial document may finish before subscription.
Events `embedpdf-error`, `embedpdf-page-rendered`, and `embedpdf-page-error` allow
the host to distinguish initialization, first raster, and page failures.
`embedpdf-navigation-unsupported` reports recognized but unsupported link actions.

Use `setSuspended(true)` before hiding a loaded container and resume after layout
is visible. This freezes viewport metrics while retaining its painted pages.
Destroy an incomplete load instead of retaining it; URL tasks abort their fetch
and discard late results. `destroy()` removes the container and releases the
engine, worker URLs and plugin subscriptions. Construct a new container when
changing the source document rather than reusing an old resolved registry.

`setContentInverted()` targets PDF page images and thumbnails, preserving UI and
note colors. `getViewportElement()` and `getPageElement(index)` are stable geometry
anchors for application overlays. `retryPage()` refreshes a failed raster.
`getDocumentFeatures()` reports PDFium form type, script presence and signature
presence; it does not execute scripts or verify signatures.

The current v2 PDFium payload does not expose the names of PDF Named actions.
Reading hosts must handle the unsupported-navigation event for those actions
until a matching PDFium payload supplies a named-action accessor. Ordinary GoTo
destinations and URI links remain available.

For a read-only viewer inside application chrome, set `toolbarPlacement: 'host'`
and call `setToolbarTarget(element)` with an empty host element. The native
reading toolbar mounts in that element's open shadow root; menus render in a
separate styled overlay at document scope. Move it by setting a new target, or
pass `null` to hide it and close menus. Moving the target preserves the document,
worker, zoom and reading state. Host toolbar shortcuts share the viewer's scope
and suspension. Theme changes apply to both the toolbar and its menus.

Hosts may configure `zoom.maxZoom: Number.POSITIVE_INFINITY` to remove the product
zoom ceiling. Non-finite or non-positive requests are ignored.

Run source regressions with:

```sh
node --test tests/gesture-regressions.test.mjs tests/snippet-host-regressions.test.mjs
```

The mobile hosted-menu browser regression is
`node --test tests/snippet-host-menu.test.mjs`; it requires Playwright with
Chromium installed. Set `EMBEDPDF_BROWSER_TEST_MODULES` to a directory from which
Playwright can be resolved when it is installed outside this workspace.
