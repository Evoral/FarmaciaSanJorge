/** `/plataforma/farmacias/nueva`: alta of a pharmacy and its first Administrador (openspec/specs/plataforma/spec.md P10). */
import { PageHeader } from "@/shared/ui/page-header";
import { AltaFarmaciaForm } from "@/modules/plataforma/ui/alta-farmacia-form";

export default function NuevaFarmaciaPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Farmacias", href: "/plataforma" }, { label: "Nueva farmacia" }]}
        title="Nueva farmacia"
        description="Crea la farmacia con su configuración inicial y su primer administrador, todo junto: si algo falla, no se crea nada."
      />
      <section className="panel max-w-3xl" aria-label="Datos del alta">
        <div className="panel-body">
          <AltaFarmaciaForm />
        </div>
      </section>
    </>
  );
}
