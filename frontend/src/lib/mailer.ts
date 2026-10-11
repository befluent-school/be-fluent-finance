import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const e = env();
  if (!e.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
  });
  return transporter;
}

export type MailMessage = { to: string; subject: string; text: string; html: string };

/**
 * Envia e-mail pelo SMTP da Hostinger. Sem SMTP configurado (só em
 * desenvolvimento — em produção o app recusa iniciar sem SMTP), a mensagem
 * vai para o log do servidor.
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) {
    if (env().NODE_ENV === "production") throw new Error("SMTP não configurado.");
    console.warn(`[mailer] SMTP não configurado — e-mail para ${msg.to} não enviado.\n${msg.subject}\n${msg.text}`);
    return;
  }
  await t.sendMail({ from: env().EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Layout simples e compatível com clientes de e-mail, nas cores da Be Fluent. */
export function emailLayout(params: {
  title: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  code?: string;
  footnote?: string;
}): string {
  const p = params.paragraphs.map((t) => `<p style="margin:0 0 14px;line-height:1.55">${esc(t)}</p>`).join("");
  const button = params.action
    ? `<p style="margin:24px 0"><a href="${esc(params.action.url)}" style="background:#f0a520;color:#1a1a1a;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;display:inline-block">${esc(params.action.label)}</a></p>`
    : "";
  const code = params.code
    ? `<p style="margin:24px 0;font-family:monospace;font-size:28px;letter-spacing:6px;font-weight:700">${esc(params.code)}</p>`
    : "";
  const foot = params.footnote ? `<p style="margin:20px 0 0;color:#6b6b6b;font-size:13px">${esc(params.footnote)}</p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f7f7f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;padding:32px">
<tr><td><p style="margin:0 0 24px;font-weight:800;font-size:20px">Be Fluent <span style="color:#f0a520">Financeiro</span></p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(params.title)}</h1>${p}${code}${button}${foot}</td></tr></table>
</td></tr></table></body></html>`;
}
