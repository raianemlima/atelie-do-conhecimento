import "server-only";

type Source = Record<string, string | undefined>;

export class ServerEnvError extends Error {
  readonly missing: string[];
  constructor(message: string, missing: string[] = []) {
    super(message);
    this.name = "ServerEnvError";
    this.missing = missing;
  }
}

const SECRET_NAME = /(SECRET|SERVICE_ROLE|API_KEY|PRIVATE|PASSWORD|TOKEN)/i;
const PUBLIC_KEY_ALLOWLIST = new Set(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

// Segredos nunca podem ter prefixo NEXT_PUBLIC_ (o Next os embutiria no navegador). Só nomes são reportados, nunca valores.
export function findLeakedSecretNames(source: Source): string[] {
  return Object.keys(source).filter((name) => name.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(name) && !PUBLIC_KEY_ALLOWLIST.has(name));
}

export type ServerEnv = {
  supabaseUrl: string;
  supabaseKey: string;
  serviceRoleKey: string | null;
  anthropicApiKey: string | null;
};

export function readServerEnv(source: Source = process.env): ServerEnv {
  const leaked = findLeakedSecretNames(source);
  if (leaked.length) throw new ServerEnvError(`Variáveis secretas não podem usar o prefixo NEXT_PUBLIC_: ${leaked.join(", ")}.`, leaked);
  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [!supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL", !supabaseKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter((name): name is string => Boolean(name));
  if (missing.length) throw new ServerEnvError(`Configuração ausente no servidor: ${missing.join(", ")}.`, missing);
  return { supabaseUrl: supabaseUrl as string, supabaseKey: supabaseKey as string, serviceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY ?? null, anthropicApiKey: source.ANTHROPIC_API_KEY ?? null };
}
