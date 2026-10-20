import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/supabase/config";

export function createClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase ainda não está configurado.");
  return createBrowserClient(url, key);
}
