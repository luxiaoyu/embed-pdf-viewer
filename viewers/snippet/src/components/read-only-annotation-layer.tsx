import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useRegistry, useDocumentState } from '@embedpdf/core/preact';
import { AnnotationPlugin } from '@embedpdf/plugin-annotation/preact';
import {
  PdfAnnotationSubtype,
  PdfAnnotationObject,
  PdfLinkAnnoObject,
  PdfActionType,
  ignore,
} from '@embedpdf/models';
import { useSnippetConfig } from './snippet-config-context';
import { isSafePreviewUri } from './navigation-policy';

/** PDFium paints appearances; this layer only exposes links and existing note text. */
export function ReadOnlyAnnotationLayer({
  documentId,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
}) {
  const { registry } = useRegistry();
  const config = useSnippetConfig();
  const state = useDocumentState(documentId);
  const [annotations, setAnnotations] = useState<PdfAnnotationObject[]>([]);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  useEffect(() => {
    const document = state?.document;
    const page = document?.pages[pageIndex];
    if (!registry || !document || !page) return;
    let disposed = false;
    registry
      .getEngine()
      .getPageAnnotations(document, page)
      .wait((items) => {
        if (!disposed)
          setAnnotations(
            items.filter(
              (annotation) =>
                !annotation.flags?.includes('hidden') && !annotation.flags?.includes('noView'),
            ),
          );
      }, ignore);
    return () => {
      disposed = true;
    };
  }, [registry, state?.document, pageIndex]);

  const scale = state?.scale ?? 1;
  return (
    <>
      {annotations.map((annotation) => {
        const link =
          annotation.type === PdfAnnotationSubtype.LINK ? (annotation as PdfLinkAnnoObject) : null;
        const note =
          !link && annotation.type !== PdfAnnotationSubtype.WIDGET ? annotation.contents : null;
        if (!link?.target && !note) return null;
        return (
          <Fragment key={annotation.id}>
            <button
              type="button"
              aria-label={annotation.contents || 'PDF link'}
              data-embedpdf-readonly-annotation
              disabled={
                link?.target?.type === 'action' &&
                link.target.action.type === PdfActionType.URI &&
                !isSafePreviewUri(link.target.action.uri)
              }
              style={{
                position: 'absolute',
                left: annotation.rect.origin.x * scale,
                top: annotation.rect.origin.y * scale,
                width: annotation.rect.size.width * scale,
                height: annotation.rect.size.height * scale,
                cursor: 'pointer',
                background: 'transparent',
                border: 0,
                padding: 0,
              }}
              onClick={() => {
                if (link?.target) {
                  if (
                    link.target.type === 'action' &&
                    link.target.action.type === PdfActionType.RemoteGoto
                  ) {
                    config.onUnsupportedNavigate?.();
                    return;
                  }
                  registry
                    ?.getPlugin<AnnotationPlugin>('annotation')
                    ?.provides()
                    .forDocument(documentId)
                    .navigateTarget(link.target)
                    .wait(() => {}, ignore);
                } else setActiveNote(activeNote === annotation.id ? null : annotation.id);
              }}
            />
            {note && activeNote === annotation.id && (
              <div
                role="note"
                data-embedpdf-readonly-note
                style={{
                  position: 'absolute',
                  left: Math.max(
                    0,
                    Math.min(
                      annotation.rect.origin.x * scale,
                      (state?.document?.pages[pageIndex]?.size.width ?? 0) * scale - 240,
                    ),
                  ),
                  top: (annotation.rect.origin.y + annotation.rect.size.height) * scale,
                  maxWidth: 240,
                  padding: 12,
                  zIndex: 5,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  background: 'var(--ep-bg-surface)',
                  color: 'var(--ep-fg-primary)',
                  border: '1px solid var(--ep-border-default)',
                  borderRadius: 6,
                }}
              >
                {note}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
