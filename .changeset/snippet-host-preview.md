---
'@embedpdf/core': patch
'@embedpdf/models': patch
'@embedpdf/engines': patch
'@embedpdf/plugin-document-manager': patch
'@embedpdf/plugin-viewport': patch
'@embedpdf/plugin-render': patch
'@embedpdf/plugin-tiling': patch
'@embedpdf/plugin-search': patch
'@embedpdf/plugin-selection': patch
'@embedpdf/plugin-commands': patch
'@embedpdf/plugin-ui': patch
'@embedpdf/snippet': patch
---

Add a read-only Snippet host contract with cancellable document loading, safe URI routing, initialization and page events, hidden viewport suspension, form-type metadata, and page-content inversion.

Reject registry mutations and exports, respect PDF text-copy permissions, surface
worker and image failures, bound initial page rasters and bundle dependency
notices. Scope shortcuts to the viewer and label sidebar navigation tabs.

Named PDF actions still require a matching PDFium payload with a named-action
accessor; the host receives the unsupported-navigation event in the meantime.

Allow read-only hosts to relocate the native reading toolbar without reloading
the document, with themed menus, scoped shortcuts and target cleanup.
