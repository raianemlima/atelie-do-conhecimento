// Node 22 ainda não tem Promise.try, que o pdfjs-dist v6 usa. Polyfill apenas no ambiente de teste.
const promiseCtor = Promise as unknown as { try?: (fn: () => unknown) => Promise<unknown> };
if (typeof promiseCtor.try !== "function") {
  promiseCtor.try = (fn) => new Promise((resolve) => resolve(fn()));
}
