---
'@embedpdf/plugin-zoom': patch
---

Expose document-scoped `setAutoZoomOnResize` so hosts can preserve a fit mode's
current zoom through layout changes and explicitly fit during divider dragging.
Initial loading, rotation and spread changes retain their existing fit behavior.
