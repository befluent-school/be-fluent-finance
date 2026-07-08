"use client";

import { useTransition } from "react";
import { toggleTaskCompleted } from "@/app/actions/tasks";

export function TaskCheckbox({ taskId, completed }: { taskId: string; completed: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <input
      type="checkbox"
      defaultChecked={completed}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.checked;
        startTransition(() => {
          toggleTaskCompleted(taskId, next);
        });
      }}
      className="size-4 rounded border-ink-700 bg-ink-950 text-amber-500 focus:ring-amber-500"
    />
  );
}
