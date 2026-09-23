/** `/stock/ingresar` (M07, FASE 5 point 5.1). */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDrogas } from "@/modules/drogas/application/list-drogas";
import { listProveedores } from "@/modules/proveedores/application/list-proveedores";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { IngresarPartidaForm } from "@/modules/stock/ui/ingresar-partida-form";

export default async function IngresarPartidaPage() {
  const session = await requireSession();
  if (!can(session, "stock.partida.ingresar")) {
    redirect("/stock");
  }

  const [drogas, proveedores, unidades] = await Promise.all([
    listDrogas({ soloVigentes: true, page: 1, pageSize: 200 }),
    listProveedores({ soloVigentes: true, page: 1, pageSize: 200 }),
    listUnidadesVigentesParaDroga(),
  ]);

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">Ingresar partida</h1>
      <IngresarPartidaForm
        drogas={drogas.items.map((droga) => ({ id: droga.id, label: droga.nombre }))}
        proveedores={proveedores.items.map((proveedor) => ({ id: proveedor.id, label: proveedor.razonSocial }))}
        unidades={unidades.map((unidad) => ({ id: unidad.id, label: `${unidad.nombre} (${unidad.simbolo})` }))}
      />
    </div>
  );
}
