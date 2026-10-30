/**
 * `/libro/numeracion` (migration 0097). First number of the libro recetario and of each libro contralor: 1, or the
 * continuation of the physical book. The DT can change it until the first signed cierre covering the libro fixes it.
 */
import { Hash, Lock } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listNumeracionLibros } from "@/modules/libro/application/list-numeracion-libros";
import { etiquetaLibro } from "@/modules/libro/domain/integridad";
import { LibroNav } from "@/modules/libro/ui/libro-nav";
import { ConfigurarNumeracionForm } from "@/modules/libro/ui/configurar-numeracion-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

export default async function NumeracionLibroPage() {
  const session = await requireSession();
  const libros = await listNumeracionLibros();
  const puedeConfigurar = can(session, "libro.anulacion.autorizar");

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Libro", href: "/libro" }, { label: "Numeración" }]}
        title="Numeración del libro"
        description="Cada libro empieza en 1 o continúa la numeración del libro físico. Se puede cambiar hasta que se firma el primer cierre: desde ahí queda fija para siempre."
      />

      <LibroNav actual="numeracion" />

      <div className="flex max-w-3xl flex-col gap-4">
        {libros.map((l) => {
          const fija = l.fijadaEnJornada !== null;
          const bloqueada = fija || l.contralorManual;
          const headingId = `numeracion-${l.libroId}`;
          return (
            <section key={l.libroId} className="panel" aria-labelledby={headingId}>
              <div className="panel-header flex flex-wrap items-center gap-3">
                <span className="tone-tile" data-tone={bloqueada ? "neutral" : "warn"} aria-hidden>
                  {bloqueada ? <Lock /> : <Hash />}
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <h2 id={headingId}>{etiquetaLibro(l.tipo)}</h2>
                  <p className="text-[0.8125rem] text-zinc-600">
                    Primer asiento: <span className="font-mono font-semibold text-zinc-900 tabular-nums">Nº {l.numeroInicial}</span>
                    {l.cantidadAsientos > 0 ? ` · ${l.cantidadAsientos} ${l.cantidadAsientos === 1 ? "asiento registrado" : "asientos registrados"} (Nº ${l.primerNumero} a Nº ${l.ultimoNumero})` : " · Sin asientos todavía"}
                  </p>
                </div>
                <ToneBadge tone={bloqueada ? "neutral" : "warn"}>{fija ? "Fija" : l.contralorManual ? "Manual" : "Se puede cambiar"}</ToneBadge>
              </div>
              <div className="panel-body">
                {l.contralorManual ? (
                  <p className="text-[0.8125rem] text-zinc-600">
                    Libros contralor llevados en forma manual: esta farmacia no activó el contralor digital, así que el sistema no genera asientos ni hay numeración que configurar.
                  </p>
                ) : fija ? (
                  <p className="text-[0.8125rem] text-zinc-600">Quedó fija con el cierre de la jornada {formatFechaIso(l.fijadaEnJornada ?? "")}. No se puede cambiar.</p>
                ) : l.tieneReanclaje ? (
                  <p className="text-[0.8125rem] text-zinc-600">Este libro tiene un reanclaje de la cadena registrado: su numeración no se puede cambiar.</p>
                ) : puedeConfigurar ? (
                  <ConfigurarNumeracionForm
                    libroId={l.libroId}
                    numeroInicial={l.numeroInicial}
                    cantidadAsientos={l.cantidadAsientos}
                    primerNumero={l.primerNumero}
                    ultimoNumero={l.ultimoNumero}
                  />
                ) : (
                  <p className="text-[0.8125rem] text-zinc-600">Solo el Director Técnico puede cambiarla, hasta que firme el primer cierre.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
