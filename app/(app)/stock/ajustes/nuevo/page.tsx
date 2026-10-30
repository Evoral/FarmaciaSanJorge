/**
 * `/stock/ajustes/nuevo?partidaId=...` (M07, FASE 5 point 5.4).
 * Without `partidaId` (the "Registrar ajuste" button on `/stock/ajustes`) it
 * first lets the user pick the partida: search a droga (`q`), pick it
 * (`drogaId`), then pick one of its partidas with balance. Once saved, the
 * form goes back to the list the flow started from with `?registrado=1`
 * (modules/stock/ui/ajuste-form.tsx): `?volverA=` (allowlisted by
 * `retornoAjuste`, today only `/stock/ajustes`, the default) is carried by
 * every step, link and breadcrumb.
 *
 * The three steps are shown as a stepper. Step 1 is a droga autocomplete
 * (picking goes straight to step 2); the list below browses the matches.
 */
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ChevronRight, PackageSearch, SearchX } from "lucide-react";
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
import { dec, Decimal } from "@/shared/decimal";
import { Cantidad } from "@/shared/ui/cantidad";
import { DrogaBuscador } from "@/modules/stock/ui/droga-buscador";
import { conRetornoAjuste, retornoAjuste, type RetornoAjuste } from "@/modules/stock/domain/ajustes-listado";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { nombreDeUsuario } from "@/shared/format/usuario";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECCION_PAGE_SIZE = 20;

interface NuevoAjustePageProps {
  searchParams: Promise<{ partidaId?: string; drogaId?: string; q?: string; volverA?: string }>;
}

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(fecha);
}

/** The trail of the list the flow returns to. */
function breadcrumbs(volverA: RetornoAjuste) {
  return [{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: "Ajuste de Stock", href: volverA }, { label: "Registrar" }];
}

type Paso = 1 | 2 | 3;

/** The flow's position; finished steps link back (step 2 only when its droga is known). */
function Pasos({ actual, pasoUnoHref, pasoDosHref }: { actual: Paso; pasoUnoHref: string; pasoDosHref?: string }) {
  const pasos: { n: Paso; label: string; href?: string }[] = [
    { n: 1, label: "Droga", href: pasoUnoHref },
    { n: 2, label: "Partida", href: pasoDosHref },
    { n: 3, label: "Ajuste" },
  ];
  return (
    <ol className="stepper" aria-label="Pasos para registrar el ajuste">
      {pasos.map((paso) => {
        const done = paso.n < actual;
        return (
          <li key={paso.n} data-state={done ? "done" : undefined} aria-current={paso.n === actual ? "step" : undefined}>
            <span className="stepper-dot" aria-hidden>
              {paso.n}
            </span>
            {done && paso.href ? <Link href={paso.href}>{paso.label}</Link> : paso.label}
          </li>
        );
      })}
    </ol>
  );
}

