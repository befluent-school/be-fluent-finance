import { NextResponse } from "next/server";
import * as z from "zod";
import { sql } from "drizzle-orm";
import { getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser } from "@/lib/db";
import { isAIConfigured } from "@/lib/ai";
import { PROACTIVE_KICKOFF, runAbelha, type Attachment } from "@/lib/abelha/agent";

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
    configured: isAIConfigured(),
    semCategoria: Number(r?.sem_categoria ?? 0),
    divergencias: r?.divergencias ?? [],
  });
}

export async function POST(req: Request) {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return NextResponse.json({ error: "Você não tem permissão para usar a Abelha." }, { status: 403 });
  if (!isAIConfigured()) {
    return NextResponse.json({ error: "A IA não está configurada neste servidor (OPENAI_API_KEY)." }, { status: 503 });
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

  const attachments: Attachment[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `"${f.name}" passa de 9 MB.` }, { status: 413 });
    }
    const buf = Buffer.from(await f.arrayBuffer());
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      attachments.push({ kind: "pdf", name: f.name, base64: buf.toString("base64") });
    } else if (IMAGE_TYPES.has(f.type)) {
      attachments.push({ kind: "image", name: f.name, mime: f.type, base64: buf.toString("base64") });
    } else if (TEXT_EXT.test(f.name) || f.type.startsWith("text/")) {
      attachments.push({ kind: "text", name: f.name, text: buf.toString("utf8").slice(0, 400_000) });
    } else {
      return NextResponse.json({ error: `Formato de "${f.name}" não suportado. Use foto, PDF, CSV, OFX ou TXT.` }, { status: 400 });
    }
  }
  const proactive = form.get("mode") === "proactive";
  const text = proactive
    ? PROACTIVE_KICKOFF
    : (files.length ? `[${files.length} arquivo(s) anexado(s): ${files.map((f) => f.name).join(", ")}]\n` : "") +
      (message.trim() || "Analise o(s) arquivo(s) anexado(s).");

  try {
    const result = await runAbelha({ userId: user.id, userName: user.fullName, history: history.data, message: text, attachments });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[abelha]", err instanceof Error ? err.message : err);
    // Problemas da conta do provedor de IA: mensagem clara do que fazer.
    const e = err as { status?: number; code?: string; error?: { code?: string } };
    const code = e.code ?? e.error?.code;
    if (code === "insufficient_quota" || (e.status === 429 && /credit|quota/i.test(String((err as Error).message)))) {
      return NextResponse.json(
        { error: "A conta da OpenAI está sem créditos. Adicione saldo em platform.openai.com → Settings → Billing e tente de novo." },
        { status: 402 }
      );
    }
    if (e.status === 401) {
      return NextResponse.json({ error: "A chave da OpenAI foi recusada (inválida ou apagada). Cadastre uma chave nova no servidor." }, { status: 401 });
    }
    if (e.status === 404 || code === "model_not_found") {
      return NextResponse.json({ error: "O modelo de IA configurado não está disponível nesta conta da OpenAI (OPENAI_MODEL)." }, { status: 502 });
    }
    if (e.status === 429) {
      return NextResponse.json({ error: "A OpenAI está limitando as requisições agora. Aguarde um minuto e tente de novo." }, { status: 429 });
    }
    return NextResponse.json({ error: "A Abelha não conseguiu responder agora. Tente de novo em instantes." }, { status: 502 });
  }
}
