import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/server/http";

// Retorna o cliente atrelado à sessão do usuário (RLS ativa) e o usuário autenticado, ou lança 401.
export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "unauthenticated", "Sua sessão expirou. Entre novamente para continuar.");
  return { supabase, user: data.user };
}
