"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

const TeacherSchema = z.object({
  fullName: z.string().min(2, { error: "Informe o nome do professor." }),
  paymentRuleText: z.string().nullable().optional(),
  paymentReferenceValue: z.coerce.number().min(0).nullable().optional(),
});

export type CreateTeacherResult =
  | { success: true; teacher: { id: string; full_name: string } }
  | { success: false; error: string };

export async function createTeacher(formData: FormData): Promise<CreateTeacherResult> {
  const validated = TeacherSchema.safeParse({
    fullName: formData.get("fullName"),
    paymentRuleText: formData.get("paymentRuleText"),
    paymentReferenceValue: formData.get("paymentReferenceValue"),
  });

  if (!validated.success) {
    return { success: false, error: "Informe o nome do professor." };
  }

  const supabase = await createClient();
  const { data: teacher, error } = await supabase
    .from("teachers")
    .insert({
      full_name: validated.data.fullName,
      payment_rule_text: validated.data.paymentRuleText || null,
      payment_reference_value: validated.data.paymentReferenceValue || null,
    })
    .select("id, full_name")
    .single();

  if (error || !teacher) {
    return { success: false, error: "Erro ao cadastrar professor. Verifique se o nome já existe." };
  }

  revalidatePath("/alunos");
  return { success: true, teacher };
}
