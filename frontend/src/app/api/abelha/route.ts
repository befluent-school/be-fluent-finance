import { NextResponse } from "next/server";
import * as z from "zod";
import { sql } from "drizzle-orm";
import { getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser } from "@/lib/db";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { runAbelha, type UserBlock } from "@/lib/abelha/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILES = 5;
const MAX_FILE_BYTES = 9 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_EXT = /\.(csv|ofx|txt|tsv|json)$/i;

const History = z
  .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(20000) }))
  .max(40);

/** Pendências para a saudação da Abelha (sem IA: rápido e grátis). */
export async function GET() {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { rows } = await withUser(user.id, (tx) =>
    tx.execute(sql`
      select
        (select count(*) from public.cash_transactions where category_id is null and source <> 'opening') as sem_categoria,
        (select coalesce(json_agg(json_build_object('conta', d.label, 'diferenca', d.dif)), '[]'::json) from (
           select p.label, round(coalesce((select sum(case when v.type = 'entrada' then v.amount else -v.amount end)
                                    from public.cash_transactions_with_balance v
                                   where v.bank_provider_id = p.id and v.in_balance), 0) - p.bank_balance, 2) as dif
             from public.bank_providers p where p.active and p.bank_balance is not null) d
          where abs(d.dif) > 1) as divergencias`)
  );
  const r = rows[0] as { sem_categoria: string; divergencias: { conta: string; diferenca: number }[] };
  return NextResponse.json({
    configured: isAnthropicConfigured(),
    semCategoria: Number(r?.sem_categoria ?? 0),
    divergencias: r?.divergencias ?? [],
  });
}

export async function POST(req: Request) {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return NextResponse.json({ error: "Você não tem permissão para usar a Abelha." }, { status: 403 });
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "A IA não está configurada neste servidor (ANTHROPIC_API_KEY)." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Arquivo grande demais (máximo 9 MB por arquivo)." }, { status: 413 });
  }

  const message = String(form.get("message") ?? "").slice(0, 8000);
  const history = History.safeParse(JSON.parse(String(form.get("history") ?? "[]")));
  if (!history.success) return NextResponse.json({ error: "Histórico inválido." }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Envie no máximo ${MAX_FILES} arquivos por vez.` }, { status: 400 });

  const blocks: UserBlock[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `"${f.name}" passa de 9 MB.` }, { status: 413 });
    }
    const buf = Buffer.from(await f.arrayBuffer());
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") }, title: f.name });
    } else if (IMAGE_TYPES.has(f.type)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: f.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: buf.toString("base64") },
      });
    } else if (TEXT_EXT.test(f.name) || f.type.startsWith("text/")) {
      blocks.push({ type: "text", text: `Arquivo "${f.name}":\n${buf.toString("utf8").slice(0, 400_000)}` });
    } else {
      return NextResponse.json({ error: `Formato de "${f.name}" não suportado. Use foto, PDF, CSV, OFX ou TXT.` }, { status: 400 });
    }
  }
  if (files.length > 0) {
    blocks.unshift({ type: "text", text: `[${files.length} arquivo(s) anexado(s): ${files.map((f) => f.name).join(", ")}]` });
  }
  blocks.push({ type: "text", text: message.trim() || "Analise o(s) arquivo(s) anexado(s)." });

  try {
    const result = await runAbelha({ userId: user.id, userName: user.fullName, history: history.data, current: blocks });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[abelha]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "A Abelha não conseguiu responder agora. Tente de novo em instantes." }, { status: 502 });
  }
}
