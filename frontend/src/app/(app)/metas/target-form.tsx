"use client";

import { useActionState } from "react";
import type { TargetsState } from "@/app/actions/targets";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const labelClass = "block text-sm font-medium text-ink-100";

export function TargetForm({
  action,
  referenceMonth,
  fieldName,
  fieldLabel,
  defaultValue,
  step = "0.01",
  hiddenFields,
}: {
  action: (state: TargetsState, formData: FormData) => Promise<TargetsState>;
  referenceMonth: string;
  fieldName: string;
  fieldLabel: string;
  defaultValue?: number | string;
  step?: string;
  hiddenFields?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<TargetsState, FormData>(action, undefined);

  return (
    <form action={formAction} className="flex items-end gap-3">
      <input type="hidden" name="referenceMonth" value={referenceMonth} />
      {hiddenFields &&
        Object.entries(hiddenFields).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      <div className="flex-1">
        <label className={labelClass}>{fieldLabel}</label>
        <input
          name={fieldName}
          type="number"
          step={step}
          min={0}
          defaultValue={defaultValue}
          required
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber transition hover:brightness-105 disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Salvar"}
      </button>
      {state?.message && <p className="text-xs text-status-overdue">{state.message}</p>}
      {state?.success && <p className="text-xs text-status-paid">Salvo.</p>}
    </form>
  );
}
