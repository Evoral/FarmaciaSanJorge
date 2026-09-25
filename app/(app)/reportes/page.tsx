/**
 * `/reportes` (FASE 13 point 13.1/13.4, user decision 5). Hub listing every
 * report the session can access -- each entry gated by the SAME permiso its
 * target page/query enforces, no hardcoded per-role list. ADM deliberately
 * has no `reportes.ver` (no patient data), so it sees only the
 * usuarios/auditoría entries it already has permisos for.
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

interface ReporteEntry {
  href: string;
  titulo: string;
  descripcion: string;
}

export default async function ReportesPage() {
  const session = await requireSession();

  const entries: ReporteEntry[] = [];
  if (can(session, "reportes.ver")) {
    entries.push({ href: "/reportes/recetas", titulo: "Recetas por estado", descripcion: "Conteos por estado y listado filtrado por fecha de ingreso." });
  }
  if (can(session, "stock.valorizado.ver")) {
    entries.push({ href: "/reportes/stock-valorizado", titulo: "Stock valorizado", descripcion: "Valorizado al costo actual de cada partida, con subtotales por droga." });
  }
  if (can(session, "stock.ver")) {
    entries.push({ href: "/reportes/kardex", titulo: "Kardex de movimientos", descripcion: "Movimientos de stock filtrables por droga, tipo y rango de fechas." });
  }
  if (can(session, "cierres.reporte")) {
    entries.push({ href: "/cierres/reporte", titulo: "Cumplimiento de firma de cierres", descripcion: "Demora, fuera de término y motivo por jornada firmada." });
  }
  if (can(session, "reportes.auditoria") || can(session, "auditoria.ver")) {
    entries.push({ href: "/auditoria", titulo: "Auditoría", descripcion: "Registro de acciones auditadas del tenant." });
  }
  if (can(session, "reportes.usuarios") || can(session, "usuarios.listar")) {
    entries.push({ href: "/admin/usuarios", titulo: "Usuarios", descripcion: "Listado de usuarios, estados y roles." });
  }

  return (
    <div className="page">
      <h1 className="mb-6 text-2xl font-semibold">Reportes</h1>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No tenés permisos para ver ningún reporte.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="card p-4 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600"
            >
              <p className="font-medium">{entry.titulo}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{entry.descripcion}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
