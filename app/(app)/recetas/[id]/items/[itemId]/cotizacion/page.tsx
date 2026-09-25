/**
 * `/recetas/[id]/items/[itemId]/cotizacion` (M10, FASE 7 point 7.4).
 * Calculate/view an ítem's cotización + history. Same permission-gate
 * discipline as the sibling `ficha-tecnica` page: the `/recetas/**` layout
 * only requires `recetas.crear`, so this page adds its OWN gate on top.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { getCotizacionItem } from "@/modules/precios/application/get-cotizacion-item";
import { CalcularCotizacionForm } from "@/modules/precios/ui/calcular-cotizacion-form";
import { CotizacionDetalleView } from "@/modules/precios/ui/cotizacion-detalle";

interface CotizacionPageProps {
  params: Promise<{ id: string; itemId: string }>;
}

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default async function CotizacionPage({ params }: CotizacionPageProps) {
  const session = await requireSession();
  const { id: recetaId, itemId } = await params;

  if (!can(session, "cotizaciones.calcular") && !can(session, "cotizaciones.ver")) {
    redirect(`/recetas/${recetaId}`);
  }

  const receta = await getReceta(recetaId);
  if (!receta) notFound();
  const item = receta.items.find((i) => i.id === itemId);
  if (!item) notFound();

  const puedeCalcular = can(session, "cotizaciones.calcular");
  const { vigente, historial } = await getCotizacionItem({ itemRecetaId: itemId });

  return (
    <div className="page">
      <div className="mb-2">
        <Link href={`/recetas/${recetaId}`} className="text-sm underline">
          ← Volver a la receta
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Cotización</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Receta Nº {receta.numeroInterno} — {item.descripcion ?? item.formaFarmaceutica} ({item.formaFarmaceutica})
        </p>
      </div>

      {puedeCalcular ? (
        <section className="mb-6">
          <CalcularCotizacionForm itemRecetaId={itemId} recetaId={recetaId} label={vigente ? "Recalcular cotización" : "Calcular cotización"} />
          <p className="mt-2 text-xs text-zinc-500">
            Calcular una cotización no descuenta stock, no asienta en el libro recetario ni reserva nada (INV-R02): solo estima el costo con la ficha
            técnica vigente. Requiere que el ítem tenga una ficha técnica generada.
          </p>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-medium">Cotización vigente</h2>
        {vigente ? (
          <CotizacionDetalleView cotizacion={vigente} />
        ) : (
          <p className="text-sm text-zinc-500">Este ítem todavía no fue cotizado.</p>
        )}
      </section>

      {historial.length > 1 ? (
        <section>
          <h2 className="mb-3 text-lg font-medium">Historial</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Calculada</th>
                  <th scope="col" className="px-3 py-2 font-medium">Costo insumos</th>
                  <th scope="col" className="px-3 py-2 font-medium">Margen</th>
                  <th scope="col" className="px-3 py-2 font-medium">Precio final</th>
                  <th scope="col" className="px-3 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {historial.slice(1).map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{fechaHora(c.calculadaEn)}</td>
                    <td className="px-3 py-2">${c.costoInsumos}</td>
                    <td className="px-3 py-2">{c.margenAplicado}%</td>
                    <td className="px-3 py-2">${c.precioFinal}</td>
                    <td className="px-3 py-2">
                      {c.esParcial ? "Parcial " : ""}
                      {c.esIncompleta ? "Incompleta" : ""}
                      {!c.esParcial && !c.esIncompleta ? "—" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
