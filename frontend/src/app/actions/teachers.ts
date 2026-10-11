"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { withUser } from "@/lib/db";
import { teachers } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";

const TeacherSchema = z.object({
  fullName: z.string().trim().min(2, { error: "Informe o nome do professor." }).max(150),
  paymentRuleText: z.string().max(500).nullable().optional(),
  paymentReferenceValue: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
});

export type CreateTeacherResult =
  | { success: true; teacher: { id: string; full_name: string } }
  | { success: false; error: string };

export async function createTeacher(formData: FormData): Promise<CreateTeacherResult> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { success: false, error: FORBIDDEN_MESSAGE };

  const validated = TeacherSchema.safeParse({
    fullName: formData.get("fullName"),
    paymentRuleText: formData.get("paymentRuleText"),
    paymentReferenceValue: formData.get("paymentReferenceValue"),
  });

  if (!validated.success) {
    return { success: false, error: "Informe o nome do professor." };
  }

  try {
    const [teacher] = await withUser(user.id, (tx) =>
      tx
        .insert(teachers)
        .values({
          fullName: validated.data.fullName,
          paymentRuleText: validated.data.paymentRuleText || null,
          paymentReferenceValue: validated.data.paymentReferenceValue || null,
        })
        .returning({ id: teachers.id, full_name: teachers.fullName })
    );
    revalidatePath("/alunos");
    return { success: true, teacher };
  } catch (err) {
    logDbError("createTeacher", err);
    return { success: false, error: "Erro ao cadastrar professor. Verifique se o nome já existe." };
  }
}
