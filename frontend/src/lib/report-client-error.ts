/** Manda um erro do navegador para o log do servidor (pm2), sem nunca lançar. */
export function reportClientError(where: string, error: unknown, extra?: string) {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const body = JSON.stringify({
      where,
      message: e.message.slice(0, 500),
      stack: (e.stack ?? "").slice(0, 3000),
      extra: extra?.slice(0, 2000),
      url: typeof location !== "undefined" ? location.pathname : "",
      ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "",
    });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/client-error", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* relatar erro nunca pode causar outro erro */
  }
}
