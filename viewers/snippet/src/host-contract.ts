/* eslint-disable no-unused-vars -- This file contains only public TypeScript declarations; parameter names describe API contracts. */
/** Standalone types for applications consuming the compiled Snippet without npm plugins. */
export interface SnippetTask<T> {
  toPromise(): Promise<T>;
  wait(
    resolve: (value: T) => void,
    reject?: (error: { type: string; reason: { code?: number; message?: string } }) => void,
  ): void;
  abort(reason: { code: number; message: string }): void;
}
export type SnippetUnsubscribe = () => void;
export interface SnippetRect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}
export interface SnippetPage {
  index: number;
  size: { width: number; height: number };
  rotation: number;
}
export interface SnippetDocument {
  id: string;
  pages: SnippetPage[];
  pageCount: number;
  permissions: number;
  formType?: number;
  isEncrypted: boolean;
}
export interface SnippetDocumentState {
  id: string;
  status: 'loading' | 'loaded' | 'error';
  document: SnippetDocument | null;
  scale: number;
  rotation: number;
  error: string | null;
  errorCode?: number;
}
export interface SnippetGlyph {
  x: number;
  y: number;
  width: number;
  height: number;
  flags: number;
}
export interface SnippetGeometry {
  runs: {
    charStart: number;
    rect: { x: number; y: number; width: number; height: number };
    glyphs: SnippetGlyph[];
  }[];
}
export interface SnippetRange {
  start: { page: number; index: number };
  end: { page: number; index: number };
}
export interface SnippetSelectionScope {
  getState(): { selecting: boolean; selection: SnippetRange | null };
  getSelectedText(): SnippetTask<string[]>;
  getBoundingRects(): { page: number; rect: SnippetRect }[];
  clear(): void;
  setSelection(range: SnippetRange | null): SnippetTask<void>;
  onSelectionChange(listener: (range: SnippetRange | null) => void): SnippetUnsubscribe;
  onEndSelection(listener: () => void): SnippetUnsubscribe;
}
export interface SnippetDocumentManager {
  getActiveDocumentId(): string | null;
  getActiveDocument(): SnippetDocument | null;
  getDocumentState(id: string): SnippetDocumentState | null;
  getOpenDocuments(): SnippetDocumentState[];
  closeDocument(id: string): SnippetTask<void>;
  onDocumentOpened(listener: (state: SnippetDocumentState) => void): SnippetUnsubscribe;
  onDocumentClosed(listener: (id: string) => void): SnippetUnsubscribe;
  onDocumentError(
    listener: (event: { documentId: string; message: string; code?: number }) => void,
  ): SnippetUnsubscribe;
}
export interface SnippetScrollScope {
  getCurrentPage(): number;
  getMetrics(): {
    currentPage: number;
    renderedPageIndexes: number[];
    scrollOffset: { x: number; y: number };
  };
  scrollToPage(options: {
    pageNumber: number;
    pageCoordinates?: { x: number; y: number };
    behavior?: 'instant' | 'smooth' | 'auto';
    alignX?: number;
    alignY?: number;
  }): void;
  onPageChange(
    listener: (event: { pageNumber: number; totalPages: number }) => void,
  ): SnippetUnsubscribe;
  onScroll(listener: () => void): SnippetUnsubscribe;
  onLayoutChange(listener: () => void): SnippetUnsubscribe;
}
export interface SnippetRegistry {
  getPlugin<T>(id: string): { provides(): T } | undefined;
  getEngine(): {
    extractText(document: SnippetDocument, pages: number[]): SnippetTask<string>;
    getPageGeometry(document: SnippetDocument, page: SnippetPage): SnippetTask<SnippetGeometry>;
    getTextSlices(
      document: SnippetDocument,
      slices: { pageIndex: number; charIndex: number; charCount: number }[],
    ): SnippetTask<string[]>;
  };
  getStore(): {
    getState(): { core: { documents: Record<string, SnippetDocumentState> } };
    subscribe(listener: () => void): SnippetUnsubscribe;
  };
  isDestroyed(): boolean;
}
export interface SnippetContainer extends HTMLElement {
  registry: Promise<SnippetRegistry>;
  destroy(): void;
  setToolbarTarget(target: HTMLElement | null): void;
  setSuspended(value: boolean): void;
  setContentInverted(value: boolean): void;
  setTheme(value: 'light' | 'dark' | 'system'): void;
  getViewportElement(): HTMLElement | null;
  getPageElement(index: number): HTMLElement | null;
  retryPage(documentId: string, pageIndex: number): void;
  getDocumentFeatures(
    id: string,
  ): Promise<{ formType: number; hasJavaScript: boolean; hasSignatures: boolean }>;
}

export interface SnippetInitOptions {
  textSelectionStyle?: { background?: string };
  toolbarPlacement?: 'viewer' | 'host';
  disabledCategories?: string[];
  type: 'container';
  target: Element;
  src?: string;
  wasmUrl: string;
  worker: boolean;
  readOnly: boolean;
  fonts: { ui: null; signature: null };
  fontFallback: { fonts: Record<string, string>; defaultFont: string };
  theme: { preference: 'light' | 'dark' | 'system' };
  i18n: { defaultLocale: string };
  documentManager: {
    maxDocuments: number;
    initialDocuments: { url: string; documentId: string; name?: string }[];
  };
  zoom: { defaultZoomLevel: 'fit-width' | 'fit-page'; minZoom: number; maxZoom: number };
  onNavigate: (uri: string) => void;
}

export interface SnippetModule {
  default: { version: string; init(options: SnippetInitOptions): SnippetContainer | undefined };
}
