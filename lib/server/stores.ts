import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseMapStore } from "@/lib/thematic/supabase-store";
import type { ThematicMapStore } from "@/lib/thematic/store";

export const createMapStore = (supabase: SupabaseClient): ThematicMapStore => new SupabaseMapStore(supabase);
