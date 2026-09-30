/**
 * `/stock/ajustes/nuevo?partidaId=...` (M07, FASE 5 point 5.4).
 * Without `partidaId` (the "Registrar ajuste" button on `/stock/ajustes`) it
 * first lets the user pick the partida: search a droga (`q`), pick it
 * (`drogaId`), then pick one of its partidas with balance. Once saved, the
 * form goes to `/stock/ajustes?registrado=1` (modules/stock/ui/ajuste-form.tsx).
 */
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getPartida } from "@/modules/stock/application/get-partida";
import { listDtParaCoFirma } from "@/modules/stock/application/list-dt-para-co-firma";
import { NotFoundError } from "@/shared/errors";
import { AjusteForm } from "@/modules/stock/ui/ajuste-form";
import { listStockDrogas } from "@/modules/stock/application/list-stock-drogas";
import { listPartidasDroga } from "@/modules/stock/application/list-partidas-droga";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { equivalenciasPracticas, formatCantidad, unidadesPracticas } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { FilterForm } from "@/shared/ui/filter-form";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECCION_PAGE_SIZE = 20;
const ACTION_LINK_CLASS = "text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400";

interface NuevoAjustePageProps {
  searchParams: Promise<{ partidaId?: string; drogaId?: string; q?: string }>;
}

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(fecha);
}

