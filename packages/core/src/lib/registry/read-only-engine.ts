import { PdfEngine, PdfErrorCode, Task } from '@embedpdf/models';

/** A registry boundary: plugins and host callers receive the same read-only engine. */
export function createReadOnlyEngine(engine: PdfEngine): PdfEngine {
  const lifecycle = new Set([
    'openDocumentUrl',
    'openDocumentBuffer',
    'closeDocument',
    'closeAllDocuments',
    'destroy',
    'extractText',
    'readAttachmentContent',
  ]);
  return new Proxy(engine, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const name = String(key);
      if (/^(get|is|render|search)/.test(name) || lifecycle.has(name)) {
        return value.bind(target);
      }
      return () => {
        const task = new Task<never, { code: PdfErrorCode; message: string }>();
        task.reject({ code: PdfErrorCode.Security, message: `Read-only viewer rejects ${name}` });
        return task;
      };
    },
  });
}
