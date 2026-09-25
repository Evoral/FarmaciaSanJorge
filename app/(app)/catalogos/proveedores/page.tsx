/** `/catalogos/proveedores` (M06, FASE 4 point 4.3). Search + vigente/baja filter, plain GET query params. */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listProveedores } from "@/modules/proveedores/application/list-proveedores";
import { ProveedorForm } from "@/modules/proveedores/ui/proveedor-form";
import { formatCuit } from "@/modules/proveedores/domain/proveedor";

const PAGE_SIZE = 20;

interface ProveedoresPageProps {
  searchParams: Promise<{ q?: string; estado?: string; page?: string; nuevo?: string }>;
}

export default async function ProveedoresPage({ searchParams }: ProveedoresPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const result = await listProveedores({ search: params.q, soloVigentes, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeCrear = can(session, "proveedores.gestionar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/catalogos/proveedores?${qs.toString()}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Proveedores</h1>
        {puedeCrear ? (
          <Link href="/catalogos/proveedores?nuevo=1" className="btn btn-primary">
            Nuevo proveedor
          </Link>
        ) : null}
      </div>

      {puedeCrear && params.nuevo ? (
        <div className="mb-6">
          <ProveedorForm mode="crear" disabled={!puedeCrear} />
        </div>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de búsqueda de proveedores">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar
          </label>
          <input id="q" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Razón social o CUIT" className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
            <option value="">Todos</option>
            <option value="vigente">Vigentes</option>
            <option value="baja">Dados de baja</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
        {params.q || params.estado ? (
          <Link href="/catalogos/proveedores" className="text-sm underline">
            Limpiar filtros
          </Link>
        ) : null}
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} proveedor{result.total === 1 ? "" : "es"} encontrado{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Razón social</th>
              <th scope="col" className="px-3 py-2 font-medium">CUIT</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron proveedores con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((proveedor) => (
                <tr key={proveedor.id}>
                  <td className="px-3 py-2">
                    <Link href={`/catalogos/proveedores/${proveedor.id}`} className="font-medium underline-offset-2 hover:underline">
                      {proveedor.razonSocial}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{formatCuit(proveedor.cuit)}</td>
                  <td className="px-3 py-2">{proveedor.fechaBaja ? "Baja" : "Vigente"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de proveedores" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link href={pageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}>
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
