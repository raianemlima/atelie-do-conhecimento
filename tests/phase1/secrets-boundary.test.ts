import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}
const root = process.cwd();
const read = (file: string) => readFileSync(file, "utf8");

describe("fronteira servidor/cliente", () => {
  const clientFiles = [...walk(join(root, "components")), join(root, "lib/supabase/client.ts"), join(root, "lib/supabase/secure-documents.ts"), join(root, "lib/pipeline/client.ts"), join(root, "lib/pipeline/dto.ts"), join(root, "lib/supabase/data-store.ts"), ...walk(join(root, "app")).filter((f) => /\.tsx$/.test(f) && read(f).includes('"use client"'))];

  it("nenhum arquivo de cliente importa módulos de servidor", () => {
    const offenders = clientFiles.filter((file) => /from\s+["']@\/lib\/server\//.test(read(file)));
    expect(offenders).toEqual([]);
  });
  it("nenhum arquivo de cliente lê variáveis de ambiente não públicas", () => {
    const offenders = clientFiles.filter((file) => /process\.env\.(?!NEXT_PUBLIC_)/.test(read(file)));
    expect(offenders).toEqual([]);
  });
  it("todo módulo em lib/server importa 'server-only' (exceto regras puras)", () => {
    const pure = new Set(["upload-rules.ts"]);
    const missing = walk(join(root, "lib/server")).filter((file) => !pure.has(file.split("/").pop() ?? "") && !read(file).includes('import "server-only"'));
    expect(missing).toEqual([]);
  });
  it(".env.example não contém segredos reais nem variáveis secretas públicas", () => {
    const env = read(join(root, ".env.example"));
    expect(env).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SERVICE_ROLE|SECRET|API_KEY)/);
    expect(env).not.toMatch(/sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{30,}/);
  });
});
