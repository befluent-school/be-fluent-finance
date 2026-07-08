"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

const LoginSchema = z.object({
  email: z.email({ error: "Informe um e-mail válido." }),
  password: z.string().min(6, { error: "A senha deve ter ao menos 6 caracteres." }),
});

export type LoginState =
  | { errors?: { email?: string[]; password?: string[] }; message?: string }
  | undefined;

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const validatedFields = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(validatedFields.data);

  if (error) {
    return { message: "E-mail ou senha incorretos." };
  }

  // O proxy.ts decide para onde redirecionar (onboarding 2FA, desafio 2FA ou dashboard).
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
