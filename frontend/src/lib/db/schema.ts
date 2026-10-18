import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Espelho TypeScript das tabelas criadas por ../db/migrations (a fonte da
 * verdade do schema são as migrations SQL; este arquivo só tipa as
 * consultas). O teste tests/schema-parity.test.ts compara os dois.
 */

const money = (name: string) => numeric(name, { precision: 10, scale: 2, mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const day = (name: string) => date(name, { mode: "string" });

// ── iam (autenticação) ─────────────────────────────────────────────────────
export const iam = pgSchema("iam");

export const users = iam.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  passwordChangedAt: ts("password_changed_at"),
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabledAt: ts("totp_enabled_at"),
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  enrollPreverifiedUntil: ts("enroll_preverified_until"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sessions = iam.table("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  mfaVerifiedAt: ts("mfa_verified_at"),
  mfaFailedAttempts: integer("mfa_failed_attempts").notNull().default(0),
  enrollCodeHash: text("enroll_code_hash"),
  enrollCodeExpiresAt: ts("enroll_code_expires_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  absoluteExpiresAt: ts("absolute_expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export const passwordResetTokens = iam.table("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  requestedIp: text("requested_ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const authAttempts = iam.table("auth_attempts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  kind: text("kind").notNull().$type<"login" | "mfa" | "password_reset">(),
  identifier: text("identifier").notNull(),
  ipAddress: text("ip_address"),
  success: boolean("success").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const mfaBackupCodes = iam.table("mfa_backup_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ── public (dados, todos com RLS) ──────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().$type<"owner" | "socio" | "funcionario">(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: text("role").notNull(),
    permissionId: uuid("permission_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.role, t.permissionId] })]
);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  tableName: text("table_name").notNull(),
  recordId: text("record_id"),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  lessonsPerWeek: integer("lessons_per_week").notNull(),
  monthlyValue: money("monthly_value").notNull(),
  avgDurationMonths: integer("avg_duration_months").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const teachers = pgTable("teachers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  paymentType: text("payment_type")
    .notNull()
    .default("outro")
    .$type<"por_hora" | "comissao" | "repasse_integral" | "fixo" | "outro">(),
  paymentRuleText: text("payment_rule_text"),
  paymentReferenceValue: money("payment_reference_value"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const teacherPayments = pgTable("teacher_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  teacherId: uuid("teacher_id").notNull(),
  referenceMonth: day("reference_month").notNull(),
  lessonsGiven: integer("lessons_given").notNull().default(0),
  suggestedAmount: numeric("suggested_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  finalAmount: numeric("final_amount", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("aberto").$type<"aberto" | "confirmado">(),
  payableId: uuid("payable_id"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const students = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  payerName: text("payer_name"),
  cpf: text("cpf"),
  phone: text("phone"),
  email: text("email"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const enrollments = pgTable("enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull(),
  planId: uuid("plan_id").notNull(),
  teacherId: uuid("teacher_id"),
  monthlyValue: money("monthly_value").notNull(),
  dueDay: integer("due_day").notNull(),
  classType: text("class_type").notNull().default("individual"),
  startDate: day("start_date").notNull().defaultNow(),
  endDate: day("end_date"),
  status: text("status").notNull().default("active").$type<"active" | "paused" | "cancelled">(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  enrollmentId: uuid("enrollment_id").notNull(),
  referenceMonth: day("reference_month").notNull(),
  amount: money("amount").notNull(),
  dueDate: day("due_date").notNull(),
  paidDate: day("paid_date"),
  paymentMethod: text("payment_method"),
  status: text("status").notNull().default("pendente"),
  receiptSent: boolean("receipt_sent").notNull().default(false),
  notes: text("notes"),
  lateFeeAmount: money("late_fee_amount").notNull().default(0),
  interestAmount: money("interest_amount").notNull().default(0),
  totalPaid: money("total_paid"),
  /** Lançamento do extrato que baixou esta mensalidade (migração 0039). */
  cashTransactionId: uuid("cash_transaction_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const categorizationRules = pgTable("categorization_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  pattern: text("pattern").notNull(),
  type: text("type").notNull().$type<"entrada" | "saida">(),
  categoryId: uuid("category_id").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const costCategories = pgTable("cost_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull().$type<"fixed" | "variable">(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cashTransactions = pgTable("cash_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: day("date").notNull(),
  description: text("description").notNull(),
  categoryId: uuid("category_id"),
  amount: money("amount").notNull(),
  type: text("type").notNull().$type<"entrada" | "saida">(),
  paymentMethod: text("payment_method"),
  invoiceId: uuid("invoice_id"),
  source: text("source").notNull().default("manual"),
  notes: text("notes"),
  dedupeKey: text("dedupe_key"),
  bankProviderId: uuid("bank_provider_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const revenueTargets = pgTable("revenue_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceMonth: day("reference_month").notNull(),
  targetAmount: money("target_amount").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const studentTargets = pgTable("student_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceMonth: day("reference_month").notNull(),
  planId: uuid("plan_id"),
  targetCount: integer("target_count").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const cacTargets = pgTable("cac_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceMonth: day("reference_month").notNull(),
  maxCac: money("max_cac").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const ltvCacTargets = pgTable("ltv_cac_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceMonth: day("reference_month").notNull(),
  minRatio: numeric("min_ratio", { precision: 6, scale: 2, mode: "number" }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const bankConnections = pgTable("bank_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  pluggyItemId: text("pluggy_item_id").notNull(),
  institutionName: text("institution_name").notNull(),
  status: text("status").notNull().default("pending"),
  lastSyncedAt: ts("last_synced_at"),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const bankTransactionsStaging = pgTable("bank_transactions_staging", {
  id: uuid("id").primaryKey().defaultRandom(),
  bankConnectionId: uuid("bank_connection_id"),
  pluggyTransactionId: text("pluggy_transaction_id"),
  date: day("date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  pluggyType: text("pluggy_type").notNull(),
  reconciledCashTransactionId: uuid("reconciled_cash_transaction_id"),
  ignored: boolean("ignored").notNull().default(false),
  importId: uuid("import_id"),
  importDedupeKey: text("import_dedupe_key"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reconciliationRules = pgTable("reconciliation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  keywordPattern: text("keyword_pattern").notNull(),
  categoryId: uuid("category_id"),
  autoApply: boolean("auto_apply").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountLabel: text("account_label").notNull(),
  format: text("format").notNull(),
  filename: text("filename"),
  importedAt: ts("imported_at").notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const recurringPayables = pgTable("recurring_payables", {
  id: uuid("id").primaryKey().defaultRandom(),
  description: text("description").notNull(),
  categoryId: uuid("category_id"),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  dueDay: integer("due_day").notNull(),
  active: boolean("active").notNull().default(true),
  startMonth: day("start_month").notNull(),
  endMonth: day("end_month"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const payables = pgTable("payables", {
  id: uuid("id").primaryKey().defaultRandom(),
  description: text("description").notNull(),
  categoryId: uuid("category_id"),
  referenceMonth: day("reference_month").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  dueDate: day("due_date").notNull(),
  paidDate: day("paid_date"),
  paymentMethod: text("payment_method"),
  status: text("status").notNull().default("pendente"),
  origin: text("origin").notNull().default("manual").$type<"manual" | "recurring" | "das" | "teacher">(),
  recurringTemplateId: uuid("recurring_template_id"),
  cashTransactionId: uuid("cash_transaction_id"),
  totalPaid: numeric("total_paid", { precision: 12, scale: 2, mode: "number" }),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const bankProviders = pgTable("bank_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().$type<"asaas" | "inter" | "generic_api" | "manual">(),
  label: text("label").notNull(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>().default({}),
  credentialsEnc: text("credentials_enc"),
  active: boolean("active").notNull().default(true),
  syncWindowDays: integer("sync_window_days").notNull().default(35),
  lastSyncedAt: ts("last_synced_at"),
  lastSyncedThrough: day("last_synced_through"),
  lastStatus: text("last_status").notNull().default("novo").$type<"novo" | "ok" | "erro">(),
  lastError: text("last_error"),
  lastImportedCount: integer("last_imported_count").notNull().default(0),
  openingBalance: numeric("opening_balance", { precision: 12, scale: 2, mode: "number" }),
  openingBalanceDate: day("opening_balance_date"),
  bankBalance: numeric("bank_balance", { precision: 12, scale: 2, mode: "number" }),
  bankBalanceAt: ts("bank_balance_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const jobRuns = pgTable("job_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  job: text("job").notNull(),
  referenceMonth: day("reference_month"),
  trigger: text("trigger").notNull().default("manual").$type<"manual" | "scheduled" | "startup">(),
  status: text("status").notNull().default("running").$type<"running" | "success" | "error">(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: day("due_date").notNull(),
  priority: text("priority").notNull().default("media").$type<"alta" | "media" | "baixa">(),
  assigneeId: uuid("assignee_id"),
  recurrence: text("recurrence").notNull().default("none").$type<"none" | "daily" | "weekly" | "monthly">(),
  completed: boolean("completed").notNull().default(false),
  completedAt: ts("completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ── relações (para consultas aninhadas, equivalentes ao "embed" do PostgREST) ──
export const studentsRelations = relations(students, ({ many }) => ({
  enrollments: many(enrollments),
}));

export const enrollmentsRelations = relations(enrollments, ({ one, many }) => ({
  student: one(students, { fields: [enrollments.studentId], references: [students.id] }),
  plan: one(plans, { fields: [enrollments.planId], references: [plans.id] }),
  teacher: one(teachers, { fields: [enrollments.teacherId], references: [teachers.id] }),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  enrollment: one(enrollments, { fields: [invoices.enrollmentId], references: [enrollments.id] }),
}));

export const cashTransactionsRelations = relations(cashTransactions, ({ one }) => ({
  category: one(costCategories, { fields: [cashTransactions.categoryId], references: [costCategories.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  assignee: one(profiles, { fields: [tasks.assigneeId], references: [profiles.id] }),
}));

export const payablesRelations = relations(payables, ({ one }) => ({
  category: one(costCategories, { fields: [payables.categoryId], references: [costCategories.id] }),
  recurringTemplate: one(recurringPayables, {
    fields: [payables.recurringTemplateId],
    references: [recurringPayables.id],
  }),
}));

export const teachersRelations = relations(teachers, ({ many }) => ({
  payments: many(teacherPayments),
}));

export const teacherPaymentsRelations = relations(teacherPayments, ({ one }) => ({
  teacher: one(teachers, { fields: [teacherPayments.teacherId], references: [teachers.id] }),
  payable: one(payables, { fields: [teacherPayments.payableId], references: [payables.id] }),
}));

export const recurringPayablesRelations = relations(recurringPayables, ({ one, many }) => ({
  category: one(costCategories, { fields: [recurringPayables.categoryId], references: [costCategories.id] }),
  payables: many(payables),
}));
