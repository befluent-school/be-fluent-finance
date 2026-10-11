import { NextResponse, type NextRequest } from "next/server";
import { isAllowedOrigin } from "@/lib/request-rules";

/**
 * Primeira barreira de toda requisição (Next 16: "proxy", antigo middleware):
 * 1. CSRF: requisições que alteram dados (POST/PUT/PATCH/DELETE — inclui as
 *    Server Actions) só são aceitas vindas da própria origem do app.
 * 2. Sem cookie de sessão, rotas internas redirecionam para o login.
 * 3. Content-Security-Policy com nonce por requisição.
 *
 * A autenticação de verdade (sessão no banco + 2FA + papel) é feita em cada
 * página e em cada Server Action (src/lib/auth/session.ts) — o proxy não
 * consulta o banco.
 */

const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/redefinir-senha"];
const SESSION_COOKIES = ["__Host-financeiro_session", "financeiro_session"];

function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Estilos inline (atributo style dos gráficos/barras de progresso).
    // Risco baixo comparado a scripts, que seguem restritos ao nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV === "development";

  // Endpoints de automação chamados por máquina (agendador do SO): têm a
  // própria autenticação por segredo (x-cron-secret) e não usam cookie/Origin.
  // Deixamos passar sem checagem de CSRF/sessão; a rota valida o segredo.
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const allowed = appUrl ? new URL(appUrl).origin : request.nextUrl.origin;
    if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("sec-fetch-site"), allowed)) {
      return new NextResponse("Origem não permitida.", { status: 403 });
    }
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!isPublic && !hasSessionCookie && request.method === "GET") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // Páginas com dados financeiros nunca devem ficar em cache compartilhado.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.png|logo-be-fluent.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    },
  ],
};
