import { Rect } from '@embedpdf/models';
import { useLayoutEffect, useRef } from '@framework';
import { useViewportPlugin } from './use-viewport';

export function useViewportRef(documentId: string) {
  const { plugin: viewportPlugin } = useViewportPlugin();
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!viewportPlugin) return;

    const container = containerRef.current;
    if (!container) return;

    // Register this viewport for the document
    try {
      viewportPlugin.registerViewport(documentId);
    } catch (error) {
      console.error(`Failed to register viewport for document ${documentId}:`, error);
      return;
    }

    // On scroll
    const onScroll = () => {
      viewportPlugin.setViewportScrollMetrics(documentId, {
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      });
    };
    container.addEventListener('scroll', onScroll);

    // On resize
    const updateSize = () => {
      viewportPlugin.setViewportResizeMetrics(documentId, {
        width: container.offsetWidth,
        height: container.offsetHeight,
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
        scrollWidth: container.scrollWidth,
        scrollHeight: container.scrollHeight,
        clientLeft: container.clientLeft,
        clientTop: container.clientTop,
      });
    };
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    const unsubscribeResume = viewportPlugin.onResume(documentId, updateSize);

    // Subscribe to scroll requests for this document
    const unsubscribeScrollRequest = viewportPlugin.onScrollRequest(
      documentId,
      ({ x, y, behavior = 'auto' }) => {
        requestAnimationFrame(() => {
          container.scrollTo({ left: x, top: y, behavior });
        });
      },
    );

    // Cleanup
    return () => {
      viewportPlugin.unregisterViewport(documentId);
      resizeObserver.disconnect();
      container.removeEventListener('scroll', onScroll);
      unsubscribeScrollRequest();
      unsubscribeResume();
    };
  }, [viewportPlugin, documentId]);

  return containerRef;
}
