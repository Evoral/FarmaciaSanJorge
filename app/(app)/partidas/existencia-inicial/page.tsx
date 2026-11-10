/**
 * `/partidas/existencia-inicial` (openspec/changes/planilla-existencia-inicial R5).
 * Tab next to `/partidas`: displays the relevamiento inicial panel, the planilla,
 * what already passed, Faltan cargar, and close controls (for the DT).
 * When relevamiento is closed, shows what was loaded read-only (who closed it and when,
 * or when the plazo ended).
 * Redirects to `/partidas` if the relevamiento is not abierto AND the tenant has no
 * partida de existencia inicial.
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDrogasOpciones } from "@/modules/drogas/application/list-drogas-opciones";
import { listProveedoresOpciones } from "@/modules/proveedores/application/list-proveedores-opciones";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { getRelevamientoInicial } from "@/modules/stock/application/cerrar-relevamiento-inicial";
import { getPlanillaRelevamiento } from "@/modules/stock/application/get-planilla-relevamiento";
import { RelevamientoInicialPanel } from "@/modules/stock/ui/relevamiento-inicial-panel";
import { PlanillaExistenciaInicial } from "@/modules/stock/ui/planilla-existencia-inicial";
import { PageHeader } from "@/shared/ui/page-header";
import { PartidasTabs } from "../partidas-tabs";

export default async function ExistenciaInicialPage() {
  const session = await requireSession();

  const [relevamiento, planilla] = await Promise.all([
    getRelevamientoInicial(),
    getPlanillaRelevamiento(),
  ]);

  const tienePartidas = relevamiento.cargadoPorDroga.length > 0 || planilla.partidas.length > 0;
  if (!relevamiento.estado.abierto && !tienePartidas) {
    redirect("/partidas");
  }

  const puedeEditar = relevamiento.estado.abierto && can(session, "stock.relevamiento.editar");
  const puedePasarAStock = relevamiento.estado.abierto && can(session, "stock.partida.ingresar");

  const [drogas, proveedores, unidades] = relevamiento.estado.abierto
    ? await Promise.all([
        listDrogasOpciones(),
        listProveedoresOpciones(),
        listUnidadesVigentesParaDroga(),
      ])
    : [[], [], []];

  const opcionesDrogas = drogas.map((droga) => ({
    id: droga.id,
    label: droga.nombre,
    tipoMagnitud: droga.tipoMagnitud,
    clase: droga.clase,
    sinonimos: droga.sinonimos,
  }));
  const opcionesProveedores = proveedores.map((proveedor) => ({
    id: proveedor.id,
    label: proveedor.razonSocial,
  }));
  const opcionesUnidades = unidades.map((unidad) => ({
    id: unidad.id,
    label: `${unidad.nombre} (${unidad.simbolo})`,
    tipoMagnitud: unidad.tipoMagnitud,
    simbolo: unidad.simbolo,
  }));

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[
          { label: "Inicio", href: "/" },
          { label: "Stock", href: "/stock" },
          { label: "Partidas", href: "/partidas" },
          { label: "Existencia inicial" },
        ]}
        title="Existencia inicial"
        description="El stock que ya estaba en la farmacia al empezar a usar el sistema."
      />

      <PartidasTabs mostrarExistenciaInicial={true} />

      <div className="flex max-w-7xl flex-col gap-6">
        <RelevamientoInicialPanel
          abierto={relevamiento.estado.abierto}
          cerradoEn={relevamiento.estado.cerradoEn}
          cerradoPor={relevamiento.estado.cerradoPor}
          fechaLimite={relevamiento.estado.fechaLimite}
          cargadoPorDroga={relevamiento.cargadoPorDroga}
          contralorActivo={relevamiento.contralorActivo}
          diferencias={relevamiento.diferenciasControladas}
          puedeCerrar={relevamiento.puedeCerrar}
          zonaHoraria={relevamiento.zonaHoraria}
          totalFilasPlanilla={planilla.contadores.totalFilas}
          faltanCargar={planilla.faltanCargar}
        />

        <PlanillaExistenciaInicial
          filas={planilla.filas}
          partidas={planilla.partidas}
          faltanCargar={planilla.faltanCargar}
          drogas={opcionesDrogas}
          proveedores={opcionesProveedores}
          unidades={opcionesUnidades}
          puedeEditar={puedeEditar}
          puedePasarAStock={puedePasarAStock}
          jornadaActual={planilla.jornadaActual}
          abierto={relevamiento.estado.abierto}
        />
      </div>
    </div>
  );
}
