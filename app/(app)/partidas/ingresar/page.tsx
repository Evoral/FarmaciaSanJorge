/**
 * `/partidas/ingresar` (M07, FASE 5 point 5.1): alta manual o importación desde el PDF de la factura del proveedor (migration 0062).
 * Reached from the "Nuevo ingreso" button of Partidas (`/partidas`), which owns partida management; `/stock` no longer links here.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDrogasOpciones } from "@/modules/drogas/application/list-drogas-opciones";
import { listProveedoresOpciones } from "@/modules/proveedores/application/list-proveedores-opciones";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { IngresarPartida } from "@/modules/stock/ui/ingresar-partida";
import { getRelevamientoInicial } from "@/modules/stock/application/cerrar-relevamiento-inicial";
import { RelevamientoInicialPanel } from "@/modules/stock/ui/relevamiento-inicial-panel";
import { ExistenciaInicialForm } from "@/modules/stock/ui/existencia-inicial-form";
import { PageHeader } from "@/shared/ui/page-header";

export default async function IngresarPartidaPage() {
  const session = await requireSession();
  if (!can(session, "stock.partida.ingresar")) {
    redirect("/partidas");
  }

  const [drogas, proveedores, unidades, relevamiento] = await Promise.all([
    listDrogasOpciones(),
    listProveedoresOpciones(),
    listUnidadesVigentesParaDroga(),
    can(session, "stock.ver") ? getRelevamientoInicial() : Promise.resolve(null),
  ]);
  const opcionesDrogas = drogas.map((droga) => ({ id: droga.id, label: droga.nombre, tipoMagnitud: droga.tipoMagnitud, clase: droga.clase, sinonimos: droga.sinonimos }));
  const opcionesProveedores = proveedores.map((proveedor) => ({ id: proveedor.id, label: proveedor.razonSocial }));
  const opcionesUnidades = unidades.map((unidad) => ({ id: unidad.id, label: `${unidad.nombre} (${unidad.simbolo})`, tipoMagnitud: unidad.tipoMagnitud, simbolo: unidad.simbolo }));

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Partidas", href: "/partidas" }, { label: "Nuevo ingreso" }]}
        title="Nuevo ingreso"
        description="Cargá la factura del proveedor a mano o importá su PDF: cada lote se suma al stock como una partida nueva."
      />
      <div className="flex max-w-4xl flex-col gap-6">
        {relevamiento?.estado.abierto ? (
          <RelevamientoInicialPanel
            fechaLimite={relevamiento.estado.fechaLimite}
            cargadoPorDroga={relevamiento.cargadoPorDroga}
            contralorActivo={relevamiento.contralorActivo}
            diferencias={relevamiento.diferenciasControladas}
            puedeCerrar={relevamiento.puedeCerrar}
          >
            <ExistenciaInicialForm drogas={opcionesDrogas} proveedores={opcionesProveedores} unidades={opcionesUnidades} />
          </RelevamientoInicialPanel>
        ) : null}
        <IngresarPartida drogas={opcionesDrogas} proveedores={opcionesProveedores} puedeCrearProducto={can(session, "drogas.crear")} unidades={opcionesUnidades} />
      </div>
    </div>
  );
}
