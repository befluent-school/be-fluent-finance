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

export async function signInWithGoogle() {
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appUrl}/auth/callback`,
    },
  });

  if (error || !data.url) {
    redirect("/login?error=google");
  }

  redirect(data.url);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const UpdatePasswordSchema = z
  .object({
    password: z.string().min(6, { error: "A senha deve ter ao menos 6 caracteres." }),
    confirmPassword: z.string().min(6, { error: "Confirme a nova senha." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type UpdatePasswordState =
  | { errors?: { password?: string[]; confirmPassword?: string[] }; message?: string; success?: boolean }
  | undefined;

export async function updatePassword(
  _state: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const validatedFields = UpdatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: validatedFields.data.password });

  if (error) {
    return { message: "Não foi possível alterar a senha. Tente novamente." };
  }

  return { success: true, message: "Senha alterada com sucesso." };
}
