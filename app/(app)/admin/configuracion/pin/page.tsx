/**
 * `/admin/configuracion/pin` (openspec/specs/cuentas-de-sector/spec.md): which acciones
 * ask for the PIN of the empleado performing them in a cuenta de sector.
 * Editable only with `config.editar`. The "Configuración" tabs sit under the header.
 */
import { Info } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listAccionesConPin } from "@/modules/operadores/application/list-acciones-con-pin";
import { AccionesConPinForm } from "@/modules/operadores/ui/acciones-con-pin-form";
import { PageHeader } from "@/shared/ui/page-header";
import { configuracionSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

export default async function PinPorAccionPage() {
  const session = await requireSession();
  const acciones = await listAccionesConPin();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "PIN por acción" }]}
        title="PIN por acción"
        description="En las cuentas de sector (una sesión compartida por puesto de trabajo), elegí qué acciones exigen que el empleado se identifique con su PIN."
      />

      <SectionTabs ariaLabel="Secciones de configuración" links={configuracionSections(session)} />

      <p role="note" className="alert alert-info mb-4 max-w-4xl">
        <Info aria-hidden />
        <span>
          Una acción <b>con PIN</b> queda registrada a nombre del empleado que lo ingresó, y solo se permite si ese empleado tiene el permiso en sus propios roles. Una acción{" "}
          <b>sin PIN</b> queda a nombre de la cuenta del sector. No cambia nada para quien entra con su usuario personal.
        </span>
      </p>

      <div className="max-w-4xl">
        <AccionesConPinForm acciones={acciones} disabled={!can(session, "config.editar")} />
      </div>
    </>
  );
}
