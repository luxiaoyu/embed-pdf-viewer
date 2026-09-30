# Local Vue Headless Bundle

This private package bundles the EmbedPDF v2 Vue headless components and plugins
needed by the Kimi Desktop PDF comparison. It does not include the snippet viewer
or its toolbar. Vue remains a peer dependency so the consumer uses one Vue
runtime and can compose its own controls.

Run `pnpm exec turbo run build --filter=@embedpdf/headless-vue-local` from the
repository root to build this package and its dependencies in order. The ESM
entry and sibling chunks are written to `dist/`; the PDFium WASM lives at
`packages/pdfium/dist/pdfium.wasm`.
