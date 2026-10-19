import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Recebe erros do navegador e grava no log do servidor (sem dados financeiros). */
export async function POST(req: Request) {
  try {
    const text = (await req.text()).slice(0, 6000);
    const data = JSON.parse(text) as Record<string, unknown>;
    const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\r\n]+/g, " ⏎ ").slice(0, n);
    console.error(
      `[client-error] ${clean(data.where, 60)} @ ${clean(data.url, 120)} :: ${clean(data.message, 500)} :: ${clean(data.stack, 2500)}` +
        (data.extra ? ` :: extra=${clean(data.extra, 1500)}` : "") +
        ` :: ua=${clean(data.ua, 200)}`
    );
  } catch {
    /* corpo inválido: ignora */
  }
  return new NextResponse(null, { status: 204 });
}
