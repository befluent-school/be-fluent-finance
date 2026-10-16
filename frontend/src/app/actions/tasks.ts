"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { isoDate } from "@/lib/validation";

const TaskSchema = z.object({
  title: z.string().trim().min(2, { error: "Informe o título da tarefa." }).max(200),
  description: z.string().max(2000).nullable().optional(),
  dueDate: isoDate,
  priority: z.enum(["alta", "media", "baixa"]),
  assigneeId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
});

export type TaskState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

function readTask(formData: FormData) {
  return {
    title: formData.get("title"),
    description: formData.get("description"),
    dueDate: formData.get("dueDate"),
    priority: formData.get("priority"),
    assigneeId: formData.get("assigneeId"),
    recurrence: formData.get("recurrence"),
  };
}

export async function createTask(_state: TaskState, formData: FormData): Promise<TaskState> {
  const user = await getActionUser(Policies.authenticated);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = TaskSchema.safeParse(readTask(formData));
  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  try {
    await withUser(user.id, (tx) =>
      tx.insert(tasks).values({
        title: validated.data.title,
        description: validated.data.description || null,
        dueDate: validated.data.dueDate,
        priority: validated.data.priority,
        assigneeId: validated.data.assigneeId || null,
        recurrence: validated.data.recurrence,
      })
    );
  } catch (err) {
    logDbError("createTask", err);
    return { message: "Erro ao criar tarefa." };
  }

  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return { success: true };
}

const UpdateTaskSchema = TaskSchema.extend({ id: z.uuid() });

export async function updateTask(_state: TaskState, formData: FormData): Promise<TaskState> {
  const user = await getActionUser(Policies.authenticated);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = UpdateTaskSchema.safeParse({ id: formData.get("id"), ...readTask(formData) });
  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  try {
    const updated = await withUser(user.id, (tx) =>
      tx
        .update(tasks)
        .set({
          title: validated.data.title,
          description: validated.data.description || null,
          dueDate: validated.data.dueDate,
          priority: validated.data.priority,
          assigneeId: validated.data.assigneeId || null,
          recurrence: validated.data.recurrence,
        })
        .where(eq(tasks.id, validated.data.id))
        .returning({ id: tasks.id })
    );
    if (updated.length === 0) return { message: "Tarefa não encontrada." };
  } catch (err) {
    logDbError("updateTask", err);
    return { message: "Erro ao atualizar tarefa." };
  }

  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return { success: true };
}

function nextDueDate(dueDate: string, recurrence: "daily" | "weekly" | "monthly"): string {
  const date = new Date(dueDate + "T00:00:00Z");
  if (recurrence === "daily") date.setUTCDate(date.getUTCDate() + 1);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (recurrence === "monthly") {
    // 31/01 → 28/02 (último dia do mês seguinte), nunca "pula" para março.
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

export async function toggleTaskCompleted(taskId: string, completed: boolean): Promise<void> {
  const user = await getActionUser(Policies.authenticated);
  if (!user) return;
  const parsed = z.object({ taskId: z.uuid(), completed: z.boolean() }).safeParse({ taskId, completed });
  if (!parsed.success) return;

  try {
    await withUser(user.id, async (tx) => {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, parsed.data.taskId));
      if (!task) return;

      await tx
        .update(tasks)
        .set({
          completed: parsed.data.completed,
          completedAt: parsed.data.completed ? new Date().toISOString() : null,
        })
        .where(eq(tasks.id, task.id));

      // Recorrência: ao concluir (pela primeira vez), cria a próxima ocorrência.
      if (parsed.data.completed && !task.completed && task.recurrence !== "none") {
        await tx.insert(tasks).values({
          title: task.title,
          description: task.description,
          dueDate: nextDueDate(task.dueDate, task.recurrence),
          priority: task.priority,
          assigneeId: task.assigneeId,
          recurrence: task.recurrence,
        });
      }
    });
  } catch (err) {
    logDbError("toggleTaskCompleted", err);
    return;
  }

  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
}
