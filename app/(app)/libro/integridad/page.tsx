/** `/libro/integridad` (FASE 9, M12 point 9.3). Verificación de la cadena de hash del libro recetario y de cada libro contralor. */
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listReanclajes } from "@/modules/libro/application/list-reanclajes";
import { verificarCadenaLibros } from "@/modules/libro/application/verificar-cadena-libros";
import { etiquetaLibro } from "@/modules/libro/domain/integridad";
import { LibroNav } from "@/modules/libro/ui/libro-nav";
import { ReanclarLibroForm } from "@/modules/libro/ui/reanclar-libro-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

export default async function IntegridadPage() {
  const session = await requireSession();
  const [resultados, reanclajes] = await Promise.all([verificarCadenaLibros(), listReanclajes()]);
  const puedeReanclar = can(session, "libro.anulacion.autorizar");
  const quebrados = resultados.filter((r) => !r.ok).length;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Libro", href: "/libro" }, { label: "Integridad" }]}
        title="Verificación de integridad"
        description="Cada asiento guarda el hash del anterior: si alguno se alteró, la cadena se quiebra en ese punto."
      />

      <LibroNav actual="integridad" />

      <div role="status" className={`alert mb-5 ${quebrados === 0 ? "alert-success" : "alert-danger"}`}>
        {quebrados === 0 ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}
        <p className="font-medium">
          {quebrados === 0
            ? resultados.length === 1
              ? "La cadena está intacta."
              : `Las ${resultados.length} cadenas están intactas.`
            : `${quebrados} de ${resultados.length} ${resultados.length === 1 ? "cadena tiene" : "cadenas tienen"} un quiebre.`}
        </p>
      </div>

      <ul className="list-panel max-w-3xl">
        {resultados.map((r) => (
          <li key={r.libroId} className="flex items-center gap-4 border-b border-zinc-100 px-5 py-4 last:border-b-0">
            <span className="tone-tile" data-tone={r.ok ? "success" : "danger"} aria-hidden>
              {r.ok ? <ShieldCheck /> : <ShieldAlert />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-900">{etiquetaLibro(r.tipo)}</p>
              <p className="text-[0.8125rem] text-zinc-600">{r.ok ? "La cadena de hash está intacta." : `Primer quiebre en el asiento Nº ${r.primerQuiebreNumero}.`}</p>
            </div>
            <ToneBadge tone={r.ok ? "success" : "danger"}>{r.ok ? "OK" : "Quebrada"}</ToneBadge>
          </li>
        ))}
      </ul>

      {puedeReanclar ? (
        <div className="mt-6 flex max-w-3xl flex-col gap-4">
          {resultados
            .filter((r) => !r.ok && r.primerQuiebreNumero !== null)
            .map((r) => (
              <ReanclarLibroForm key={r.libroId} libroId={r.libroId} etiquetaLibro={etiquetaLibro(r.tipo)} numeroFaltante={r.primerQuiebreNumero ?? ""} />
            ))}
        </div>
      ) : null}

      {reanclajes.length > 0 ? (
        <section className="mt-8 max-w-3xl" aria-labelledby="reanclajes-heading">
          <h2 id="reanclajes-heading" className="mb-2 text-sm font-semibold text-zinc-900">
            Reanclajes registrados
          </h2>
          <ul className="list-panel">
            {reanclajes.map((r) => (
              <li key={r.id} className="border-b border-zinc-100 px-5 py-3 text-[0.8125rem] text-zinc-700 last:border-b-0">
                <p className="font-medium text-zinc-900">
                  {etiquetaLibro(r.tipo)} · faltante Nº {r.numeroEsperado}, retoma en Nº {r.desdeNumero}
                </p>
                <p>
                  {formatFechaIso(r.registradoEn.toISOString().slice(0, 10))} · {r.registradoPor} · {r.motivo}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
