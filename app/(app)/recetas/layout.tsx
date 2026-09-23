/** Layout guard for `/recetas/**` (FASE 6, M09). `recetas.crear` is the broadest recetas.* permiso (ATP/FAR/DT) -- same reasoning as modules/recetas/application/get-receta.ts's doc comment. */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function RecetasLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "recetas.crear")) {
    redirect("/");
  }

  return <>{children}</>;
}
