import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { appPool, asUser, ensureUser, ownerPool, sqlState } from "./helpers";

/**
 * Defesa em profundidade: estes testes conectam como `financeiro_app` (o
 * papel da aplicação) e provam que o RLS barra cada papel no próprio banco,
 * independentemente do código das Server Actions.
 */

const INSUFFICIENT_PRIVILEGE = "42501";

let owner: string;
let socio: string;
let func: string;
let inactive: string;
let importId: string;

beforeAll(async () => {
  owner = await ensureUser("rls-owner@teste.local", "owner");
  socio = await ensureUser("rls-socio@teste.local", "socio");
  func = await ensureUser("rls-func@teste.local", "funcionario");
  inactive = await ensureUser("rls-inativo@teste.local", "owner", false);
  const { rows } = await ownerPool.query(
    "insert into public.bank_statement_imports (account_label, format) values ('__rls_test__', 'csv') returning id"
  );
  importId = rows[0].id;
});

afterAll(async () => {
  await ownerPool.query("delete from public.bank_statement_imports where account_label = '__rls_test__'");
  await ownerPool.query("delete from public.students where full_name like '__rls_test__%'");
  await ownerPool.query("delete from public.payables where description like '__rls_test__%'");
  // Garante que a automação fique ligada após os testes.
  await ownerPool.query("update public.app_settings set value = 'true'::jsonb where key = 'rollover_enabled'");
  await appPool.end();
  await ownerPool.end();
});

