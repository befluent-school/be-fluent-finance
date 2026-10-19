"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, X, Trash2, FileText } from "lucide-react";
import { confirmBankImport } from "@/app/actions/bank-import";

type Proposal = {
  kind: "importacao";
  accountLabel: string;
  resumo: string;
  rows: { date: string; description: string; amount: number; type: "CREDIT" | "DEBIT"; categoryId: null }[];
  status?: "pendente" | "importando" | "feito" | "erro";
  resultado?: string;
};
type Msg = { role: "user" | "assistant"; text: string; files?: string[]; proposals?: Proposal[]; changes?: string[] };
type Status = { configured: boolean; semCategoria: number; divergencias: { conta: string; diferenca: number }[] };

const STORAGE_KEY = "abelha:conversa:v1";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

function load(): Msg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}
function save(msgs: Msg[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-40)));
  } catch {
    /* sem armazenamento: a conversa só não persiste */
  }
}

/** Foto de celular costuma ter 4-12 MB: reduz para ~2000px em JPEG antes de enviar. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export function AbelhaWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => (typeof window === "undefined" ? [] : load()));
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => save(msgs), [msgs]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy, open]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/abelha", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Status | null) => s && setStatus(s))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(text: string, attach: File[] = files) {
    if (busy || (!text.trim() && attach.length === 0)) return;
    setError(null);
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    const userMsg: Msg = { role: "user", text: text.trim(), files: attach.map((f) => f.name) };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setFiles([]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("message", text);
      fd.set("history", JSON.stringify(history));
      for (const f of attach) fd.append("files", await shrinkImage(f));
      const res = await fetch("/api/abelha", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ error: "Resposta inválida do servidor." }));
      if (!res.ok || data.error) throw new Error(data.error ?? `Erro ${res.status}`);
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          text: data.reply,
          changes: data.changes?.length ? data.changes : undefined,
          proposals: data.proposals?.map((p: Proposal) => ({ ...p, status: "pendente" })),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao falar com a Abelha.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal(mi: number, pi: number) {
    const p = msgs[mi].proposals![pi];
    const update = (patch: Partial<Proposal>) =>
      setMsgs((all) =>
        all.map((m, i) => (i !== mi ? m : { ...m, proposals: m.proposals!.map((x, j) => (j === pi ? { ...x, ...patch } : x)) }))
      );
    update({ status: "importando" });
    const r = await confirmBankImport(p.accountLabel, p.rows);
    if (r.success) {
      update({ status: "feito", resultado: `${r.imported} importado(s)${r.skipped ? `, ${r.skipped} já existiam` : ""}.` });
    } else {
      update({ status: "erro", resultado: r.error });
    }
  }

  const quick: { label: string; text: string }[] = [];
  if (status?.semCategoria) quick.push({ label: `Resolver ${status.semCategoria} sem categoria`, text: "Vamos resolver os lançamentos sem categoria, um de cada vez." });
  if (status?.divergencias.length) quick.push({ label: "Por que o saldo não bate?", text: "O saldo de alguma conta não bate com o banco. Me ajude a achar o motivo." });
  quick.push({ label: "Resumo do mês", text: "Me dê um resumo financeiro do mês atual comparado ao anterior." });
  quick.push({ label: "Enviar extrato ou comprovante", text: "" });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fechar a Abelha" : "Abrir a Abelha, assistente financeira"}
        className="fixed bottom-4 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-2xl shadow-lg glow-amber transition hover:brightness-105 md:bottom-6 md:right-6"
      >
        <span aria-hidden>🐝</span>
        {!open && status && status.semCategoria + status.divergencias.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-status-overdue ring-2 ring-ink-950" />
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Abelha, assistente financeira"
          className="card-premium fixed inset-0 z-50 flex flex-col bg-ink-950 sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(640px,80vh)] sm:w-[420px] sm:rounded-xl"
        >
          <header className="flex items-center gap-3 border-b border-ink-700 px-4 py-3">
            <span className="text-2xl" aria-hidden>🐝</span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-ink-50">Abelha</p>
              <p className="truncate text-xs text-ink-400">Assistente financeira da Be Fluent</p>
            </div>
            {msgs.length > 0 && (
              <button
                type="button"
                onClick={() => setMsgs([])}
                title="Nova conversa"
                aria-label="Nova conversa"
                className="rounded p-1.5 text-ink-400 hover:bg-white/[0.06] hover:text-ink-50"
              >
                <Trash2 className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="rounded p-1.5 text-ink-400 hover:bg-white/[0.06] hover:text-ink-50"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {msgs.length === 0 && (
              <div className="space-y-2 text-ink-200">
                <p>
                  Oi! Eu sou a Abelha. Cuido para o financeiro bater com os bancos: categorizo lançamentos, confiro extratos e leio
                  comprovantes. Pode me mandar fotos, PDFs ou planilhas.
                </p>
                {status && (status.semCategoria > 0 || status.divergencias.length > 0) && (
                  <ul className="list-disc space-y-0.5 pl-5 text-ink-300">
                    {status.semCategoria > 0 && <li>{status.semCategoria} lançamento(s) sem categoria</li>}
                    {status.divergencias.map((d) => (
                      <li key={d.conta}>
                        {d.conta}: sistema {d.diferenca > 0 ? "acima" : "abaixo"} do banco em {brl(Math.abs(d.diferenca))}
                      </li>
                    ))}
                  </ul>
                )}
                {status && !status.configured && (
                  <p className="text-status-overdue">A IA ainda não está configurada neste servidor.</p>
                )}
              </div>
            )}

            {msgs.map((m, mi) => (
              <div key={mi} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-lg rounded-br-sm bg-amber-500/15 px-3 py-2 text-ink-50"
                      : "max-w-[92%] rounded-lg rounded-bl-sm bg-white/[0.04] px-3 py-2 text-ink-100"
                  }
                >
                  {m.files && m.files.length > 0 && (
                    <p className="mb-1 flex flex-wrap gap-1 text-xs text-ink-400">
                      {m.files.map((f) => (
                        <span key={f} className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5">
                          <FileText className="size-3" />
                          {f}
                        </span>
                      ))}
                    </p>
                  )}
                  {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                  {m.changes && (
                    <ul className="mt-2 space-y-0.5 border-t border-ink-700 pt-2 text-xs text-status-paid">
                      {m.changes.map((c, i) => (
                        <li key={i}>✓ {c}</li>
                      ))}
                    </ul>
                  )}
                  {m.proposals?.map((p, pi) => (
                    <div key={pi} className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                      <p className="font-semibold text-ink-50">{p.resumo}</p>
                      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-ink-300">
                        {p.rows.map((r, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="truncate">
                              {dataBR(r.date)} · {r.description}
                            </span>
                            <span className={`font-tabular shrink-0 ${r.type === "CREDIT" ? "text-status-paid" : "text-status-overdue"}`}>
                              {r.type === "CREDIT" ? "+" : "−"}
                              {brl(r.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {p.status === "pendente" && (
                        <button
                          type="button"
                          onClick={() => confirmProposal(mi, pi)}
                          className="mt-2 w-full rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-1.5 font-semibold text-ink-950"
                        >
                          Importar {p.rows.length} lançamento(s) em {p.accountLabel}
                        </button>
                      )}
                      {p.status === "importando" && <p className="mt-2 text-ink-400">Importando…</p>}
                      {p.status === "feito" && <p className="mt-2 text-status-paid">✓ {p.resultado}</p>}
                      {p.status === "erro" && <p className="mt-2 text-status-overdue">{p.resultado}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-ink-400">
                  <span className="animate-pulse">Abelha está trabalhando…</span>
                  {msgs[msgs.length - 1]?.files?.length ? " (lendo arquivos pode levar até 1-2 minutos)" : ""}
                </p>
              </div>
            )}
            {error && <p className="text-xs text-status-overdue">{error}</p>}
            <div ref={endRef} />
          </div>

          {msgs.length === 0 && !busy && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => (q.text ? send(q.text, []) : fileRef.current?.click())}
                  className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:border-amber-500 hover:text-ink-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-ink-700 p-3"
          >
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-2 py-0.5 text-xs text-ink-200">
                    {f.name}
                    <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,application/pdf,.csv,.ofx,.txt,.tsv"
                className="hidden"
                onChange={(e) => {
                  setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])].slice(0, 5));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Anexar foto ou arquivo"
                title="Anexar foto, PDF ou planilha"
                className="rounded-md p-2 text-ink-400 hover:bg-white/[0.06] hover:text-ink-50"
              >
                <Paperclip className="size-4" />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder="Pergunte ou envie um arquivo…"
                className="max-h-32 min-h-[38px] flex-1 resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || (!input.trim() && files.length === 0)}
                aria-label="Enviar"
                className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 p-2 text-ink-950 disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
