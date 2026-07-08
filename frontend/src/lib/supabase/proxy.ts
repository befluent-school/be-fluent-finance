import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/login"];
const OWNER_ONLY_PREFIXES = ["/configuracoes"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() valida o token com o servidor de Auth — nunca usar getSession()
  // para decisões de autorização (session vem só do cookie, não verificado).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicRoute = PUBLIC_ROUTES.some((route) => path.startsWith(route));
  const isOnboarding2fa = path.startsWith("/onboarding/2fa-setup");

  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user) {
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const has2faEnrolled = aal.data?.currentLevel === "aal2" || aal.data?.nextLevel === "aal2";

    // 2FA é obrigatório: se o usuário não tem fator TOTP verificado ainda,
    // força o onboarding antes de liberar qualquer outra rota.
    if (!has2faEnrolled && !isOnboarding2fa) {
      return NextResponse.redirect(new URL("/onboarding/2fa-setup", request.url));
    }

    // Se o usuário está autenticado mas ainda não elevou para aal2
    // (fez login mas não digitou o código TOTP desta sessão), força o desafio.
    if (
      has2faEnrolled &&
      aal.data?.currentLevel !== aal.data?.nextLevel &&
      !isOnboarding2fa
    ) {
      return NextResponse.redirect(new URL("/onboarding/2fa-setup?challenge=1", request.url));
    }

    if (isPublicRoute) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (OWNER_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "owner") {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
  }

  return response;
}
