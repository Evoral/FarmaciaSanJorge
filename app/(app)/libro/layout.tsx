/** Layout guard for `/libro/**` (FASE 9, M12). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function LibroLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "libro.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
