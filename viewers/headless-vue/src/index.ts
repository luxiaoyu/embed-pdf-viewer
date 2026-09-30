export { createPluginRegistration } from '@embedpdf/core';
export { EmbedPDF } from '@embedpdf/core/vue';
export { usePdfiumEngine } from '@embedpdf/engines/vue';
export {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/vue';
export {
  GlobalPointerProvider,
  PagePointerProvider,
  InteractionManagerPluginPackage,
} from '@embedpdf/plugin-interaction-manager/vue';
export { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/vue';
export { Rotate, RotatePluginPackage } from '@embedpdf/plugin-rotate/vue';
export { Scroller, ScrollPluginPackage, useScroll } from '@embedpdf/plugin-scroll/vue';
export {
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
} from '@embedpdf/plugin-selection/vue';
export { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/vue';
export {
  MarqueeZoom,
  ZoomGestureWrapper,
  ZoomMode,
  ZoomPluginPackage,
  useZoom,
} from '@embedpdf/plugin-zoom/vue';
