/** Layout guard for `/preparaciones/**` (M11, FASE 8). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function PreparacionesLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "preparaciones.iniciar")) {
    redirect("/");
  }

  return <>{children}</>;
}
