/**
 * `/cuenta` (M02, FASE 2 point 2.4 -- change your own password; PIN section added
 * by the PIN re-auth feature, user decision 2026-09-23). Server component: the
 * forms live in `cuenta-forms.tsx`. Usuarios whose only role is Administrador
 * have no PIN, so the PIN panel is only offered to the rest of the usuarios. A
 * cuenta de sector has neither: no PIN and it never changes its own password
 * (the Administrador sets it from Usuarios; openspec/specs/cuentas-de-sector/spec.md).
 * The huella panel (openspec/changes/metodos-verificacion-operador) is offered under the same conditions as the PIN
 * (an Administrador-only usuario never acts as an operador) and only while the farmacia has the huella enabled.
 */
import { Info } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { estadoCredencialesOperador } from "@/modules/auth/application/estado-credenciales-operador";
import { PageHeader } from "@/shared/ui/page-header";
import { Toaster } from "@/shared/ui/toast";
import { CuentaForms } from "./cuenta-forms";

export default async function CuentaPage() {
  const session = await requireSession();
  const breadcrumbs = [{ label: "Inicio", href: "/" }, { label: "Mi cuenta" }];

  if (session.sector) {
    return (
      <div className="page">
        <PageHeader breadcrumbs={breadcrumbs} title="Mi cuenta" description="Cuenta de sector: una sesión compartida por el puesto de trabajo." />
        <p role="note" className="alert alert-info max-w-2xl">
          <Info aria-hidden />
          <span>
            Esta cuenta no tiene PIN ni cambia su contraseña: cada empleado se identifica con su propio PIN en las acciones que lo piden. La contraseña la define un
            Administrador desde Usuarios.
          </span>
        </p>
      </div>
    );
  }

  const mostrarPin = !session.soloAdministrador;
  const huella = mostrarPin ? ((await estadoCredencialesOperador()).find((estado) => estado.metodo === "HUELLA" && estado.habilitado) ?? null) : null;

  return (
    <div className="page">
      <Toaster />
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="Mi cuenta"
        description={huella ? "Tu contraseña, tu PIN y tu huella para confirmar acciones." : mostrarPin ? "Tu contraseña y tu PIN para confirmar acciones." : "Tu contraseña para confirmar acciones."}
      />

      <CuentaForms mostrarPin={mostrarPin} huella={huella ? { enrolada: huella.enrolada } : null} />
    </div>
  );
}
