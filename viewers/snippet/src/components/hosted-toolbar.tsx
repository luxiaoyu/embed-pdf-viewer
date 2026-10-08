import { h, Fragment } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import {
  AutoMenuRenderer,
  UIRoot,
  useUICapability,
  type ToolbarItem,
} from '@embedpdf/plugin-ui/preact';
import { SchemaToolbar } from '@/ui/schema-toolbar';
import styles from '../styles/index.css';

export interface HostedToolbarSnapshot {
  target: HTMLElement | null;
  overlay: ShadowRoot | null;
  theme: string;
}
export interface HostedToolbarSource {
  getSnapshot(): HostedToolbarSnapshot;
  // eslint-disable-next-line no-unused-vars -- Public callback declaration.
  subscribe(listener: () => void): () => void;
}
const readingItems = new Set([
  'sidebar-button',
  'page-settings-button',
  'zoom-toolbar',
  'pan-button',
  'pointer-button',
  'search-button',
]);
function flatten(items: ToolbarItem[]): ToolbarItem[] {
  return items.flatMap((item) =>
    item.type === 'group' ? flatten(item.items) : readingItems.has(item.id) ? [item] : [],
  );
}

/** Moving the toolbar rerenders only this portal, preserving document and engine state. */
export function HostedToolbar({
  source,
  documentId,
}: {
  source: HostedToolbarSource;
  documentId: string;
}) {
  const [snapshot, setSnapshot] = useState(() => source.getSnapshot());
  const { provides } = useUICapability();
  useEffect(() => {
    const update = () => setSnapshot(source.getSnapshot());
    update();
    return source.subscribe(update);
  }, [source]);
  const primary = provides?.getSchema().toolbars['main-toolbar'];
  if (!primary || !snapshot.target) return null;
  const root = snapshot.target.shadowRoot ?? snapshot.target.attachShadow({ mode: 'open' });
  const visibility = [...readingItems]
    .map(
      (id) =>
        `[data-epdf]:not([data-epdf-hid~="${id}"]) [data-epdf-i="host-reading-toolbar"] [data-epdf-i="${id}"] { display: flex !important; }`,
    )
    .join('\n');
  const css = `${styles}\n${snapshot.theme}\n:host { background: transparent; overflow: visible; }\n${visibility}`;
  return (
    <>
      {createPortal(
        <>
          <style>{`${css}\n:host { width: max-content; height: auto; display: block; }`}</style>
          <UIRoot style={{ containerType: 'normal', width: 'max-content' }}>
            <SchemaToolbar
              schema={{ ...primary, id: 'host-reading-toolbar', items: flatten(primary.items) }}
              documentId={documentId}
              isOpen
              className="border-0 p-0"
            />
          </UIRoot>
        </>,
        root,
      )}
      {snapshot.overlay &&
        createPortal(
          <>
            <style>{css}</style>
            <UIRoot style={{ containerType: 'normal', width: '100%', height: '100%' }}>
              <AutoMenuRenderer documentId={documentId} />
            </UIRoot>
          </>,
          snapshot.overlay,
        )}
    </>
  );
}
