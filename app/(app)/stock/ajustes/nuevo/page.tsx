/**
 * `/stock/ajustes/nuevo?partidaId=...` (M07, FASE 5 point 5.4).
 * Without `partidaId` (the "Registrar ajuste" button on `/stock/ajustes`) it
 * first lets the user pick the partida: search a droga (`q`), pick it
 * (`drogaId`), then pick one of its partidas with balance. Once saved, the
 * form goes to `/stock/ajustes?registrado=1` (modules/stock/ui/ajuste-form.tsx).
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
import { Cantidad } from "@/shared/ui/cantidad";
import { DrogaBuscador } from "@/modules/stock/ui/droga-buscador";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECCION_PAGE_SIZE = 20;

interface NuevoAjustePageProps {
  searchParams: Promise<{ partidaId?: string; drogaId?: string; q?: string }>;
}

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(fecha);
}

const BREADCRUMBS = [
  { label: "Inicio", href: "/" },
  { label: "Stock", href: "/stock" },
  { label: "Ajustes", href: "/stock/ajustes" },
  { label: "Registrar" },
];

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
      <PageHeader breadcrumbs={BREADCRUMBS} title="Registrar ajuste / merma" description="Se descuenta del saldo de la partida y queda registrado con la co-firma del Director Técnico." />
      <Pasos actual={3} pasoUnoHref="/stock/ajustes/nuevo" />
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
  const pasoUnoHref = q ? `/stock/ajustes/nuevo?${new URLSearchParams({ q }).toString()}` : "/stock/ajustes/nuevo";

  return (
    <div className="page list-view">
      <PageHeader breadcrumbs={BREADCRUMBS} title="Registrar ajuste / merma" description="Elegí la droga y luego la partida sobre la que se registra el ajuste." />
      <Pasos actual={drogaId ? 2 : 1} pasoUnoHref={pasoUnoHref} />
      <div className="max-w-3xl">
        {drogaId ? <PartidasConSaldo drogaId={drogaId} pasoUnoHref={pasoUnoHref} catalogo={catalogo} /> : <DrogasParaAjuste q={q} catalogo={catalogo} />}
      </div>
    </div>
  );
}

async function DrogasParaAjuste({ q, catalogo }: { q: string; catalogo: Catalogo }) {
  const stock = await listStockDrogas({ search: q || undefined, page: 1, pageSize: SELECCION_PAGE_SIZE });

  return (
    <>
      <div className="mb-4">
        <DrogaBuscador
          id="droga-ajuste"
          label="Droga"
          placeholder="Escribí el nombre de la droga"
          busquedaActual={q || undefined}
          alElegir={{ href: q ? `/stock/ajustes/nuevo?${new URLSearchParams({ q }).toString()}` : "/stock/ajustes/nuevo", param: "drogaId", valor: "id" }}
          alBuscar={{ href: "/stock/ajustes/nuevo", param: "q", texto: "Ver todas las coincidencias de “{q}”", textoSinBusqueda: "Ver todas las drogas" }}
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
                    <Link href={`/stock/ajustes/nuevo?${qs.toString()}`} className="pick-row" aria-label={`Elegir partida de ${item.drogaNombre}`}>
                      <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{item.drogaNombre}</span>
                      <span className="text-right">
                        <span className="block text-xs text-zinc-500">Disponible</span>
                        <span className="font-mono text-zinc-900 tabular-nums">
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

async function PartidasConSaldo({ drogaId, pasoUnoHref, catalogo }: { drogaId: string; pasoUnoHref: string; catalogo: Catalogo }) {
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
              <Link href={`/stock/ajustes/nuevo?partidaId=${partida.id}`} className="pick-row" aria-label={`Registrar ajuste del lote ${partida.lote}`}>
                <span className="min-w-0 flex-1">
                  <span className="block">
                    <span className="text-zinc-500">Lote </span>
                    <span className="font-mono font-semibold text-zinc-900">{partida.lote}</span>
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {partida.proveedorRazonSocial} · {partida.fechaVencimiento ? <>vence <span className="tabular-nums">{formatFecha(partida.fechaVencimiento)}</span></> : "no vence"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-xs text-zinc-500">Saldo</span>
                  <span className="font-mono text-zinc-900 tabular-nums">
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
