/** `/stock/ingresar` (M07, FASE 5 point 5.1): alta manual o importación desde el PDF de la factura del proveedor (migration 0062). */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDrogasOpciones } from "@/modules/drogas/application/list-drogas-opciones";
import { listProveedoresOpciones } from "@/modules/proveedores/application/list-proveedores-opciones";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { IngresarPartida } from "@/modules/stock/ui/ingresar-partida";
import { PageHeader } from "@/shared/ui/page-header";

export default async function IngresarPartidaPage() {
  const session = await requireSession();
  if (!can(session, "stock.partida.ingresar")) {
    redirect("/stock");
  }

  const [drogas, proveedores, unidades] = await Promise.all([
    listDrogasOpciones(),
    listProveedoresOpciones(),
    listUnidadesVigentesParaDroga(),
  ]);

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: "Ingresar partida" }]}
        title="Ingresar partida"
        description="Cargá la factura del proveedor a mano o importá su PDF: cada lote se suma al stock como una partida nueva."
      />
      <div className="max-w-4xl">
        <IngresarPartida
          drogas={drogas.map((droga) => ({ id: droga.id, label: droga.nombre, tipoMagnitud: droga.tipoMagnitud, clase: droga.clase }))}
          proveedores={proveedores.map((proveedor) => ({ id: proveedor.id, label: proveedor.razonSocial }))}
          puedeCrearProducto={can(session, "drogas.crear")}
          unidades={unidades.map((unidad) => ({ id: unidad.id, label: `${unidad.nombre} (${unidad.simbolo})`, tipoMagnitud: unidad.tipoMagnitud, simbolo: unidad.simbolo }))}
        />
      </div>
    </div>
  );
}
