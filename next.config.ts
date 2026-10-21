import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O pdfjs resolve o próprio worker em tempo de execução; empacotado pelo Next, o arquivo do worker não é encontrado.
  serverExternalPackages: ["pdfjs-dist"],
  // Em hospedagem serverless só vão os arquivos que o rastreamento enxerga; o worker do pdfjs é carregado dinamicamente.
  outputFileTracingIncludes: {
    "/api/jobs/**": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "./node_modules/pdfjs-dist/standard_fonts/**/*"],
  },
};

export default nextConfig;
