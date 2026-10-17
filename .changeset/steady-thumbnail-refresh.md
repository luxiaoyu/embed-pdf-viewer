---
'@embedpdf/plugin-thumbnail': patch
'@embedpdf/plugin-tiling': patch
---

Keep refreshed thumbnails and tiles from reusing stale renders: refreshes abort and
evict in-flight thumbnail tasks before notifying, late thumbnail results no longer
paint after their effect is replaced, and tile refresh tokens stay unique within one
millisecond.
