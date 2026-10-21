// Carrega o pdfjs na build "legacy" (exigida em Node). Node 22 ainda não tem Promise.try, usado pelo pdfjs v6.
type PdfjsModule = typeof import("pdfjs-dist");

export async function loadPdfjs(): Promise<PdfjsModule> {
  const ctor = Promise as unknown as { try?: (fn: () => unknown) => Promise<unknown> };
  if (typeof ctor.try !== "function") ctor.try = (fn) => new Promise((resolve) => resolve(fn()));
  return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
}
