/** `/libro/integridad` (FASE 9, M12 point 9.3). Verificación de la cadena de hash del libro recetario y de cada libro contralor. */
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { verificarCadenaLibros } from "@/modules/libro/application/verificar-cadena-libros";
import { LibroNav } from "@/modules/libro/ui/libro-nav";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

const TIPO_LABELS: Record<string, string> = {
  RECETARIO: "Libro recetario",
  PSICOTROPICO: "Libro contralor de psicotrópicos",
  ESTUPEFACIENTE: "Libro contralor de estupefacientes",
};

export default async function IntegridadPage() {
  const resultados = await verificarCadenaLibros();
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
              <p className="text-sm font-medium text-zinc-900">{TIPO_LABELS[r.tipo] ?? r.tipo}</p>
              <p className="text-[0.8125rem] text-zinc-600">{r.ok ? "La cadena de hash está intacta." : `Primer quiebre en el asiento Nº ${r.primerQuiebreNumero}.`}</p>
            </div>
            <ToneBadge tone={r.ok ? "success" : "danger"}>{r.ok ? "OK" : "Quebrada"}</ToneBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}
