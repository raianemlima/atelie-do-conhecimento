import { describe, expect, it } from "vitest";
import { findLeakedSecretNames, readServerEnv, ServerEnvError } from "@/lib/server/env";

const base = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };

describe("ambiente do servidor", () => {
  it("lê a configuração mínima e deixa segredos opcionais como null", () => {
    expect(readServerEnv(base)).toEqual({ supabaseUrl: base.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: base.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, serviceRoleKey: null, anthropicApiKey: null });
  });
  it("lê segredos somente de variáveis sem prefixo público", () => {
    const env = readServerEnv({ ...base, SUPABASE_SERVICE_ROLE_KEY: "svc", ANTHROPIC_API_KEY: "ak" });
    expect(env.serviceRoleKey).toBe("svc");
    expect(env.anthropicApiKey).toBe("ak");
  });
  it("falha de forma clara, listando só NOMES ausentes", () => {
    try { readServerEnv({}); expect.unreachable(); } catch (error) {
      expect(error).toBeInstanceOf(ServerEnvError);
      expect((error as ServerEnvError).missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    }
  });
  it("bloqueia segredo com prefixo NEXT_PUBLIC_ sem vazar o valor", () => {
    const source = { ...base, NEXT_PUBLIC_ANTHROPIC_API_KEY: "valor-secreto-123", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };
    expect(findLeakedSecretNames(source)).toEqual(["NEXT_PUBLIC_ANTHROPIC_API_KEY"]);
    expect(() => readServerEnv(source)).toThrow(/NEXT_PUBLIC_ANTHROPIC_API_KEY/);
    expect(() => readServerEnv(source)).not.toThrow(/valor-secreto-123/);
  });
  it("chaves publishable/anon públicas são permitidas", () => {
    expect(findLeakedSecretNames({ ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" })).toEqual([]);
  });
});
