import { h, render } from 'preact';
import { PDFViewer, PDFViewerConfig } from '@/components/app';
import { PluginRegistry, refreshPages } from '@embedpdf/core';
import type { HostedToolbarSnapshot, HostedToolbarSource } from '@/components/hosted-toolbar';
import { UIPlugin } from '@embedpdf/plugin-ui';
import { ViewportPlugin } from '@embedpdf/plugin-viewport';
import { AnnotationPlugin } from '@embedpdf/plugin-annotation';
import { DocumentManagerPlugin } from '@embedpdf/plugin-document-manager';
import {
  ThemeConfig,
  ThemePreference,
  Theme,
  lightTheme,
  darkTheme,
  resolveTheme,
  resolveColorScheme,
  onSystemColorSchemeChange,
  generateThemeStylesheet,
} from '@/config/theme';
import {
  IconConfig,
  IconsConfig,
  registerIcon as globalRegisterIcon,
  registerIcons as globalRegisterIcons,
} from '@/config/icon-registry';

const BaseElement = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class EmbedPdfContainer extends (BaseElement as typeof HTMLElement) {
  private root: ShadowRoot;
  private _config?: PDFViewerConfig;
  private _registryPromise: Promise<PluginRegistry>;
  private _resolveRegistry: ((registry: PluginRegistry) => void) | null = null;
  private _rejectRegistry: ((error: Error) => void) | null = null;
  private registryValue: PluginRegistry | null = null;
  private unsubscribeNavigation: (() => void) | null = null;
  private suspended = false;
  private toolbarTarget: HTMLElement | null = null;
  private toolbarOverlay: HTMLElement | null = null;
  private toolbarTheme = '';
  private toolbarListeners = new Set<() => void>();
  private readonly hostedToolbar: HostedToolbarSource = {
    getSnapshot: (): HostedToolbarSnapshot => ({
      target: this.toolbarTarget,
      overlay: this.toolbarOverlay?.shadowRoot ?? null,
      theme: this.toolbarTheme,
    }),
    subscribe: (listener) => {
      this.toolbarListeners.add(listener);
      return () => this.toolbarListeners.delete(listener);
    },
  };

  setToolbarTarget(target: HTMLElement | null): void {
    if (this.toolbarTarget === target) return;
    const documentId = this.registryValue
      ?.getPlugin<DocumentManagerPlugin>('document-manager')
      ?.provides()
      .getActiveDocumentId();
    if (documentId)
      this.registryValue
        ?.getPlugin<UIPlugin>('ui')
        ?.provides()
        .forDocument(documentId)
        .closeAllMenus();
    this.toolbarTarget = target;
    if (target && !this.toolbarOverlay) {
      this.toolbarOverlay = document.createElement('div');
      this.toolbarOverlay.setAttribute('data-embedpdf-host-menus', '');
      Object.assign(this.toolbarOverlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '10000',
        pointerEvents: 'none',
      });
      this.toolbarOverlay.attachShadow({ mode: 'open' });
      document.body.appendChild(this.toolbarOverlay);
    }
    this.toolbarListeners.forEach((listener) => listener());
  }

  private themeStyleEl: HTMLStyleElement | null = null;
  private systemPreferenceCleanup: (() => void) | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });

    // Create promise for registry that will be resolved when ready
    this._registryPromise = new Promise((resolve, reject) => {
      this._resolveRegistry = resolve;
      this._rejectRegistry = reject;
    });
    this._registryPromise.catch(() => {});
  }

  connectedCallback() {
    // If config isn't provided via script, build it from attributes
    if (!this._config) {
      this._config = {
        src: this.getAttribute('src') || '/demo.pdf',
        worker: this.getAttribute('worker') !== 'false',
        // Support theme attribute: <embedpdf-container theme="dark">
        theme: this.parseThemeAttribute(),
      };
    }
    this.setupTheme();
    this.renderViewer();
  }

  disconnectedCallback() {
    this.unsubscribeNavigation?.();
    this.unsubscribeNavigation = null;
    this._rejectRegistry?.(new Error('Viewer removed before initialization'));
    this._rejectRegistry = null;
    this._resolveRegistry = null;
    this.registryValue = null;
    // Clean up system preference listener
    this.systemPreferenceCleanup?.();
    this.systemPreferenceCleanup = null;

    // Unmount Preact components - triggers cleanup chain (engine destroy, plugin cleanup, etc.)
    render(null, this.root);
    this.toolbarOverlay?.remove();
    this.toolbarOverlay = null;
    this.toolbarTarget = null;
    this.toolbarListeners.clear();
  }

  destroy(): void {
    if (this.isConnected) this.remove();
    else this.disconnectedCallback();
  }

  /** Freeze hidden viewport geometry without releasing already-painted pages. */
  setSuspended(value: boolean): void {
    this.suspended = value;
    const registry = this.registryValue;
    if (!registry) return;
    const viewport = registry.getPlugin<ViewportPlugin>('viewport');
    for (const id of Object.keys(registry.getStore().getState().core.documents))
      viewport?.setSuspended(id, value);
  }

  setContentInverted(value: boolean): void {
    this.toggleAttribute('content-inverted', value);
    let style = this.root.querySelector<HTMLStyleElement>('style[data-content-invert]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-content-invert', '');
      style.textContent =
        ':host([content-inverted]) [data-embedpdf-page-index] img, :host([content-inverted]) [data-embedpdf-thumbnail] img { filter: invert(1) hue-rotate(180deg); }';
      this.root.appendChild(style);
    }
  }

  getViewportElement(): HTMLElement | null {
    return this.root.querySelector('[data-embedpdf-viewport]');
  }

  getPageElement(pageIndex: number): HTMLElement | null {
    return this.root.querySelector(`[data-embedpdf-page-index="${pageIndex}"]`);
  }

  retryPage(documentId: string, pageIndex: number): void {
    this.registryValue?.getStore().dispatch(refreshPages(documentId, [pageIndex]));
  }

  async getDocumentFeatures(
    documentId: string,
  ): Promise<{ formType: number; hasJavaScript: boolean; hasSignatures: boolean }> {
    const registry = await this.registry;
    const doc = registry
      .getPlugin<DocumentManagerPlugin>('document-manager')
      ?.provides()
      .getDocument(documentId);
    if (!doc) throw new Error('Document is not loaded');
    const engine = registry.getEngine();
    const [scripts, signatures] = await Promise.all([
      engine.getDocumentJavaScriptActions(doc).toPromise(),
      engine.getSignatures(doc).toPromise(),
    ]);
    let hasJavaScript = scripts.length > 0;
    for (const page of doc.formType === 0 ? [] : doc.pages) {
      if (hasJavaScript) break;
      if (registry.isDestroyed()) throw new Error('Viewer was destroyed');
      hasJavaScript =
        (await engine.getPageWidgetJavaScriptActions(doc, page).toPromise()).length > 0;
    }
    return { formType: doc.formType ?? 0, hasJavaScript, hasSignatures: signatures.length > 0 };
  }

  /**
   * Parse theme from HTML attribute
   */
  private parseThemeAttribute(): ThemeConfig | undefined {
    const themeAttr = this.getAttribute('theme');
    if (!themeAttr) return undefined;

    // Simple preference: "light", "dark", "system"
    if (['light', 'dark', 'system'].includes(themeAttr)) {
      return { preference: themeAttr as ThemePreference };
    }

    return undefined;
  }

  // Setter for config
  set config(newConfig: PDFViewerConfig) {
    this._config = newConfig;

    // Register any icons provided in config
    if (newConfig.icons) {
      globalRegisterIcons(newConfig.icons);
    }

    if (this.isConnected) {
      this.setupTheme();
      this.renderViewer();
    }
  }

  // Getter for config
  get config(): PDFViewerConfig | undefined {
    return this._config;
  }

  // Getter for registry promise
  get registry(): Promise<PluginRegistry> {
    return this._registryPromise;
  }

  /**
   * Gets the current theme preference
   */
  get themePreference(): ThemePreference {
    return this._config?.theme?.preference || 'system';
  }

  /**
   * Gets the currently active (resolved) color scheme
   */
  get activeColorScheme(): 'light' | 'dark' {
    return resolveColorScheme(this.themePreference);
  }

  /**
   * Gets the currently active theme object
   */
  get activeTheme(): Theme {
    return this.resolveActiveTheme();
  }

  /**
   * Resolves the active theme based on config and system preference
   */
  private resolveActiveTheme(): Theme {
    const themeConfig = this._config?.theme;
    const colorScheme = resolveColorScheme(themeConfig?.preference || 'system');

    // Get base theme
    const baseTheme = colorScheme === 'dark' ? darkTheme : lightTheme;

    // Apply custom overrides if provided (now directly on themeConfig.light/dark)
    const colorOverrides = themeConfig?.[colorScheme];
    return resolveTheme(colorOverrides, baseTheme);
  }

  /**
   * Sets up theme injection and system preference listener
   */
  private setupTheme() {
    // Clean up any existing system preference listener
    this.systemPreferenceCleanup?.();
    this.systemPreferenceCleanup = null;

    const preference = this._config?.theme?.preference || 'system';

    // If preference is 'system', set up listener for OS preference changes
    if (preference === 'system') {
      this.systemPreferenceCleanup = onSystemColorSchemeChange((scheme) => {
        this.injectTheme();
        // Dispatch event for external listeners
        this.dispatchEvent(
          new CustomEvent('themechange', {
            detail: {
              preference: 'system',
              colorScheme: scheme,
              theme: this.activeTheme,
            },
            bubbles: true,
          }),
        );
      });
    }

    this.injectTheme();
  }

  /**
   * Injects the theme CSS into the shadow root
   */
  private injectTheme() {
    const theme = this.resolveActiveTheme();
    const css = generateThemeStylesheet(theme);
    this.toolbarTheme = css;
    this.toolbarListeners.forEach((listener) => listener());

    // Find existing theme style or create new one
    let existingStyle = this.root.querySelector(
      'style[data-embedpdf-theme]',
    ) as HTMLStyleElement | null;

    if (!existingStyle) {
      existingStyle = document.createElement('style');
      existingStyle.setAttribute('data-embedpdf-theme', '');
      this.root.appendChild(existingStyle); // Append at end, after Preact content
    }

    this.themeStyleEl = existingStyle;
    this.themeStyleEl.textContent = css;

    // Set data attribute for external CSS targeting
    this.setAttribute('data-color-scheme', this.activeColorScheme);
  }

  /**
   * Updates the theme at runtime
   * @param theme - New theme configuration or simple preference
   */
  setTheme(theme: ThemeConfig | ThemePreference) {
    if (this._config) {
      // Handle simple preference string
      if (typeof theme === 'string') {
        this._config.theme = { ...this._config.theme, preference: theme };
      } else {
        // Merge new config with existing, preserving unspecified values
        this._config.theme = {
          ...this._config.theme,
          ...theme,
        };
      }
      this.setupTheme();

      // Dispatch event
      this.dispatchEvent(
        new CustomEvent('themechange', {
          detail: {
            preference: this.themePreference,
            colorScheme: this.activeColorScheme,
            theme: this.activeTheme,
          },
          bubbles: true,
        }),
      );
    }
  }

  /**
   * Registers a custom icon
   * @param name - Unique icon name
   * @param config - Icon configuration
   */
  registerIcon(name: string, config: IconConfig) {
    globalRegisterIcon(name, config);
  }

  /**
   * Registers multiple custom icons
   * @param icons - Map of icon name to configuration
   */
  registerIcons(icons: IconsConfig) {
    globalRegisterIcons(icons);
  }

  // Callback to receive registry from PDFViewer
  private handleRegistryReady = (registry: PluginRegistry) => {
    if (!this.isConnected) {
      registry.destroy().catch(() => {});
      return;
    }
    this.registryValue = registry;
    this.unsubscribeNavigation?.();
    this.unsubscribeNavigation =
      registry
        .getPlugin<AnnotationPlugin>('annotation')
        ?.provides()
        .onNavigate((event) => {
          if (event.result.outcome === 'uri') this._config?.onNavigate?.(event.result.uri);
          else if (event.result.outcome === 'unsupported') this.handleUnsupportedNavigate();
        }) ?? null;
    this.setSuspended(this.suspended);
    if (this._resolveRegistry) {
      this._resolveRegistry(registry);
      this._resolveRegistry = null; // Clear after resolving
      this._rejectRegistry = null;
    }
    this.dispatchEvent(new CustomEvent('embedpdf-ready', { detail: { registry } }));
  };

  private handleError = (error: Error) => {
    this._rejectRegistry?.(error);
    this._rejectRegistry = null;
    this._resolveRegistry = null;
    this.dispatchEvent(new CustomEvent('embedpdf-error', { detail: { error } }));
  };

  private handleUnsupportedNavigate = () => {
    this._config?.onUnsupportedNavigate?.();
    this.dispatchEvent(new CustomEvent('embedpdf-navigation-unsupported'));
  };

  private handlePageRender = (event: {
    documentId: string;
    pageIndex: number;
    error?: string;
    errorCode?: number;
  }) => {
    this._config?.onPageRender?.(event);
    this.dispatchEvent(
      new CustomEvent(event.error ? 'embedpdf-page-error' : 'embedpdf-page-rendered', {
        detail: event,
      }),
    );
  };

  renderViewer() {
    if (!this._config) return;
    render(
      <PDFViewer
        config={{
          ...this._config,
          hostedToolbar: this.hostedToolbar,
          onPageRender: this.handlePageRender,
          onUnsupportedNavigate: this.handleUnsupportedNavigate,
          commands: {
            ...this._config.commands,
            shortcutFilter: (event) =>
              !this.suspended &&
              (event.composedPath().includes(this) ||
                Boolean(this.toolbarTarget && event.composedPath().includes(this.toolbarTarget))),
          },
        }}
        onRegistryReady={this.handleRegistryReady}
        onError={this.handleError}
      />,
      this.root,
    );

    // ADDED: Re-inject theme AFTER Preact render (since render clears the container)
    this.injectTheme();
  }
}
