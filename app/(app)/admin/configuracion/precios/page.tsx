/**
 * `/admin/configuracion/precios` (M08, FASE 4 point 4.6). Shows the
 * tenant's current price rule set (precio mínimo + margin tramos by cost,
 * docs/specs/reglas-precio.md) and its full version history, plus the form
 * to save a new version. The "Configuración" tabs sit under the header.
 */
import { History } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { getReglasPrecio } from "@/modules/precios/application/get-reglas-precio";
import type { TramoGuardado } from "@/modules/precios/application/get-reglas-precio";
import { ReglaPrecioForm } from "@/modules/precios/ui/regla-precio-form";
import { formatNumero } from "@/shared/format/cantidad";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToneBadge } from "@/shared/ui/status-badge";
import { configuracionSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function pesos(valor: string): string {
  return `$${formatNumero(valor, 2)}`;
}

/** "Hasta $100.000: +100%" / "Más de $100.000: +70%" -- one line per tramo. */
function TramosLista({ tramos }: { tramos: TramoGuardado[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {tramos.map((t, i) => {
        const anterior = i > 0 ? tramos[i - 1]!.costoHasta : null;
        const rango = t.costoHasta !== null ? `Hasta ${pesos(t.costoHasta)}` : anterior !== null ? `Más de ${pesos(anterior)}` : "Cualquier costo";
        return (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="text-zinc-600">{rango}</span>
            <span className="font-mono font-medium text-zinc-900">+{formatNumero(t.margen, 2)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PreciosPage() {
  const session = await requireSession();
  const { vigente, historial } = await getReglasPrecio();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "Reglas de precio" }]}
        title="Reglas de precio"
        description="Precio de cada preparación = el mayor entre (costo de insumos + margen del tramo de ese costo) y el precio mínimo. Versionado: cada cambio cierra la regla vigente y crea una nueva."
      />

      <SectionTabs ariaLabel="Secciones de configuración" links={configuracionSections(session)} />

      <div className="mb-6">
        <ReglaPrecioForm key={vigente?.id ?? "sin-regla"} vigente={vigente ? { precioMinimo: vigente.precioMinimo, tramos: vigente.tramos } : null} />
      </div>

      <section className="list-panel" aria-labelledby="historial-heading">
        <div className="list-toolbar">
          <h2 id="historial-heading" className="text-[0.9375rem] font-semibold text-zinc-900">
            Historial de versiones
          </h2>
        </div>
        {historial.length === 0 ? (
          <EmptyState icon={<History className="size-5" />} title="Todavía no se configuró ninguna regla de precio" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Tramos de margen
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Precio mínimo
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    Vigencia
                  </th>
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                    Creado por
                  </th>
                </tr>
              </thead>
              <tbody>
                {historial.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2.5 text-[0.8125rem]">
                      {r.vigenteHasta ? null : (
                        <span className="mb-1.5 block">
                          <ToneBadge tone="success">Vigente</ToneBadge>
                        </span>
                      )}
                      <TramosLista tramos={r.tramos} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{pesos(r.precioMinimo)}</td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums md:table-cell">
                      {fechaHora(r.vigenteDesde)} <span className="text-zinc-400">a</span> {r.vigenteHasta ? fechaHora(r.vigenteHasta) : <span className="font-sans text-emerald-700">hoy</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 lg:table-cell">
                      {r.creadoPorApellido}, {r.creadoPorNombre}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
