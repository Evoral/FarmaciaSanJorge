/** `/stock/ingresar` (M07, FASE 5 point 5.1). */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDrogasOpciones } from "@/modules/drogas/application/list-drogas-opciones";
import { listProveedoresOpciones } from "@/modules/proveedores/application/list-proveedores-opciones";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { IngresarPartidaForm } from "@/modules/stock/ui/ingresar-partida-form";

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
      <h1 className="mb-6 text-2xl font-semibold">Ingresar partida</h1>
      <IngresarPartidaForm
        drogas={drogas.map((droga) => ({ id: droga.id, label: droga.nombre, tipoMagnitud: droga.tipoMagnitud }))}
        proveedores={proveedores.map((proveedor) => ({ id: proveedor.id, label: proveedor.razonSocial }))}
        unidades={unidades.map((unidad) => ({ id: unidad.id, label: `${unidad.nombre} (${unidad.simbolo})`, tipoMagnitud: unidad.tipoMagnitud }))}
      />
    </div>
  );
}
