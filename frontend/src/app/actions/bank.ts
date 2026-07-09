"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createConnectToken, syncBankConnectionTransactions } from "@/lib/pluggy";

export async function getPluggyConnectToken(): Promise<string> {
  // A Pluggy exige HTTPS para o webhook — em desenvolvimento local
  // (http://localhost) ela recusaria o Connect Token inteiro, então
  // omitimos o webhook nesse caso (localhost não seria alcançável de
  // qualquer forma). Em produção, NEXT_PUBLIC_APP_URL deve ser https.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const webhookUrl = appUrl?.startsWith("https://")
    ? `${appUrl}/api/webhooks/pluggy`
    : undefined;

  try {
    return await createConnectToken(webhookUrl);
  } catch (err) {
    // Next.js ofusca qualquer mensagem de exceção não tratada em Server
    // Actions em produção ("An error occurred..."), mesmo com throw
    // explícito — por isso logamos aqui para aparecer nos logs do servidor
    // (Render), já que o cliente nunca verá o texto completo em produção.
    console.error("[getPluggyConnectToken] Falha ao criar connect token:", err);
    throw new Error(
      `Não foi possível conectar à Pluggy: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Chamado pelo frontend após o widget Pluggy Connect retornar sucesso.
 * Registra a conexão e dispara a primeira sincronização de transações.
 */
export async function registerBankConnection(pluggyItemId: string, institutionName: string) {
  const supabase = await createClient();

  const { data: connection, error } = await supabase
    .from("bank_connections")
    .upsert(
      { pluggy_item_id: pluggyItemId, institution_name: institutionName, status: "updated" },
      { onConflict: "pluggy_item_id" }
    )
    .select("id")
    .single();

  if (error || !connection) {
    return { error: "Erro ao registrar a conexão bancária." };
  }

  try {
    await syncBankConnectionTransactions(supabase, connection.id, pluggyItemId);
  } catch (err) {
    revalidatePath("/banco/conciliacao");
    return {
      error: `Conta conectada, mas a sincronização inicial falhou: ${
        err instanceof Error ? err.message : String(err)
      }. Tente ressincronizar na lista de contas.`,
    };
  }

  revalidatePath("/banco/conciliacao");
  return { success: true };
}

/** Rechama a sincronização manualmente para uma conexão já existente. */
export async function resyncBankConnection(connectionId: string) {
  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("bank_connections")
    .select("pluggy_item_id")
    .eq("id", connectionId)
    .single();

  if (!connection) {
    return { error: "Conexão não encontrada." };
  }

  try {
    await syncBankConnectionTransactions(supabase, connectionId, connection.pluggy_item_id);
  } catch (err) {
    revalidatePath("/banco/conciliacao");
    return { error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/banco/conciliacao");
  return { success: true };
}
