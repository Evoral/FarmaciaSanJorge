/**
 * `/configurar-pin`: step 2 of docs/specs/contrasena-temporal.md. Reads the
 * session with the pending-steps opt-out and only renders the form while
 * `configurar-pin` is the step that comes first.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { rutaDelPaso } from "@/shared/auth/pasos";
import { ConfigurarPinForm } from "./configurar-pin-form";

export default async function ConfigurarPinPage() {
  const session = await requireSession({ permitirPasosPendientes: true });
  const [paso] = session.pasosPendientes ?? [];
  if (!paso) redirect("/");
  if (paso !== "configurar-pin") redirect(rutaDelPaso(paso));

  return <ConfigurarPinForm />;
}
