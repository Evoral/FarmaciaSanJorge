/**
 * `/admin` has no screen of its own: it sends the session to the first
 * "Administración" section it can reach -- "Usuarios y accesos" first, then
 * "Configuración", same order as the sidebar group -- or to `/` if none
 * (the outer `./layout.tsx` guard already redirects that case; this is the
 * belt to its braces). Same "first reachable section" rule as the sidebar
 * hrefs computed in `app/(app)/layout.tsx`.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { accesosSections, configuracionSections, firstSectionHref } from "../nav-sections";

export default async function AdminIndexPage() {
  const session = await requireSession();
  redirect(firstSectionHref(accesosSections(session)) ?? firstSectionHref(configuracionSections(session)) ?? "/");
}
