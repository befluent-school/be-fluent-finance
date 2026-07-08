import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { TopbarClient } from "@/components/topbar-client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar role={profile?.role ?? "funcionario"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopbarClient userName={profile?.full_name ?? "Be Fluent"} />
        <main className="relative z-10 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
