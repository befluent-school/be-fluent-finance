"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

const TaskSchema = z.object({
  title: z.string().min(2, { error: "Informe o título da tarefa." }),
  description: z.string().nullable().optional(),
  dueDate: z.string().min(1, { error: "Informe a data." }),
  priority: z.enum(["alta", "media", "baixa"]),
  assigneeId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
});

export type TaskState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function createTask(_state: TaskState, formData: FormData): Promise<TaskState> {
  const validated = TaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    dueDate: formData.get("dueDate"),
    priority: formData.get("priority"),
    assigneeId: formData.get("assigneeId"),
    recurrence: formData.get("recurrence"),
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    title: validated.data.title,
    description: validated.data.description || null,
    due_date: validated.data.dueDate,
    priority: validated.data.priority,
    assignee_id: validated.data.assigneeId || null,
    recurrence: validated.data.recurrence,
  });

  if (error) {
    return { message: "Erro ao criar tarefa." };
  }

  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return { success: true };
}

const UpdateTaskSchema = TaskSchema.extend({ id: z.uuid() });

export async function updateTask(_state: TaskState, formData: FormData): Promise<TaskState> {
  const validated = UpdateTaskSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    dueDate: formData.get("dueDate"),
    priority: formData.get("priority"),
    assigneeId: formData.get("assigneeId"),
    recurrence: formData.get("recurrence"),
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      title: validated.data.title,
      description: validated.data.description || null,
      due_date: validated.data.dueDate,
      priority: validated.data.priority,
      assignee_id: validated.data.assigneeId || null,
      recurrence: validated.data.recurrence,
    })
    .eq("id", validated.data.id);

  if (error) {
    return { message: "Erro ao atualizar tarefa." };
  }

  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
  return { success: true };
}

function nextDueDate(dueDate: string, recurrence: "daily" | "weekly" | "monthly"): string {
  const date = new Date(dueDate + "T00:00:00");
  if (recurrence === "daily") date.setDate(date.getDate() + 1);
  if (recurrence === "weekly") date.setDate(date.getDate() + 7);
  if (recurrence === "monthly") date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

export async function toggleTaskCompleted(taskId: string, completed: boolean): Promise<void> {
  const supabase = await createClient();

  const { data: task } = await supabase
    .from("tasks")
    .select("due_date, recurrence, title, description, priority, assignee_id")
    .eq("id", taskId)
    .single();

  const { error } = await supabase
    .from("tasks")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", taskId);

  if (error) return;

  if (completed && task && task.recurrence !== "none") {
    await supabase.from("tasks").insert({
      title: task.title,
      description: task.description,
      due_date: nextDueDate(task.due_date, task.recurrence as "daily" | "weekly" | "monthly"),
      priority: task.priority,
      assignee_id: task.assignee_id,
      recurrence: task.recurrence,
    });
  }

  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
}
