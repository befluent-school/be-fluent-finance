"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Send, X, RotateCcw, FileText } from "lucide-react";
import { confirmBankImport } from "@/app/actions/bank-import";

type Proposal = {
  kind: "importacao";
  accountLabel: string;
  resumo: string;
  rows: {
    date: string;
    description: string;
    amount: number;
    type: "CREDIT" | "DEBIT";
    categoryId: null;
  }[];
  status?: "pendente" | "importando" | "feito" | "erro";
  resultado?: string;
};
type Msg = {
  role: "user" | "assistant";
  text: string;
  at: number;
  /** Abertura automática: vai no histórico para a IA, mas não aparece na tela. */
  hidden?: boolean;
  files?: string[];
  options?: string[];
  proposals?: Proposal[];
  changes?: string[];
};
type Status = {
  configured: boolean;
  semCategoria: number;
  divergencias: { conta: string; diferenca: number }[];
};

const STORAGE_KEY = "abelha:conversa:v2";
const TEASER_KEY = "abelha:teaser-dispensado";
const SIX_HOURS = 6 * 60 * 60 * 1000;
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento: só não persiste */
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
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.85),
    );
    return blob
      ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
          type: "image/jpeg",
        })
      : file;
  } catch {
    return file;
  }
}

function pendingSummary(s: Status): string {
  const parts: string[] = [];
  if (s.divergencias.length)
    parts.push(
      `o saldo de ${s.divergencias.map((d) => d.conta).join(" e ")} não bate com o banco`,
    );
  if (s.semCategoria)
    parts.push(`${s.semCategoria} lançamento(s) estão sem categoria`);
  return parts.join(" e ");
}

