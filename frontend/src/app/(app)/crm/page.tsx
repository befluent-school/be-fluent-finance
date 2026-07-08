import { createClient } from "@/lib/supabase/server";
import { createBeelyClient, type BeelyContact, type BeelyDeal, type BeelyStage } from "@/lib/beely-supabase";
import { formatCurrencyBRL } from "@shared/finance";
import type { Plan, Teacher } from "@shared/types";
import { initials } from "@/lib/utils";
import { EnrollStudentForm } from "../alunos/enroll-student-form";

export default async function CrmPage() {
  const beely = createBeelyClient();
  const supabase = await createClient();

  const [{ data: contacts }, { data: deals }, { data: stages }, { data: plans }, { data: teachers }, { data: students }] =
    await Promise.all([
      beely.from("contacts").select("id, name, email, phone, source, score").returns<BeelyContact[]>(),
      beely
        .from("deals")
        .select("id, title, value, status, stage_id, contact, contact_id, owner, created_at")
        .order("created_at", { ascending: false })
        .returns<BeelyDeal[]>(),
      beely.from("stages").select("id, name, position").order("position").returns<BeelyStage[]>(),
      supabase.from("plans").select("*").eq("active", true).returns<Plan[]>(),
      supabase.from("teachers").select("*").eq("active", true).returns<Teacher[]>(),
      supabase.from("students").select("email, phone"),
    ]);

  const contactsByName = new Map((contacts ?? []).map((c) => [c.name, c]));
  const stageById = new Map((stages ?? []).map((s) => [s.id, s.name]));
  const existingEmails = new Set((students ?? []).map((s) => s.email).filter(Boolean));
  const existingPhones = new Set((students ?? []).map((s) => s.phone).filter(Boolean));

  const allDeals = deals ?? [];
  const total = allDeals.length;
  const won = allDeals.filter((d) => d.status === "won").length;
  const lost = allDeals.filter((d) => d.status === "lost").length;
  const open = total - won - lost;
  const conversionRate = total > 0 ? (won / total) * 100 : 0;

  const now = new Date();
  const newThisMonth = allDeals.filter((d) => {
    const created = new Date(d.created_at);
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;

  const dealsByStage = new Map<string, BeelyDeal[]>();
  for (const deal of allDeals.filter((d) => d.status === "open")) {
    const stageName = stageById.get(deal.stage_id ?? "") ?? "Sem estágio";
    dealsByStage.set(stageName, [...(dealsByStage.get(stageName) ?? []), deal]);
  }

  const wonDeals = allDeals.filter((d) => d.status === "won");

  return (
    <div>
      <p className="text-sm text-ink-300">
        Pipeline de leads do Beely CRM — converta negócios ganhos em alunos matriculados.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card-premium rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-ink-300">Leads novos (mês)</p>
          <p className="font-display gradient-text mt-1 text-2xl font-bold">{newThisMonth}</p>
        </div>
        <div className="card-premium rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-ink-300">Em aberto</p>
          <p className="font-display mt-1 text-2xl font-bold text-ink-50">{open}</p>
        </div>
        <div className="card-premium rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-ink-300">Taxa de conversão</p>
          <p className="font-display mt-1 text-2xl font-bold text-status-paid">
            {conversionRate.toFixed(0)}%
          </p>
        </div>
        <div className="card-premium rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-ink-300">Perdidos</p>
          <p className="font-display mt-1 text-2xl font-bold text-status-overdue">{lost}</p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Negócios ganhos — converter em aluno</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Contato</th>
              <th className="px-4 py-3 font-medium">Negócio</th>
              <th className="px-4 py-3 font-medium">Valor</th>
              <th className="px-4 py-3 font-medium">Responsável</th>
              <th className="px-4 py-3 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {wonDeals.map((deal) => {
              const contact = deal.contact ? contactsByName.get(deal.contact) : undefined;
              const alreadyStudent =
                (contact?.email && existingEmails.has(contact.email)) ||
                (contact?.phone && existingPhones.has(contact.phone));

              return (
                <tr key={deal.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-400">
                        {initials(deal.contact ?? deal.title)}
                      </span>
                      <div>
                        <p className="font-medium text-ink-50">{deal.contact ?? deal.title}</p>
                        <p className="text-xs text-ink-500">{contact?.email ?? "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-300">{deal.title}</td>
                  <td className="font-tabular px-4 py-3">
                    {formatCurrencyBRL(Number(deal.value ?? 0))}
                  </td>
                  <td className="px-4 py-3 text-ink-300">{deal.owner ?? "—"}</td>
                  <td className="px-4 py-3">
                    {alreadyStudent ? (
                      <span className="text-xs text-ink-500">Já é aluno</span>
                    ) : (
                      <EnrollStudentForm
                        plans={plans ?? []}
                        teachers={teachers ?? []}
                        defaultValues={{
                          fullName: deal.contact ?? deal.title,
                          email: contact?.email ?? undefined,
                          phone: contact?.phone ?? undefined,
                        }}
                        trigger={
                          <span className="rounded-md bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25">
                            Converter em aluno
                          </span>
                        }
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {wonDeals.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-500">
                  Nenhum negócio ganho ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Pipeline em aberto</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from(dealsByStage.entries()).map(([stageName, stageDeals]) => (
          <div key={stageName} className="card-premium rounded-lg p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-50">{stageName}</p>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-ink-300">
                {stageDeals.length}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {stageDeals.slice(0, 5).map((deal) => (
                <li key={deal.id} className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-xs">
                  <p className="font-medium text-ink-100">{deal.contact ?? deal.title}</p>
                  <p className="mt-0.5 text-ink-500">{formatCurrencyBRL(Number(deal.value ?? 0))}</p>
                </li>
              ))}
              {stageDeals.length > 5 && (
                <li className="text-center text-xs text-ink-500">
                  +{stageDeals.length - 5} outro(s)
                </li>
              )}
            </ul>
          </div>
        ))}
        {dealsByStage.size === 0 && (
          <p className="text-sm text-ink-500">Nenhum negócio em aberto no momento.</p>
        )}
      </div>
    </div>
  );
}
