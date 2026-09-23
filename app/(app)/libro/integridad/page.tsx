/** `/libro/integridad` (FASE 9, M12 point 9.3). Verificación de la cadena de hash del libro recetario y de cada libro contralor. */
import Link from "next/link";
import { verificarCadenaLibros } from "@/modules/libro/application/verificar-cadena-libros";

const TIPO_LABELS: Record<string, string> = {
  RECETARIO: "Libro recetario",
  PSICOTROPICO: "Libro contralor -- psicotrópicos",
  ESTUPEFACIENTE: "Libro contralor -- estupefacientes",
};

export default async function IntegridadPage() {
  const resultados = await verificarCadenaLibros();

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link href="/libro" className="text-sm underline">
          ← Volver al libro recetario
        </Link>
      </div>

      <h1 className="mb-6 text-xl font-semibold">Verificación de integridad</h1>

      <div className="flex flex-col gap-3">
        {resultados.map((r) => (
          <div key={r.libroId} className={`rounded border p-4 text-sm ${r.ok ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950" : "border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-950"}`}>
            <p className="font-medium">{TIPO_LABELS[r.tipo] ?? r.tipo}</p>
            <p>{r.ok ? "OK -- la cadena de hash está intacta." : `Primer quiebre en el asiento Nº ${r.primerQuiebreNumero}.`}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
