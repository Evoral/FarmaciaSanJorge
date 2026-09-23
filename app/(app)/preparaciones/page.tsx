/** `/preparaciones` (M11, FASE 8): list of preparaciones grouped by estado (pending = INICIADA, confirmed, discarded). */
import Link from "next/link";
import { listPreparaciones } from "@/modules/preparaciones/application/list-preparaciones";

function fechaHora(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

const SECCIONES = [
  { estado: "INICIADA" as const, titulo: "En curso" },
  { estado: "CONFIRMADA" as const, titulo: "Confirmadas" },
  { estado: "DESCARTADA" as const, titulo: "Descartadas" },
];

export default async function PreparacionesPage() {
  const resultados = await Promise.all(SECCIONES.map((s) => listPreparaciones({ estado: s.estado, page: 1, pageSize: 20 })));

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">Preparaciones</h1>

      {SECCIONES.map((seccion, idx) => {
        const resultado = resultados[idx]!;
        return (
          <section key={seccion.estado} className="mb-8">
            <h2 className="mb-3 text-lg font-medium">
              {seccion.titulo} ({resultado.total})
            </h2>
            {resultado.items.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay preparaciones en este estado.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {resultado.items.map((p) => (
                  <Link
                    key={p.id}
                    href={`/preparaciones/${p.id}`}
                    className="rounded border border-zinc-200 p-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <p className="font-medium">
                      Receta Nº {p.recetaNumeroInterno} — {p.itemDescripcion ?? p.formaFarmaceutica} ({p.formaFarmaceutica})
                    </p>
                    <p className="text-xs text-zinc-500">
                      {p.pacienteApellido}, {p.pacienteNombre} — iniciada {fechaHora(p.iniciadaEn)}
                      {p.confirmadaEn ? ` — confirmada ${fechaHora(p.confirmadaEn)}` : ""}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
