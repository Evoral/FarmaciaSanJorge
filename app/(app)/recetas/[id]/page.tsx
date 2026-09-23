/** `/recetas/[id]` (FASE 6 points 6.3/6.4/6.5/6.6): detalle, recepción física, anulación, link a edición. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { esEstadoEditable, esEstadoTerminal, puedeAnular } from "@/modules/recetas/domain/receta";
import { registrarRecepcionFisicaAction, anularRecetaAction } from "@/modules/recetas/ui/actions";
import { ConfirmarForm } from "@/modules/recetas/ui/confirmar-form";
import { MotivoForm } from "@/modules/recetas/ui/motivo-form";

interface RecetaDetallePageProps {
  params: Promise<{ id: string }>;
}

function fecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function RecetaDetallePage({ params }: RecetaDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const receta = await getReceta(id);
  if (!receta) notFound();

  const puedeEditar = can(session, "recetas.editar") && esEstadoEditable(receta.estado);
  const puedeRegistrarFisica = can(session, "recetas.fisica.registrar") && !receta.recetaFisicaRecibida;
  const puedeAnularReceta = can(session, "recetas.anular") && puedeAnular(receta.estado);
  const puedeVerFichas = can(session, "fichas.generar") || can(session, "fichas.imprimir");
  const puedeVerCotizacion = can(session, "cotizaciones.calcular") || can(session, "cotizaciones.ver");

  return (
    <div className="p-6">
      <div className="mb-2">
        <Link href="/recetas" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Receta Nº {receta.numeroInterno}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {receta.pacienteApellido}, {receta.pacienteNombre} — Dr./Dra. {receta.medicoApellido}, {receta.medicoNombre} (matrícula {receta.medicoMatricula})
          </p>
        </div>
        {puedeEditar ? (
          <Link href={`/recetas/${receta.id}/editar`} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
            Editar
          </Link>
        ) : null}
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-zinc-500">Estado</dt>
          <dd className="font-medium">{receta.estado}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Origen</dt>
          <dd>{receta.origen}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Fecha de prescripción</dt>
          <dd>{fecha(receta.fechaPrescripcion)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Fecha de ingreso</dt>
          <dd>{fecha(receta.fechaIngreso)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Receta física recibida</dt>
          <dd>
            {receta.recetaFisicaRecibida ? `Sí${receta.recetaFisicaRecibidaPorNombre ? ` — ${receta.recetaFisicaRecibidaPorNombre}` : ""}` : "No"}
            {receta.recetaFisicaRecibidaEn ? ` (${fecha(receta.recetaFisicaRecibidaEn)})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Registrada por</dt>
          <dd>{receta.registradaPorNombre}</dd>
        </div>
        {receta.motivoAnulacion ? (
          <div className="col-span-full">
            <dt className="text-zinc-500">Motivo de anulación</dt>
            <dd>{receta.motivoAnulacion}</dd>
          </div>
        ) : null}
      </dl>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-medium">Ítems</h2>
        <div className="flex flex-col gap-4">
          {receta.items.map((item, idx) => (
            <div key={item.id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Ítem {idx + 1}: {item.descripcion ?? item.formaFarmaceutica} ({item.formaFarmaceutica}) — {item.cantidadUnidades} unidad
                  {item.cantidadUnidades === 1 ? "" : "es"}
                  {item.cantidadTotal ? `, total ${item.cantidadTotal} ${item.unidadTotalSimbolo ?? ""}` : ""}
                  {item.estadoAsiento === "SIN_EFECTO" ? (
                    <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Sin efecto
                    </span>
                  ) : null}
                </p>
                <div className="flex gap-3">
                  {puedeVerFichas ? (
                    <Link href={`/recetas/${receta.id}/items/${item.id}/ficha-tecnica`} className="text-sm underline">
                      Ficha técnica
                    </Link>
                  ) : null}
                  {puedeVerCotizacion ? (
                    <Link href={`/recetas/${receta.id}/items/${item.id}/cotizacion`} className="text-sm underline">
                      Cotización
                    </Link>
                  ) : null}
                </div>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th scope="col" className="py-1 font-medium">
                      Droga
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Cantidad
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Modo
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Principio activo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {item.componentes.map((c) => (
                    <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                      <td className="py-1">{c.drogaNombre}</td>
                      <td className="py-1">{c.cantidad ? `${c.cantidad} ${c.unidadMedidaSimbolo}` : "—"}</td>
                      <td className="py-1">{c.modoExpresion}</td>
                      <td className="py-1">{c.esPrincipioActivo ? "Sí" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        {puedeRegistrarFisica ? (
          <div>
            <h2 className="mb-2 text-lg font-medium">Recepción física</h2>
            <ConfirmarForm action={registrarRecepcionFisicaAction} id={receta.id} label="Registrar recepción física" pendingLabel="Registrando…" helpText="INV-R09: no bloquea la preparación de la receta, pero es obligatoria antes de poder entregarla (INV-R07)." />
          </div>
        ) : null}

        {puedeAnularReceta ? (
          <div>
            <h2 className="mb-2 text-lg font-medium">Anulación</h2>
            <MotivoForm
              action={anularRecetaAction}
              id={receta.id}
              label="Anular receta"
              pendingLabel="Anulando…"
              helpText="Si ya se confirmó una preparación para algún ítem de esta receta, la anulación NO revierte el stock consumido ni genera un asiento de reversión: la corrección a nivel asiento es responsabilidad de FASE 9 (docs/specs/libro-recetario-y-contralor.md §1). La receta queda ANULADA de todas formas."
              submitClassName="rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:text-red-400"
            />
          </div>
        ) : null}

        {esEstadoTerminal(receta.estado) && !puedeRegistrarFisica && !puedeAnularReceta ? <p className="text-sm text-zinc-500">Esta receta está en un estado terminal ({receta.estado}); no admite más acciones.</p> : null}
      </section>
    </div>
  );
}
