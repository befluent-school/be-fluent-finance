import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Client somente leitura para o banco do Beely (CRM próprio da Be Fluent,
 * projeto Supabase separado). Usa a anon key porque só lemos contacts/deals/
 * stages — nunca escrevemos de volta no banco do Beely a partir daqui.
 */
export function createBeelyClient() {
  return createClient(
    process.env.NEXT_PUBLIC_BEELY_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_BEELY_SUPABASE_ANON_KEY!
  );
}

export type BeelyContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  score: number | null;
};

export type BeelyDeal = {
  id: string;
  title: string;
  value: number | null;
  status: "open" | "won" | "lost";
  stage_id: string | null;
  /** Nome do contato em texto livre — não há FK confiável (contact_id costuma ser null). */
  contact: string | null;
  contact_id: string | null;
  owner: string | null;
  created_at: string;
};

export type BeelyStage = {
  id: string;
  name: string;
  position: number | null;
};
