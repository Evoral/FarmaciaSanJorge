/** `/admin/configuracion` has no screen of its own: redirects to the first section the session can reach (see `../../nav-sections.ts`), or `/` if none. */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { configuracionSections, firstSectionHref } from "../../nav-sections";

export default async function ConfiguracionIndexPage() {
  const session = await requireSession();
  redirect(firstSectionHref(configuracionSections(session)) ?? "/");
}
