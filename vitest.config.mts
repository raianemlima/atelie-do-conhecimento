import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // pdfjs-dist exige a build "legacy" em Node; o código de produção continua importando "pdfjs-dist".
      { find: /^pdfjs-dist$/, replacement: `${root}node_modules/pdfjs-dist/legacy/build/pdf.mjs` },
      { find: /^@\//, replacement: `${root}` },
    ],
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000, setupFiles: ["tests/setup.ts"] },
});
