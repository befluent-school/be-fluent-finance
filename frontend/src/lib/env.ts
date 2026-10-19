import "server-only";
import * as z from "zod";

/**
 * Variáveis de ambiente do servidor, validadas na primeira leitura (não no
 * import, para o `next build` não exigir segredos). Documentação de cada uma
 * em ../.env.example.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  APP_SECRET: z.string().min(32, "APP_SECRET deve ter ao menos 32 caracteres (openssl rand -hex 32)"),
  NEXT_PUBLIC_APP_URL: z.url("NEXT_PUBLIC_APP_URL deve ser a URL pública (ex.: https://financeiro.befluentschool.com.br)"),
  TRUST_PROXY: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),

  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Segredo do endpoint interno de automação (/api/cron/*) chamado pelo
  // agendador do SO. Se vazio, o endpoint fica desativado (responde 503).
  CRON_SECRET: z.string().min(16).optional(),
  // Usuário (id) em cujo contexto o cron roda as ações (precisa ser owner/socio).
  CRON_USER_ID: z.string().uuid().optional(),

  BEELY_SOURCE: z.enum(["postgres", "supabase", "off"]).default("off"),
  BEELY_READONLY_DATABASE_URL: z.string().optional(),
  BEELY_SUPABASE_URL: z.string().optional(),
  BEELY_SUPABASE_ANON_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida do servidor — ${problems}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
    throw new Error("Em produção NEXT_PUBLIC_APP_URL deve usar https://");
  }
  if (parsed.data.NODE_ENV === "production" && (!parsed.data.SMTP_HOST || !parsed.data.EMAIL_FROM)) {
    // Sem SMTP o sistema funciona (o owner envia links de uso único com
    // `npm run user -- reset-link`), mas "Esqueci minha senha" não envia e-mail.
    console.warn("[env] SMTP não configurado: e-mails de recuperação de senha e de código do 2FA não serão enviados.");
  }
  cached = parsed.data;
  return cached;
}

/** Origem pública da aplicação (esquema + host + porta), usada na checagem de CSRF. */
export function appOrigin(): string {
  return new URL(env().NEXT_PUBLIC_APP_URL).origin;
}

export function secureCookies(): boolean {
  return env().NEXT_PUBLIC_APP_URL.startsWith("https://");
}
