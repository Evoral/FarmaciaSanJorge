/**
 * `/cuenta` (M02, FASE 2 point 2.4 -- change your own password; PIN section added
 * by the PIN re-auth feature, user decision 2026-09-23). Server component: the
 * forms live in `cuenta-forms.tsx`. Cuentas de sector have no PIN, so the PIN
 * panel is only offered to the rest of the usuarios.
 */
import { requireSession } from "@/shared/auth/session";
import { PageHeader } from "@/shared/ui/page-header";
import { CuentaForms } from "./cuenta-forms";

export default async function CuentaPage() {
  const session = await requireSession();
  const mostrarPin = !session.sector;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Mi cuenta" }]}
        title="Mi cuenta"
        description={mostrarPin ? "Tu contraseña y tu PIN para confirmar acciones." : "Tu contraseña para confirmar acciones."}
      />

      <CuentaForms mostrarPin={mostrarPin} />
    </div>
  );
}