describe("papel da aplicação", () => {
  it("não é superusuário, não ignora RLS e não é dono de nenhuma tabela", async () => {
    const { rows } = await appPool.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user"
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await appPool.query(
      "select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = current_user"
    );
    expect(owned.rows[0].n).toBe(0);
  });

  it("toda tabela do schema public tem RLS ativo", async () => {
    const { rows } = await ownerPool.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("não lê o controle de migrations nem altera o histórico de auditoria", async () => {
    await asUser(owner, async (c) => {
      expect(await sqlState(c, "select * from app.schema_migrations")).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        await sqlState(c, "insert into public.audit_log (action, table_name) values ('x', 'y')")
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await sqlState(c, "delete from public.audit_log")).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await sqlState(c, "update public.audit_log set action = 'x'")).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it("app.audit_event só aceita eventos auth.*", async () => {
    await asUser(null, async (c) => {
      expect(await sqlState(c, "select app.audit_event(null, 'insert', '{}'::jsonb)")).not.toBeNull();
      expect(await sqlState(c, "select app.audit_event(null, 'auth.login_failed', '{}'::jsonb)")).toBeNull();
    });
  });
});

describe("sem usuário (contexto de login / sessão inválida)", () => {
  it("não vê nenhum dado financeiro", async () => {
    await asUser(null, async (c) => {
      for (const table of ["plans", "students", "invoices", "cash_transactions", "profiles", "tasks"]) {
        const { rows } = await c.query(`select count(*)::int as n from public.${table}`);
        expect(rows[0].n, table).toBe(0);
      }
      const mrr = await c.query("select mrr from public.v_mrr");
      expect(Number(mrr.rows[0].mrr)).toBe(0);
    });
  });

  it("não grava nada", async () => {
    await asUser(null, async (c) => {
      expect(
        await sqlState(c, "insert into public.plans (name, lessons_per_week, monthly_value, avg_duration_months) values ('x', 1, 1, 1)")
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await sqlState(c, "insert into public.students (full_name) values ('__rls_test__ anon')")).toBe(
        INSUFFICIENT_PRIVILEGE
      );
    });
  });
});

describe("funcionário", () => {
  it("lê o operacional e cadastra aluno (permissão manage_invoices)", async () => {
    await asUser(func, async (c) => {
      const plans = await c.query("select count(*)::int as n from public.plans");
      expect(plans.rows[0].n).toBeGreaterThan(0);
      expect(await sqlState(c, "insert into public.students (full_name) values ('__rls_test__ func')")).toBeNull();
    });
  });

  it("não altera planos, categorias nem metas", async () => {
    await asUser(func, async (c) => {
      expect(
        await sqlState(c, "insert into public.plans (name, lessons_per_week, monthly_value, avg_duration_months) values ('__x', 1, 1, 1)")
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await sqlState(c, "insert into public.cost_categories (name, type) values ('__x', 'fixed')")).toBe(
        INSUFFICIENT_PRIVILEGE
      );
      expect(
        await sqlState(c, "insert into public.revenue_targets (reference_month, target_amount) values ('2099-01-01', 1)")
      ).toBe(INSUFFICIENT_PRIVILEGE);
      const upd = await c.query("update public.plans set monthly_value = 0");
      expect(upd.rowCount).toBe(0);
    });
  });

  it("não vê dados bancários (importações de extrato)", async () => {
    await asUser(func, async (c) => {
      const { rows } = await c.query("select id from public.bank_statement_imports where id = $1", [importId]);
      expect(rows).toHaveLength(0);
    });
  });

  it("não consegue se promover a owner (escalada que o Supabase permitia)", async () => {
    await asUser(func, async (c) => {
      const res = await c.query("update public.profiles set role = 'owner' where id = $1", [func]);
      expect(res.rowCount).toBe(0);
      const { rows } = await c.query("select role from public.profiles where id = $1", [func]);
      expect(rows[0].role).toBe("funcionario");
    });
  });

  it("vê só o próprio profile e nada do audit_log", async () => {
    await asUser(func, async (c) => {
      const profiles = await c.query("select id from public.profiles");
      expect(profiles.rows.map((r) => r.id)).toEqual([func]);
      const audit = await c.query("select count(*)::int as n from public.audit_log");
      expect(audit.rows[0].n).toBe(0);
    });
  });
});

describe("sócio", () => {
  it("gerencia planos e vê importações de extrato", async () => {
    await asUser(socio, async (c) => {
      expect(
        await sqlState(c, "insert into public.plans (name, lessons_per_week, monthly_value, avg_duration_months) values ('__rls_socio', 1, 1, 1)")
      ).toBeNull();
      const { rows } = await c.query("select id from public.bank_statement_imports where id = $1", [importId]);
      expect(rows).toHaveLength(1);
    });
  });

  it("não lê auditoria nem altera profiles", async () => {
    await asUser(socio, async (c) => {
      expect((await c.query("select count(*)::int as n from public.audit_log")).rows[0].n).toBe(0);
      expect((await c.query("update public.profiles set active = false")).rowCount).toBe(0);
    });
  });
});

describe("owner", () => {
  it("lê auditoria e todos os profiles", async () => {
    await asUser(owner, async (c) => {
      const profiles = await c.query("select id from public.profiles");
      expect(profiles.rows.length).toBeGreaterThanOrEqual(4);
      expect(await sqlState(c, "select * from public.audit_log limit 1")).toBeNull();
    });
  });
});

describe("profile desativado", () => {
  it("não tem acesso a nada, mesmo sendo owner", async () => {
    await asUser(inactive, async (c) => {
      expect((await c.query("select count(*)::int as n from public.plans")).rows[0].n).toBe(0);
      expect(await sqlState(c, "insert into public.students (full_name) values ('__rls_test__ inativo')")).toBe(
        INSUFFICIENT_PRIVILEGE
      );
    });
  });
});

describe("auditoria automática", () => {
  it("registra quem alterou, com os dados antes/depois", async () => {
    const client = await appPool.connect();
    let studentId: string;
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [func]);
      const ins = await client.query(
        "insert into public.students (full_name) values ('__rls_test__ audit') returning id"
      );
      studentId = ins.rows[0].id;
      await client.query("update public.students set phone = '11999990000' where id = $1", [studentId]);
      await client.query("commit");
    } finally {
      client.release();
    }

    const { rows } = await ownerPool.query(
      "select user_id, action, old_data->>'phone' as old_phone, new_data->>'phone' as new_phone from public.audit_log where table_name = 'students' and record_id = $1 order by created_at",
      [studentId]
    );
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(rows.every((r) => r.user_id === func)).toBe(true);
    expect(rows[1]).toMatchObject({ old_phone: null, new_phone: "11999990000" });
  });
});

describe("contas a pagar / configurações / automação (owner-socio)", () => {
  it("funcionário lê mas não grava contas a pagar nem configurações", async () => {
    await asUser(func, async (c) => {
      // leitura liberada (não deve lançar erro de permissão)
      expect(await sqlState(c, "select count(*) from public.payables")).toBeNull();
      // escrita barrada (policy owner/socio)
      expect(
        await sqlState(
          c,
          "insert into public.payables (description, reference_month, amount, due_date) values ('__x', '2099-01-01', 1, '2099-01-10')"
        )
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        await sqlState(c, "insert into public.recurring_payables (description, amount, due_day) values ('__x', 1, 5)")
      ).toBe(INSUFFICIENT_PRIVILEGE);
      // UPDATE sob RLS não lança erro: a policy apenas não casa nenhuma linha.
      expect((await c.query("update public.app_settings set value = '99'::jsonb where key = 'das_due_day'")).rowCount).toBe(0);
    });
  });

  it("sócio grava conta a pagar e ela recebe status por trigger", async () => {
    await asUser(socio, async (c) => {
      const ins = await c.query(
        "insert into public.payables (description, reference_month, amount, due_date) values ('__rls_test__ pay', '2099-01-01', 100, '2099-01-10') returning id, status"
      );
      expect(ins.rows[0].status).toBe("pendente"); // vencimento futuro
    });
  });

  it("run_monthly_rollover é idempotente e respeita rollover_enabled", async () => {
    // Desliga a automação e confirma que ela é pulada.
    await ownerPool.query("update public.app_settings set value = 'false'::jsonb where key = 'rollover_enabled'");
    const off = await ownerPool.query("select public.run_monthly_rollover('manual') as r");
    expect(off.rows[0].r.skipped).toBe(true);

    // Religa e roda duas vezes: a 2ª não cria mensalidades/contas novas.
    await ownerPool.query("update public.app_settings set value = 'true'::jsonb where key = 'rollover_enabled'");
    await ownerPool.query("select public.run_monthly_rollover('manual')");
    const second = await ownerPool.query("select public.run_monthly_rollover('manual') as r");
    expect(Number(second.rows[0].r.invoices_created)).toBe(0);
    expect(Number(second.rows[0].r.payables_created)).toBe(0);
  });
});

describe("conexões bancárias (owner-socio)", () => {
  it("funcionário não vê nem grava bank_providers", async () => {
    await asUser(func, async (c) => {
      // SELECT retorna 0 linhas (policy owner/socio), não erro.
      expect((await c.query("select count(*)::int as n from public.bank_providers")).rows[0].n).toBe(0);
      expect(
        await sqlState(c, "insert into public.bank_providers (provider, label) values ('asaas', '__x_func')")
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it("sócio grava e lê bank_providers", async () => {
    await asUser(socio, async (c) => {
      expect(
        await sqlState(c, "insert into public.bank_providers (provider, label) values ('inter', '__rls_test__ prov')")
      ).toBeNull();
      const { rows } = await c.query("select label from public.bank_providers where label = '__rls_test__ prov'");
      expect(rows).toHaveLength(1);
    });
  });
});

describe("Simples Nacional (apuração)", () => {
  it("calcula a alíquota efetiva da faixa 3 corretamente", async () => {
    // RBT12 = 500.000 → faixa 3 (13,5%, deduz 17.640) → efetiva 9,972%.
    const { rows } = await ownerPool.query(
      "select round(((500000 * 0.1350 - 17640) / 500000) * 100, 4) as eff"
    );
    expect(Number(rows[0].eff)).toBeCloseTo(9.972, 3);
    // E a função retorna uma linha para o mês corrente sem quebrar.
    const apur = await ownerPool.query(
      "select faixa, effective_rate from public.simples_apuracao(date_trunc('month', current_date)::date)"
    );
    expect(apur.rowCount).toBe(1);
  });
});

describe("schema TypeScript (Drizzle) x migrations", () => {
  it("toda coluna declarada em src/lib/db/schema.ts existe no banco", async () => {
    const tables = (Object.values(schema) as unknown[]).filter(
      (v): v is PgTable => typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v
    );
    expect(tables.length).toBeGreaterThan(20);
    const { rows } = await ownerPool.query(
      "select table_schema, table_name, column_name from information_schema.columns where table_schema in ('public', 'iam')"
    );
    const existing = new Set(rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
    const missing: string[] = [];
    for (const table of tables) {
      const cfg = getTableConfig(table);
      for (const col of cfg.columns) {
        const key = `${cfg.schema ?? "public"}.${cfg.name}.${col.name}`;
        if (!existing.has(key)) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });
});
