/**
 * `/cambiar-password`: step 1 of openspec/specs/contrasena-temporal/spec.md. Reads the
 * session with the pending-steps opt-out and only renders the form while
 * `cambiar-password` is the step that comes first.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { rutaDelPaso } from "@/shared/auth/pasos";
import { CambiarPasswordForm } from "./cambiar-password-form";

export default async function CambiarPasswordPage() {
  const session = await requireSession({ permitirPasosPendientes: true });
  const [paso] = session.pasosPendientes ?? [];
  if (!paso) redirect("/");
  if (paso !== "cambiar-password") redirect(rutaDelPaso(paso));

  return <CambiarPasswordForm />;
}
