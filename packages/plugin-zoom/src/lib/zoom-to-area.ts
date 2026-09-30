import type { Rect } from '@embedpdf/models';
import type { ScrollScope } from '@embedpdf/plugin-scroll';
import type { ViewportMetrics } from '@embedpdf/plugin-viewport';

export function zoomRequestForArea(options: {
  scroll: Pick<ScrollScope, 'getLayout' | 'getRectPositionForPage'>;
  pageIndex: number;
  rect: Rect;
  oldZoom: number;
  viewport: Pick<ViewportMetrics, 'clientWidth' | 'clientHeight' | 'scrollLeft' | 'scrollTop'>;
  viewportGap: number;
}): { level: number; center: { vx: number; vy: number } } | null {
  const { scroll, pageIndex, rect, oldZoom, viewport, viewportGap } = options;
  const availableWidth = viewport.clientWidth - 2 * viewportGap;
  const availableHeight = viewport.clientHeight - 2 * viewportGap;
  if (availableWidth <= 0 || availableHeight <= 0 || oldZoom <= 0) return null;

  // ScrollScope applies intrinsic page rotation, document rotation, and the
  // centering offset for a page narrower than its spread.
  const unitRect = scroll.getRectPositionForPage(pageIndex, rect, 1);
  const currentRect = scroll.getRectPositionForPage(pageIndex, rect, oldZoom);
  if (
    !unitRect ||
    !currentRect ||
    unitRect.size.width < 0 ||
    unitRect.size.height < 0 ||
    (unitRect.size.width === 0 && unitRect.size.height === 0)
  ) {
    return null;
  }

  const { totalContentSize } = scroll.getLayout();
  const centeringOffset = (availableSpace: number, contentSize: number) =>
    contentSize * oldZoom < availableSpace ? (availableSpace - contentSize * oldZoom) / 2 : 0;

  return {
    level: Math.min(availableWidth / unitRect.size.width, availableHeight / unitRect.size.height),
    center: {
      vx:
        viewportGap +
        centeringOffset(availableWidth, totalContentSize.width) +
        currentRect.origin.x +
        currentRect.size.width / 2 -
        viewport.scrollLeft,
      vy:
        viewportGap +
        centeringOffset(availableHeight, totalContentSize.height) +
        currentRect.origin.y +
        currentRect.size.height / 2 -
        viewport.scrollTop,
    },
  };
}