export default async function NuevoAjustePage({ searchParams }: NuevoAjustePageProps) {
  const session = await requireSession();
  const { partidaId, drogaId, q, volverA: volverAParam } = await searchParams;
  const volverA = retornoAjuste(volverAParam);
  if (!can(session, "stock.ajuste.registrar")) {
    redirect(volverA);
  }

  if (!partidaId) {
    return <SeleccionPartida q={q?.trim() ?? ""} drogaId={drogaId && UUID_PATTERN.test(drogaId) ? drogaId : ""} volverA={volverA} />;
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
  // Reserved by preparaciones (migration 0071): an ajuste can only consume the free part (registrar-ajuste.ts enforces it).
  const reservada = dec(partida.cantidadReservada);
  const reserva = reservada.isZero()
    ? null
    : {
        reservadoTexto: equivalenciasPracticas(partida.cantidadReservada, unidadBase, catalogo).primaria.texto,
        libreTexto: equivalenciasPracticas(Decimal.max(dec(partida.cantidadDisponible).minus(reservada), 0).toFixed(), unidadBase, catalogo).primaria.texto,
        recetas: partida.recetasConReserva,
      };

  return (
    <div className="page">
      <PageHeader breadcrumbs={breadcrumbs(volverA)} title="Registrar ajuste / merma" description="Se descuenta del saldo de la partida y queda registrado con la co-firma del Director Técnico." />
      <Pasos actual={3} pasoUnoHref={conRetornoAjuste("/stock/ajustes/nuevo", volverA)} />
      <AjusteForm
        partidaId={partida.id}
        drogaNombre={partida.drogaNombre}
        lote={partida.lote}
        saldoPrincipal={saldo.primaria.texto}
        saldoSecundario={saldo.secundaria?.texto ?? null}
        unidades={unidades}
        unidadPorDefectoId={saldo.primaria.unidadId}
        dts={dts.map((dt) => ({ id: dt.usuarioId, label: nombreDeUsuario(dt) }))}
        reserva={reserva}
        operadorEsDt={operadorEsDt}
        volverA={volverA}
      />
    </div>
  );
}

type Catalogo = Awaited<ReturnType<typeof getCatalogoUnidades>>["catalogo"];

/** Step before the form: droga search -> partidas with balance of the chosen droga. */
async function SeleccionPartida({ q, drogaId, volverA }: { q: string; drogaId: string; volverA: RetornoAjuste }) {
  const { catalogo } = await getCatalogoUnidades();
  const pasoUnoHref = conRetornoAjuste(q ? `/stock/ajustes/nuevo?${new URLSearchParams({ q }).toString()}` : "/stock/ajustes/nuevo", volverA);

  return (
    <div className="page list-view">
      <PageHeader breadcrumbs={breadcrumbs(volverA)} title="Registrar ajuste / merma" description="Elegí la droga y luego la partida sobre la que se registra el ajuste." />
      <Pasos actual={drogaId ? 2 : 1} pasoUnoHref={pasoUnoHref} />
      <div className="max-w-3xl">
        {drogaId ? (
          <PartidasConSaldo drogaId={drogaId} pasoUnoHref={pasoUnoHref} catalogo={catalogo} volverA={volverA} />
        ) : (
          <DrogasParaAjuste q={q} catalogo={catalogo} volverA={volverA} />
        )}
      </div>
    </div>
  );
}

async function DrogasParaAjuste({ q, catalogo, volverA }: { q: string; catalogo: Catalogo; volverA: RetornoAjuste }) {
  const stock = await listStockDrogas({ search: q || undefined, page: 1, pageSize: SELECCION_PAGE_SIZE });

  return (
    <>
      <div className="mb-4">
        <DrogaBuscador
          id="droga-ajuste"
          label="Droga"
          placeholder="Escribí el nombre de la droga"
          busquedaActual={q || undefined}
          alElegir={{ href: conRetornoAjuste(q ? `/stock/ajustes/nuevo?${new URLSearchParams({ q }).toString()}` : "/stock/ajustes/nuevo", volverA), param: "drogaId", valor: "id" }}
          alBuscar={{ href: conRetornoAjuste("/stock/ajustes/nuevo", volverA), param: "q", texto: "Ver todas las coincidencias de “{q}”", textoSinBusqueda: "Ver todas las drogas" }}
        />
      </div>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          {stock.items.length === 0 ? (
            <EmptyState icon={<SearchX className="size-5" />} title="No se encontraron drogas" description={q ? `Nada coincide con “${q}”.` : undefined} />
          ) : (
            <ul aria-label="Drogas">
              {stock.items.map((item) => {
                const qs = new URLSearchParams({ drogaId: item.drogaId });
                if (q) qs.set("q", q);
                return (
                  <li key={item.drogaId}>
                    <Link href={conRetornoAjuste(`/stock/ajustes/nuevo?${qs.toString()}`, volverA)} className="pick-row" aria-label={`Elegir partida de ${item.drogaNombre}`}>
                      <span className="min-w-0 flex-1 line-clamp-2 leading-snug font-medium text-zinc-900 sm:truncate">{item.drogaNombre}</span>
                      <span className="flex-none text-right leading-tight">
                        <span className="block text-[10px] text-zinc-400 sm:text-xs sm:text-zinc-500">Disponible</span>
                        <span className="font-mono text-xs text-zinc-700 tabular-nums sm:text-sm sm:text-zinc-900">
                          <Cantidad valor={formatCantidad(item.stockDisponible, { id: item.unidadId, simbolo: item.unidadSimbolo }, catalogo)} />
                        </span>
                      </span>
                      <ChevronRight className="summary-row-chevron size-4 flex-none" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {stock.total > stock.items.length ? (
            <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
              Se muestran {stock.items.length} de {stock.total} drogas. Refiná la búsqueda para encontrar otra.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

async function PartidasConSaldo({ drogaId, pasoUnoHref, catalogo, volverA }: { drogaId: string; pasoUnoHref: string; catalogo: Catalogo; volverA: RetornoAjuste }) {
  const result = await listPartidasDroga({ drogaId, soloConSaldo: true, page: 1, pageSize: 100 });
  const unidad = result.droga ? { id: result.droga.unidadBaseId, simbolo: result.droga.unidadBaseSimbolo } : null;

  return (
    <div className="list-panel">
      <div className="list-toolbar">
        <p className="font-medium text-zinc-900">{result.droga ? `Partidas con saldo de ${result.droga.nombre}` : "Droga no encontrada"}</p>
        <Link href={pasoUnoHref} className="btn btn-ghost btn-sm">
          Cambiar droga
        </Link>
      </div>
      {result.items.length === 0 ? (
        <EmptyState icon={<PackageSearch className="size-5" />} title="Esta droga no tiene partidas con saldo" description="No hay nada para descontar. Elegí otra droga." />
      ) : (
        <ul aria-label="Partidas con saldo">
          {result.items.map((partida) => (
            <li key={partida.id}>
              <Link href={conRetornoAjuste(`/stock/ajustes/nuevo?partidaId=${partida.id}`, volverA)} className="pick-row" aria-label={`Registrar ajuste del lote ${partida.lote}`}>
                <span className="min-w-0 flex-1">
                  <span className="block">
                    <span className="text-zinc-500">Lote </span>
                    <span className="font-mono font-semibold text-zinc-900">{partida.lote}</span>
                  </span>
                  <span className="block line-clamp-2 text-xs text-zinc-500 sm:truncate">
                    {partida.proveedorRazonSocial} · {partida.fechaVencimientoVigente ? <>vence <span className="tabular-nums">{formatFecha(partida.fechaVencimientoVigente)}</span></> : "no vence"}
                  </span>
                </span>
                <span className="flex-none text-right leading-tight">
                  <span className="block text-[10px] text-zinc-400 sm:text-xs sm:text-zinc-500">Saldo</span>
                  <span className="font-mono text-xs text-zinc-700 tabular-nums sm:text-sm sm:text-zinc-900">
                    {unidad ? <Cantidad valor={formatCantidad(partida.cantidadDisponible, unidad, catalogo)} /> : partida.cantidadDisponible}
                  </span>
                </span>
                <ChevronRight className="summary-row-chevron size-4 flex-none" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.total > result.items.length ? (
        <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">Se muestran {result.items.length} de {result.total} partidas con saldo.</p>
      ) : null}
    </div>
  );
}