export function AbelhaWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() =>
    typeof window === "undefined" ? [] : readLS<Msg[]>(STORAGE_KEY, []),
  );
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [teaser, setTeaser] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef(msgs);

  useEffect(() => {
    msgsRef.current = msgs;
    writeLS(STORAGE_KEY, msgs.slice(-60));
  }, [msgs]);
  // Chaves obrigatórias: no Chrome novo scrollIntoView() devolve uma Promise, e
  // um efeito que devolve algo que não é função derruba a página no React.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy, open]);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/abelha", { cache: "no-store" });
      if (!r.ok) return null;
      const s = (await r.json()) as Status;
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  // Ativa: ao carregar o sistema, se houver pendência, a Abelha chama com um balão.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetch("/api/abelha", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .catch(() => null)
      .then((s) => {
        if (!s) return;
        setStatus(s);
        if (!s.configured || !(s.semCategoria || s.divergencias.length)) return;
        if (Date.now() - readLS<number>(TEASER_KEY, 0) < SIX_HOURS) return;
        timer = setTimeout(() => setTeaser(true), 2500);
      });
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = useCallback(
    async (
      text: string,
      attach: File[] = [],
      mode: "chat" | "proactive" = "chat",
    ) => {
      if (mode === "chat" && !text.trim() && attach.length === 0) return;
      setError(null);
      const history = msgsRef.current.map((m) => ({
        role: m.role,
        text: m.text,
      }));
      const userMsg: Msg =
        mode === "proactive"
          ? {
              role: "user",
              text: "[A Abelha abriu a conversa por conta própria para tratar as pendências.]",
              at: Date.now(),
              hidden: true,
            }
          : {
              role: "user",
              text: text.trim(),
              at: Date.now(),
              files: attach.map((f) => f.name),
            };
      setMsgs((m) => [
        ...m.map((x) => ({ ...x, options: undefined })),
        userMsg,
      ]);
      setInput("");
      setFiles([]);
      setBusy(true);
      try {
        const fd = new FormData();
        fd.set("message", text);
        fd.set("mode", mode);
        fd.set("history", JSON.stringify(history));
        for (const f of attach) fd.append("files", await shrinkImage(f));
        const res = await fetch("/api/abelha", { method: "POST", body: fd });
        const data = await res
          .json()
          .catch(() => ({ error: "Resposta inválida do servidor." }));
        if (!res.ok || data.error)
          throw new Error(data.error ?? `Erro ${res.status}`);
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            text: data.reply,
            at: Date.now(),
            options: data.options?.length ? data.options : undefined,
            changes: data.changes?.length ? data.changes : undefined,
            proposals: data.proposals?.map((p: Proposal) => ({
              ...p,
              status: "pendente",
            })),
          },
        ]);
        if (data.changes?.length) void refreshStatus();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Falha ao falar com a Abelha.",
        );
      } finally {
        setBusy(false);
      }
    },
    [refreshStatus],
  );

  /** Abre o painel; se houver pendência e a conversa estiver parada, a Abelha puxa o assunto. */
  const openPanel = useCallback(async () => {
    setOpen(true);
    setTeaser(false);
    writeLS(TEASER_KEY, Date.now());
    const s = status ?? (await refreshStatus());
    const last = msgsRef.current[msgsRef.current.length - 1];
    const idle =
      !last ||
      Date.now() - last.at > SIX_HOURS ||
      (last.role === "assistant" && !last.options);
    if (
      s?.configured &&
      (s.semCategoria || s.divergencias.length) &&
      idle &&
      !busy
    ) {
      void send("", [], "proactive");
    }
  }, [status, refreshStatus, send, busy]);

  async function confirmProposal(mi: number, pi: number) {
    const p = msgs[mi].proposals![pi];
    const update = (patch: Partial<Proposal>) =>
      setMsgs((all) =>
        all.map((m, i) =>
          i !== mi
            ? m
            : {
                ...m,
                proposals: m.proposals!.map((x, j) =>
                  j === pi ? { ...x, ...patch } : x,
                ),
              },
        ),
      );
    update({ status: "importando" });
    const r = await confirmBankImport(p.accountLabel, p.rows);
    if (r.success) {
      update({
        status: "feito",
        resultado: `${r.imported} importado(s)${r.skipped ? `, ${r.skipped} já existiam` : ""}.`,
      });
      void send(`Importei os ${r.imported} lançamento(s). Pode seguir.`);
    } else {
      update({ status: "erro", resultado: r.error });
    }
  }

  const visible = msgs.filter((m) => !m.hidden);
  const lastMsg = msgs[msgs.length - 1];
  const options =
    !busy && lastMsg?.role === "assistant" ? (lastMsg.options ?? []) : [];
  const hasPending = Boolean(
    status && (status.semCategoria || status.divergencias.length),
  );

  return (
    <>
      {/* Balão ativo: a Abelha chama quando há algo para resolver */}
      {teaser && !open && status && (
        <div className="fixed bottom-24 right-4 z-40 w-[min(300px,calc(100vw-2rem))] rounded-2xl rounded-br-sm border border-amber-500/40 bg-ink-900 p-3 text-sm text-ink-100 shadow-xl md:right-6">
          <p>
            <span aria-hidden>🐝 </span>Oi! Vi que {pendingSummary(status)}.
            Posso te fazer algumas perguntas rápidas para acertar?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void openPanel()}
              className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-1 text-xs font-semibold text-ink-950"
            >
              Vamos
            </button>
            <button
              type="button"
              onClick={() => {
                setTeaser(false);
                writeLS(TEASER_KEY, Date.now());
              }}
              className="rounded-md px-3 py-1 text-xs text-ink-400 hover:text-ink-50"
            >
              Agora não
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : void openPanel())}
        aria-label={
          open ? "Fechar a Abelha" : "Abrir a Abelha, assistente financeira"
        }
        className={`fixed bottom-4 right-4 z-40 size-14 items-center justify-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-2xl shadow-lg glow-amber transition hover:brightness-105 md:bottom-6 md:right-6 ${
          open ? "hidden sm:flex" : "flex"
        }`}
      >
        <span aria-hidden>{open ? "✕" : "🐝"}</span>
        {!open && hasPending && (
          <span className="absolute -right-0.5 -top-0.5 size-3.5 animate-pulse rounded-full bg-status-overdue ring-2 ring-ink-950" />
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Abelha, assistente financeira"
          className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-ink-900 sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(680px,calc(100dvh-8rem))] sm:w-[420px] sm:rounded-2xl sm:border sm:border-ink-700 sm:shadow-2xl"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-ink-700 bg-ink-950/60 px-4 py-3">
            <span
              className="flex size-9 items-center justify-center rounded-full bg-amber-500/15 text-xl"
              aria-hidden
            >
              🐝
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-ink-50">
                Abelha
              </p>
              <p className="truncate text-xs text-ink-400">
                {busy
                  ? "trabalhando…"
                  : hasPending
                    ? pendingSummary(status!)
                    : "tudo em dia"}
              </p>
            </div>
            {visible.length > 0 && (
              <button
                type="button"
                onClick={() => setMsgs([])}
                title="Nova conversa"
                aria-label="Nova conversa"
                className="rounded p-2 text-ink-400 hover:bg-white/[0.06] hover:text-ink-50"
              >
                <RotateCcw className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="rounded p-2 text-ink-400 hover:bg-white/[0.06] hover:text-ink-50"
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 text-sm">
            {visible.length === 0 && !busy && (
              <div className="space-y-2 text-ink-200">
                <p>
                  Oi! Eu sou a Abelha. Cuido para o financeiro bater com os
                  bancos: categorizo lançamentos, confiro extratos e leio
                  comprovantes. Pode me mandar fotos, PDFs ou planilhas.
                </p>
                {status && !status.configured && (
                  <p className="text-status-overdue">
                    A IA ainda não está configurada neste servidor (falta a
                    chave da OpenAI).
                  </p>
                )}
              </div>
            )}

            {msgs.map((m, mi) =>
              m.hidden ? null : (
                <div
                  key={mi}
                  className={
                    m.role === "user"
                      ? "flex justify-end"
                      : "flex justify-start"
                  }
                >
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-amber-500/20 px-3 py-2 text-ink-50"
                        : "max-w-[92%] rounded-2xl rounded-bl-sm bg-white/[0.05] px-3 py-2 text-ink-100"
                    }
                  >
                    {m.files && m.files.length > 0 && (
                      <p className="mb-1 flex flex-wrap gap-1 text-xs text-ink-400">
                        {m.files.map((f) => (
                          <span
                            key={f}
                            className="inline-flex max-w-full items-center gap-1 truncate rounded bg-white/[0.06] px-1.5 py-0.5"
                          >
                            <FileText className="size-3 shrink-0" />
                            {f}
                          </span>
                        ))}
                      </p>
                    )}
                    {m.text && (
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {m.text}
                      </p>
                    )}
                    {m.changes && (
                      <ul className="mt-2 space-y-0.5 border-t border-ink-700 pt-2 text-xs text-status-paid">
                        {m.changes.map((c, i) => (
                          <li key={i}>✓ {c}</li>
                        ))}
                      </ul>
                    )}
                    {m.proposals?.map((p, pi) => (
                      <div
                        key={pi}
                        className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs"
                      >
                        <p className="font-semibold text-ink-50">{p.resumo}</p>
                        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-ink-300">
                          {p.rows.map((r, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className="truncate">
                                {dataBR(r.date)} · {r.description}
                              </span>
                              <span
                                className={`font-tabular shrink-0 ${r.type === "CREDIT" ? "text-status-paid" : "text-status-overdue"}`}
                              >
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
                            Importar {p.rows.length} lançamento(s) em{" "}
                            {p.accountLabel}
                          </button>
                        )}
                        {p.status === "importando" && (
                          <p className="mt-2 text-ink-400">Importando…</p>
                        )}
                        {p.status === "feito" && (
                          <p className="mt-2 text-status-paid">
                            ✓ {p.resultado}
                          </p>
                        )}
                        {p.status === "erro" && (
                          <p className="mt-2 text-status-overdue">
                            {p.resultado}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}

            {options.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-1">
                {options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => void send(o)}
                    className="rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}

            {busy && (
              <div className="flex justify-start">
                <p className="rounded-2xl rounded-bl-sm bg-white/[0.05] px-3 py-2 text-ink-400">
                  <span
                    className="inline-flex gap-1"
                    aria-label="Abelha está trabalhando"
                  >
                    <span className="size-1.5 animate-bounce rounded-full bg-amber-400 [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-amber-400 [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-amber-400" />
                  </span>
                  {msgs[msgs.length - 1]?.files?.length ? (
                    <span className="ml-2 text-xs">
                      lendo arquivos (até 1–2 min)
                    </span>
                  ) : null}
                </p>
              </div>
            )}
            {error && <p className="text-xs text-status-overdue">{error}</p>}
            <div ref={endRef} />
          </div>

          {visible.length === 0 && !busy && (
            <div className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-2">
              {hasPending && (
                <button
                  type="button"
                  onClick={() => void send("", [], "proactive")}
                  className="rounded-full border border-amber-500/50 px-3 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
                >
                  Resolver pendências
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void send(
                    "Me dê um resumo financeiro do mês atual comparado ao anterior.",
                  )
                }
                className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:border-amber-500"
              >
                Resumo do mês
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:border-amber-500"
              >
                Enviar extrato ou comprovante
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input, files);
            }}
            className="shrink-0 border-t border-ink-700 bg-ink-950/60 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {files.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex max-w-full items-center gap-1 rounded bg-white/[0.06] px-2 py-0.5 text-xs text-ink-200"
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remover ${f.name}`}
                      onClick={() =>
                        setFiles((fs) => fs.filter((_, j) => j !== i))
                      }
                    >
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
                  setFiles((fs) =>
                    [...fs, ...Array.from(e.target.files ?? [])].slice(0, 5),
                  );
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Anexar foto ou arquivo"
                title="Anexar foto, PDF ou planilha"
                className="shrink-0 rounded-md p-2.5 text-ink-400 hover:bg-white/[0.06] hover:text-ink-50"
              >
                <Paperclip className="size-5" />
              </button>
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const ta = e.target;
                  ta.style.height = "auto";
                  ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input, files);
                  }
                }}
                rows={1}
                placeholder="Responda ou envie um arquivo…"
                className="min-h-[42px] min-w-0 flex-1 resize-none rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-base text-ink-50 placeholder:text-ink-500 focus:border-amber-500 focus:outline-none sm:text-sm"
              />
              <button
                type="submit"
                disabled={busy || (!input.trim() && files.length === 0)}
                aria-label="Enviar"
                className="shrink-0 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 p-2.5 text-ink-950 disabled:opacity-40"
              >
                <Send className="size-5" />
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