export default async function NuevoAjustePage({ searchParams }: NuevoAjustePageProps) {
  const session = await requireSession();
  if (!can(session, "stock.ajuste.registrar")) {
    redirect("/stock/ajustes");
  }

  const { partidaId, drogaId, q } = await searchParams;
  if (!partidaId) {
    return <SeleccionPartida q={q?.trim() ?? ""} drogaId={drogaId && UUID_PATTERN.test(drogaId) ? drogaId : ""} />;
  }

  let partida;
  try {
    partida = await getPartida(partidaId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [dts, { catalogo }] = await Promise.all([listDtParaCoFirma(), getCatalogoUnidades()]);
  const operadorEsDt = dts.some((dt) => dt.usuarioId === session.usuario.id);
  // Same allowed-unit rule as registrar-ajuste.ts (modules/stock/domain/partida.ts#rechazoUnidadAjuste):
  // the vigente practical units of the droga's magnitude, or only its unidad base when not convertible.
  const unidadBase = { id: partida.unidadBaseId, simbolo: partida.unidadBaseSimbolo };
  const saldo = equivalenciasPracticas(partida.cantidadDisponible, unidadBase, catalogo);
  const practicas = unidadesPracticas(unidadBase, catalogo);
  const unidades = practicas.length > 0 ? practicas.map((unidad) => ({ id: unidad.id, simbolo: unidad.simbolo })) : [unidadBase];

  return (
    <div className="page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Registrar ajuste / merma</h1>
        <Link href="/stock/ajustes" className="text-sm underline">
          Volver a ajustes
        </Link>
      </div>
      <AjusteForm
        partidaId={partida.id}
        drogaNombre={partida.drogaNombre}
        lote={partida.lote}
        saldoPrincipal={saldo.primaria.texto}
        saldoSecundario={saldo.secundaria?.texto ?? null}
        unidades={unidades}
        unidadPorDefectoId={saldo.primaria.unidadId}
        dts={dts.map((dt) => ({ id: dt.usuarioId, label: `${dt.nombre} ${dt.apellido}` }))}
        operadorEsDt={operadorEsDt}
      />
    </div>
  );
}

type Catalogo = Awaited<ReturnType<typeof getCatalogoUnidades>>["catalogo"];

/** Step before the form: droga search -> partidas with balance of the chosen droga. */
async function SeleccionPartida({ q, drogaId }: { q: string; drogaId: string }) {
  const { catalogo } = await getCatalogoUnidades();

  return (
    <div className="page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Registrar ajuste / merma</h1>
        <Link href="/stock/ajustes" className="text-sm underline">
          Volver a ajustes
        </Link>
      </div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">Elegí la droga y luego la partida sobre la que se registra el ajuste.</p>

      {drogaId ? <PartidasConSaldo drogaId={drogaId} q={q} catalogo={catalogo} /> : <DrogasParaAjuste q={q} catalogo={catalogo} />}
    </div>
  );
}

async function DrogasParaAjuste({ q, catalogo }: { q: string; catalogo: Catalogo }) {
  const stock = await listStockDrogas({ search: q || undefined, page: 1, pageSize: SELECCION_PAGE_SIZE });

  return (
    <>
      <FilterForm className="mb-4 flex flex-wrap items-end gap-3" aria-label="Buscar droga para el ajuste" hasActiveFilters={Boolean(q)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar droga
          </label>
          <input id="q" name="q" type="search" defaultValue={q} className="input" />
        </div>
      </FilterForm>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Droga</th>
              <th scope="col" className="px-3 py-2 font-medium">Stock disponible</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {stock.items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron drogas.
                </td>
              </tr>
            ) : (
              stock.items.map((item) => {
                const qs = new URLSearchParams({ drogaId: item.drogaId });
                if (q) qs.set("q", q);
                return (
                  <tr key={item.drogaId}>
                    <td className="px-3 py-2 font-medium">{item.drogaNombre}</td>
                    <td className="px-3 py-2">
                      <Cantidad valor={formatCantidad(item.stockDisponible, { id: item.unidadId, simbolo: item.unidadSimbolo }, catalogo)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/stock/ajustes/nuevo?${qs.toString()}`} className={ACTION_LINK_CLASS} aria-label={`Elegir partida de ${item.drogaNombre}`}>
                        Elegir partida →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {stock.total > stock.items.length ? (
        <p className="mt-2 text-xs text-zinc-500">
          Se muestran {stock.items.length} de {stock.total} drogas. Refiná la búsqueda para encontrar otra.
        </p>
      ) : null}
    </>
  );
}

async function PartidasConSaldo({ drogaId, q, catalogo }: { drogaId: string; q: string; catalogo: Catalogo }) {
  const result = await listPartidasDroga({ drogaId, soloConSaldo: true, page: 1, pageSize: 100 });
  const unidad = result.droga ? { id: result.droga.unidadBaseId, simbolo: result.droga.unidadBaseSimbolo } : null;
  const volverHref = q ? `/stock/ajustes/nuevo?${new URLSearchParams({ q }).toString()}` : "/stock/ajustes/nuevo";

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-semibold">{result.droga ? `Partidas con saldo de ${result.droga.nombre}` : "Droga no encontrada"}</h2>
        <Link href={volverHref} className="text-sm underline">
          Cambiar droga
        </Link>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Lote</th>
              <th scope="col" className="px-3 py-2 font-medium">Proveedor</th>
              <th scope="col" className="px-3 py-2 font-medium">Vencimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">Saldo</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  Esta droga no tiene partidas con saldo.
                </td>
              </tr>
            ) : (
              result.items.map((partida) => (
                <tr key={partida.id}>
                  <td className="px-3 py-2 font-medium">{partida.lote}</td>
                  <td className="px-3 py-2">{partida.proveedorRazonSocial}</td>
                  <td className="px-3 py-2">{formatFecha(partida.fechaVencimiento)}</td>
                  <td className="px-3 py-2">
                    {unidad ? <Cantidad valor={formatCantidad(partida.cantidadDisponible, unidad, catalogo)} /> : partida.cantidadDisponible}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/stock/ajustes/nuevo?partidaId=${partida.id}`} className={ACTION_LINK_CLASS} aria-label={`Registrar ajuste del lote ${partida.lote}`}>
                      Registrar ajuste →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {result.total > result.items.length ? (
        <p className="mt-2 text-xs text-zinc-500">Se muestran {result.items.length} de {result.total} partidas con saldo.</p>
      ) : null}
    </>
  );
}
