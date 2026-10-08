import { Fragment, useEffect, useRef, useState, useMemo } from '@framework';
import type { CSSProperties, HTMLAttributes } from '@framework';

import { PdfErrorCode } from '@embedpdf/models';

import { useRenderCapability } from '../hooks/use-render';
import { useDocumentState } from '@embedpdf/core/@framework';

type RenderLayerProps = Omit<HTMLAttributes<HTMLImageElement>, 'style'> & {
  /**
   * The ID of the document to render from
   */
  documentId: string;
  /**
   * The page index to render (0-based)
   */
  pageIndex: number;
  /**
   * Optional scale override. If not provided, uses document's current scale.
   */
  scale?: number;
  /**
   * Optional device pixel ratio override. If not provided, uses window.devicePixelRatio.
   */
  dpr?: number;
  /**
   * Additional styles for the image element
   */
  style?: CSSProperties;
  onRendered?: () => void;
  onRenderError?: (error: string, code?: number) => void;
};

/**
 * RenderLayer Component
 *
 * Renders a PDF page with smart prop handling:
 * - If scale/dpr/rotation props are provided, they override document state
 * - If not provided, component uses document's current state values
 * - Automatically re-renders when:
 *   1. Document state changes (scale, rotation)
 *   2. Page is refreshed (via REFRESH_PAGES action in core)
 */
export function RenderLayer({
  documentId,
  pageIndex,
  scale: scaleOverride,
  dpr: dprOverride,
  style,
  onRendered,
  onRenderError,
  ...props
}: RenderLayerProps) {
  const { provides: renderProvides } = useRenderCapability();
  const documentState = useDocumentState(documentId);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const callbacks = useRef({ onRendered, onRenderError });
  callbacks.current = { onRendered, onRenderError };

  // Get refresh version from core state
  const refreshVersion = useMemo(() => {
    if (!documentState) return 0;
    return documentState.pageRefreshVersions[pageIndex] || 0;
  }, [documentState, pageIndex]);

  // Determine actual render options: use overrides if provided, otherwise fall back to document state
  const actualScale = useMemo(() => {
    if (scaleOverride !== undefined) return scaleOverride;
    return documentState?.scale ?? 1;
  }, [scaleOverride, documentState?.scale]);

  const actualDpr = useMemo(() => {
    if (dprOverride !== undefined) return dprOverride;
    return window.devicePixelRatio;
  }, [dprOverride]);

  useEffect(() => {
    if (!renderProvides) return;
    let disposed = false;

    const task = renderProvides.forDocument(documentId).renderPage({
      pageIndex,
      options: {
        scaleFactor: actualScale,
        dpr: actualDpr,
      },
    });

    task.wait(
      (blob) => {
        if (disposed) return;
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
        urlRef.current = url;
      },
      (error) => {
        if (!disposed && error.type !== 'abort')
          callbacks.current.onRenderError?.(error.reason.message, error.reason.code);
      },
    );

    return () => {
      disposed = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      } else {
        task.abort({
          code: PdfErrorCode.Cancelled,
          message: 'canceled render task',
        });
      }
    };
  }, [documentId, pageIndex, actualScale, actualDpr, renderProvides, refreshVersion]);

  const handleImageLoad = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    callbacks.current.onRendered?.();
  };

  return (
    <Fragment>
      {imageUrl && (
        <img
          src={imageUrl}
          onLoad={handleImageLoad}
          onError={() =>
            callbacks.current.onRenderError?.(
              'PDF raster image failed to decode',
              PdfErrorCode.PageError,
            )
          }
          {...props}
          style={{
            width: '100%',
            height: '100%',
            ...(style || {}),
          }}
        />
      )}
    </Fragment>
  );
}
