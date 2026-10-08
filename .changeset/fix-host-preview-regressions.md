---
'@embedpdf/snippet': patch
'@embedpdf/engines': patch
'@embedpdf/plugin-commands': patch
'@embedpdf/plugin-zoom': patch
---

Preserve plugin-specific disabled categories while enforcing read-only restrictions,
restore mobile hosted-menu clicks, close cached PDFium documents before direct-engine
shutdown, apply shortcut filtering in Vue and Svelte, and clamp relative zoom steps
to the configured minimum.
