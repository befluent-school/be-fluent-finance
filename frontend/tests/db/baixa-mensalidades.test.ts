import { describe, expect, it } from "vitest";
import { asUser, ensureUser } from "./helpers";

describe("baixa automática de mensalidades pelo ASAAS", () => {
  it("baixa pelo nome sem acento e valor, infere a forma e não reutiliza o lançamento", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    await asUser(owner, async (c) => {
      const one = async (q: string, p: unknown[] = []) => (await c.query(q, p)).rows[0];
      const plan = await one(`insert into public.plans (name, lessons_per_week, monthly_value, avg_duration_months) values ('__plano_baixa__', 2, 480, 6) returning id`);
      const aluno = await one(`insert into public.students (full_name) values ('Vânessa  da Silva Chagas') returning id`);
      const matricula = await one(
        `insert into public.enrollments (student_id, plan_id, monthly_value, due_day, start_date)
         values ($1, $2, 480, 10, '2003-01-01') returning id`,
        [aluno.id, plan.id]
      );
      const inv = (mes: string) =>
        one(
          `insert into public.invoices (enrollment_id, reference_month, amount, due_date)
           values ($1, $2, 480, ($2::date + 9)) returning id`,
          [matricula.id, mes]
        );
      const set = await inv("2003-09-01");
      const out = await inv("2003-10-01");
      const ct = (desc: string, amount: number, type = "entrada") =>
        c.query(
          `insert into public.cash_transactions (date, description, amount, type, source, dedupe_key)
           values ('2003-10-15', $1, $2, $3, 'asaas', gen_random_uuid()::text)`,
          [desc, amount, type]
        );
      await ct("Cobrança recebida - fatura nr. 903374283 Vanessa da Silva Chagas. Nota fiscal nr. 243 (ASAAS)", 480);
      await ct("Taxa do Pix - fatura nr. 903374283 Vanessa da Silva Chagas (ASAAS)", 1.99, "saida");
      await ct("Cobrança recebida - fatura nr. 1 Fulano Inexistente (ASAAS)", 480);

      expect((await one(`select public.baixar_mensalidades_por_extrato() as n`)).n).toBe(1);
      const pago = await one(`select paid_date::text, payment_method from public.invoices where id = $1`, [set.id]);
      expect(pago).toEqual({ paid_date: "2003-10-15", payment_method: "pix" });
      expect((await one(`select paid_date from public.invoices where id = $1`, [out.id])).paid_date).toBeNull();

      expect((await one(`select public.baixar_mensalidades_por_extrato() as n`)).n).toBe(0);
    });
  });
});
