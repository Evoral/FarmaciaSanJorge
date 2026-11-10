/**
 * `/partidas/existencia-inicial` (openspec/changes/planilla-existencia-inicial R5).
 * Tab next to `/partidas`: displays the relevamiento inicial panel, the form (when open
 * and user has `stock.partida.ingresar`), and close controls (for the DT).
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
import { RelevamientoInicialPanel } from "@/modules/stock/ui/relevamiento-inicial-panel";
import { ExistenciaInicialForm } from "@/modules/stock/ui/existencia-inicial-form";
import { PageHeader } from "@/shared/ui/page-header";
import { PartidasTabs } from "../partidas-tabs";

export default async function ExistenciaInicialPage() {
  const session = await requireSession();

  const relevamiento = await getRelevamientoInicial();

  const tienePartidas = relevamiento.cargadoPorDroga.length > 0;
  if (!relevamiento.estado.abierto && !tienePartidas) {
    redirect("/partidas");
  }

  const puedeIngresar = relevamiento.estado.abierto && can(session, "stock.partida.ingresar");

  const [drogas, proveedores, unidades] = puedeIngresar
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

      <div className="flex max-w-4xl flex-col gap-6">
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
        >
          {puedeIngresar ? (
            <ExistenciaInicialForm
              drogas={opcionesDrogas}
              proveedores={opcionesProveedores}
              unidades={opcionesUnidades}
            />
          ) : null}
        </RelevamientoInicialPanel>
      </div>
    </div>
  );
}
