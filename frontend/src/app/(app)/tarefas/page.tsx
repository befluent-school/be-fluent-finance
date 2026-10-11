import { and, asc, eq, gte, lte } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withUser, sequential } from "@/lib/db";
import { profiles as profilesTable, tasks as tasksTable } from "@/lib/db/schema";
import { parseIsoDate } from "@/lib/validation";
import { MonthCalendar } from "./month-calendar";
import { TaskForm } from "./task-form";
import { TaskCheckbox } from "./task-checkbox";

const PRIORITY_LABEL: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const PRIORITY_CLASS: Record<string, string> = {
  alta: "text-status-overdue",
  media: "text-status-pending",
  baixa: "text-ink-500",
};

export default async function TarefasPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; date?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const parsedYear = params.year ? parseInt(params.year, 10) : NaN;
  const parsedMonth = params.month ? parseInt(params.month, 10) : NaN;
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : now.getFullYear();
  const month = parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : now.getMonth() + 1;
  const selectedDate =
    parseIsoDate(params.date) ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);

  const user = await requireUser();

  const { monthTasks, selectedTasks, profiles } = await withUser(user.id, async (tx) => {
    const [monthTasks, taskRows, profiles] = await sequential([
      () => tx
        .select({ due_date: tasksTable.dueDate })
        .from(tasksTable)
        .where(and(gte(tasksTable.dueDate, monthStart), lte(tasksTable.dueDate, monthEnd))),
      () => tx.query.tasks.findMany({
        where: eq(tasksTable.dueDate, selectedDate),
        with: { assignee: { columns: { fullName: true } } },
        orderBy: asc(tasksTable.priority),
      }),
      () => // RLS de profiles: owner vê todos; os demais veem só a si mesmos.
      tx
        .select({ id: profilesTable.id, full_name: profilesTable.fullName })
        .from(profilesTable)
        .where(eq(profilesTable.active, true))
        .orderBy(asc(profilesTable.fullName)),
    ]);
    const selectedTasks = taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      due_date: t.dueDate,
      priority: t.priority,
      assignee_id: t.assigneeId,
      recurrence: t.recurrence,
      completed: t.completed,
      profiles: t.assignee ? { full_name: t.assignee.fullName } : null,
    }));
    return { monthTasks, selectedTasks, profiles };
  });

  const countsByDay: Record<string, number> = {};
  for (const t of monthTasks) {
    countsByDay[t.due_date] = (countsByDay[t.due_date] ?? 0) + 1;
  }

  const selectedDateLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div>
      <p className="text-sm text-ink-300">
        Calendário de atividades fixas e variáveis, com checklist de conclusão.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <MonthCalendar year={year} month={month} countsByDay={countsByDay} selectedDate={selectedDate} />

        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold capitalize text-ink-50">{selectedDateLabel}</p>
            <TaskForm profiles={profiles ?? []} defaultDueDate={selectedDate} />
          </div>

          <div className="mt-3 space-y-2">
            {(selectedTasks ?? []).map((task) => (
              <div
                key={task.id}
                className={`card-premium flex items-start gap-3 rounded-lg p-4 ${
                  task.completed ? "opacity-60" : ""
                }`}
              >
                <div className="pt-0.5">
                  <TaskCheckbox taskId={task.id} completed={task.completed} />
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-medium text-ink-50 ${task.completed ? "line-through" : ""}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="mt-0.5 text-xs text-ink-500">{task.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={PRIORITY_CLASS[task.priority]}>
                      {PRIORITY_LABEL[task.priority]}
                    </span>
                    {task.profiles && (
                      <span className="text-ink-500">
                        · {task.profiles.full_name}
                      </span>
                    )}
                    {task.recurrence !== "none" && (
                      <span className="text-ink-500">· recorrente</span>
                    )}
                  </div>
                </div>
                <TaskForm
                  task={task}
                  profiles={profiles ?? []}
                  trigger={
                    <span className="rounded-md bg-white/[0.06] px-3 py-1 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]">
                      Editar
                    </span>
                  }
                />
              </div>
            ))}
            {(selectedTasks ?? []).length === 0 && (
              <p className="card-premium rounded-lg p-6 text-center text-sm text-ink-500">
                Nenhuma tarefa nesta data.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
