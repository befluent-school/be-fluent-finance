import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ImportStatementDialog } from "./import-statement-dialog";

export default async function ConciliacaoPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role === "funcionario") {
    redirect("/dashboard");
  }

  const { data: categories } = await supabase
    .from("cost_categories")
    .select("id, name")
    .eq("active", true)
    .order("name");

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-300">
          Importe o extrato do seu banco (CSV, Excel ou OFX) — revise as categorias e as
          transações já entram direto no fluxo de caixa.
        </p>
        <ImportStatementDialog categories={categories ?? []} />
      </div>

      <div className="mt-4 flex gap-4 border-b border-ink-700 text-sm">
        <span className="border-b-2 border-amber-500 px-1 pb-2 font-semibold text-ink-50">
          Importar
        </span>
        <Link
          href="/banco/extrato"
          className="border-b-2 border-transparent px-1 pb-2 text-ink-300 hover:text-ink-50"
        >
          Extrato completo
        </Link>
      </div>

      <div className="mt-8 card-premium rounded-lg p-8 text-center text-sm text-ink-500">
        Use o botão &quot;+ Importar extrato&quot; acima para lançar transações a partir de um
        arquivo do seu banco. O histórico completo fica em &quot;Extrato completo&quot;.
      </div>
    </div>
  );
}
