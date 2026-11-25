/**
 * `/admin/configuracion/pin` (openspec/specs/cuentas-de-sector/spec.md): which acciones
 * ask for the PIN of the empleado performing them in a cuenta de sector.
 * Editable only with `config.editar`. The "Configuración" tabs sit under the header.
 */
import { Info } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listAccionesConPin } from "@/modules/operadores/application/list-acciones-con-pin";
import { listMetodosVerificacion } from "@/modules/operadores/application/list-metodos-verificacion";
import { AccionesConPinForm } from "@/modules/operadores/ui/acciones-con-pin-form";
import { MetodosVerificacionForm } from "@/modules/operadores/ui/metodos-verificacion-form";
import { PageHeader } from "@/shared/ui/page-header";
import { configuracionSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

export default async function PinPorAccionPage() {
  const session = await requireSession();
  const [acciones, metodos] = await Promise.all([listAccionesConPin(), listMetodosVerificacion()]);
  const puedeEditar = can(session, "config.editar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "Verificación por acción" }]}
        title="Verificación por acción"
        description="En las cuentas de sector (una sesión compartida por puesto de trabajo), elegí qué acciones exigen que el empleado se identifique (con su PIN o con otro método habilitado)."
      />

      <SectionTabs ariaLabel="Secciones de configuración" links={configuracionSections(session)} />

      <p role="note" className="alert alert-info mb-4 max-w-4xl">
        <Info aria-hidden />
        <span>
          Una acción <b>con verificación</b> queda registrada a nombre del empleado que se identificó, y solo se permite si ese empleado tiene el permiso en sus propios roles. Una acción{" "}
          <b>sin verificación</b> queda a nombre de la cuenta del sector. No cambia nada para quien entra con su usuario personal.
        </span>
      </p>

      <div className="max-w-4xl">
        <AccionesConPinForm acciones={acciones} disabled={!puedeEditar} />
      </div>

      {/* Rendered only while a method other than the always-on PIN exists: a PIN-only farmacia sees the screen as it always was. */}
      {metodos.length > 0 ? (
        <section aria-labelledby="metodos-verificacion" className="mt-8 max-w-4xl">
          <h2 id="metodos-verificacion" className="mb-1 text-base font-semibold">
            Métodos de verificación
          </h2>
          <p className="mb-3 text-sm text-zinc-600">
            Además del PIN, que siempre está disponible, elegí con qué otros métodos puede identificarse un empleado. Si apagás uno, se conservan las credenciales ya cargadas.
          </p>
          <MetodosVerificacionForm metodos={metodos} disabled={!puedeEditar} />
        </section>
      ) : null}
    </>
  );
}
