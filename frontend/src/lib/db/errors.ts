/** Código SQLSTATE do Postgres (o Drizzle embrulha o erro do driver em `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const PG = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  /** RLS: "new row violates row-level security policy" / sem privilégio. */
  insufficientPrivilege: "42501",
} as const;

/** Loga o erro no servidor sem expor detalhes ao navegador. */
export function logDbError(context: string, err: unknown) {
  const code = pgErrorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[db] ${context}: ${code ?? "?"} ${message.split("\n")[0]}`);
}
