import { createClient } from "@supabase/supabase-js";
import { getItem, syncBankConnectionTransactions } from "@/lib/pluggy";

// Webhooks não têm sessão de usuário — usa a service role apenas aqui,
// nunca exposta ao frontend, apenas neste Route Handler server-side.
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * A Pluggy exige resposta 2XX em até 5s. Processamos o evento de forma
 * síncrona e simples aqui porque o volume esperado é baixo (uma escola,
 * poucas contas bancárias) — não há necessidade de fila assíncrona ainda.
 */
export async function POST(request: Request) {
  const payload = await request.json();
  const { event, itemId } = payload;

  if (!itemId) {
    return Response.json({ ok: true });
  }

  const supabase = createServiceClient();

  const { data: connection } = await supabase
    .from("bank_connections")
    .select("id")
    .eq("pluggy_item_id", itemId)
    .maybeSingle();

  if (!connection) {
    return Response.json({ ok: true });
  }

  if (event === "item/error") {
    await supabase.from("bank_connections").update({ status: "error" }).eq("id", connection.id);
    return Response.json({ ok: true });
  }

  if (event === "item/updated" || event === "transactions/created") {
    try {
      const item = await getItem(itemId);
      await syncBankConnectionTransactions(supabase, connection.id, itemId);
      await supabase
        .from("bank_connections")
        .update({ institution_name: item.connector?.name ?? "Banco" })
        .eq("id", connection.id);
    } catch {
      // syncBankConnectionTransactions já grava status="error" + last_error
      // no banco; aqui só evitamos que a exceção quebre a resposta ao webhook
      // (a Pluggy exige 2XX em até 5s, mesmo se a sincronização falhou).
    }
  }

  return Response.json({ ok: true });
}
