"use client";

import { useTransition, useState } from "react";
import { runRolloverNow } from "@/app/actions/automation";

export function RunNowButton() {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await runRolloverNow();
            if (res?.error) setMsg({ ok: false, text: res.error });
            else if (res?.summary) setMsg({ ok: true, text: res.summary });
          })
        }
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
      >
        {isPending ? "Rodando..." : "Rodar virada agora"}
      </button>
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-status-paid" : "text-status-overdue"}`}>{msg.text}</p>
      )}
    </div>
  );
}
