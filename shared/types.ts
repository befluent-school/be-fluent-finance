export type UserRole = "owner" | "socio" | "funcionario";

export type InvoiceStatus = "pago" | "atrasado" | "pendente";
export type PaymentMethod = "pix" | "cartao" | "boleto" | "transferencia";
export type EnrollmentStatus = "active" | "paused" | "cancelled";

export type Plan = {
  id: string;
  name: string;
  lessons_per_week: number;
  monthly_value: number;
  avg_duration_months: number;
  active: boolean;
};

export type Teacher = {
  id: string;
  full_name: string;
  payment_rule_text: string | null;
  payment_reference_value: number | null;
  active: boolean;
};

export type Student = {
  id: string;
  full_name: string;
  payer_name: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

export type Enrollment = {
  id: string;
  student_id: string;
  plan_id: string;
  teacher_id: string | null;
  monthly_value: number;
  due_day: number;
  class_type: "individual";
  start_date: string;
  end_date: string | null;
  status: EnrollmentStatus;
};

export type Invoice = {
  id: string;
  enrollment_id: string;
  reference_month: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  payment_method: PaymentMethod | null;
  status: InvoiceStatus;
  receipt_sent: boolean;
  notes: string | null;
};
