/**
 * `/admin/configuracion/parametros` (FASE 3 point 3.10b): lists the two known per-tenant
 * weighing parameters with an edit form each (enabled only for
 * `config.editar`). The "Configuración" tabs sit under the header.
 */
import { Info } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listParametros } from "@/modules/parametros/application/list-parametros";
import { ParametroForm } from "@/modules/parametros/ui/parametro-form";
import { PageHeader } from "@/shared/ui/page-header";
import { configuracionSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

export default async function ParametrosPage() {
  const session = await requireSession();
  const parametros = await listParametros();
  const puedeEditar = can(session, "config.editar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "Parámetros" }]}
        title="Parámetros de la farmacia"
        description="Estos parámetros afectan el cálculo de las líneas de pesaje de las fichas técnicas."
      />

      <SectionTabs ariaLabel="Secciones de configuración" links={configuracionSections(session)} />

      <p role="note" className="alert alert-info mb-4 max-w-3xl">
        <Info aria-hidden />
        <span>
          Un cambio acá aplica SOLO a las fichas técnicas generadas DESPUÉS del cambio: las fichas ya generadas quedan congeladas con los valores vigentes al momento de
          generarlas, un cambio posterior en un parámetro no las recalcula.
        </span>
      </p>

      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        {parametros.map((parametro) => (
          <ParametroForm key={parametro.clave} clave={parametro.clave} label={parametro.label} descripcion={parametro.descripcion} valor={parametro.valor} disabled={!puedeEditar} />
        ))}
      </div>
    </>
  );
}
