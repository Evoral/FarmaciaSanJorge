/**
 * `/costos-proveedor/importar` -- "Importar lista" (docs/specs/costos-proveedor.md, "Interface" 2, R13-R23): pick
 * the proveedor, the date of the list and the .xls or .xlsx; review the preview; confirm. Nothing is saved before the
 * confirmation, and the file is read in memory and never stored.
 *
 * Needs `costos.proveedor.gestionar` (R36) on top of the layout's `stock.valorizado.ver`; the two use cases check it
 * again. The pickers read the existing catalogs (`listDrogasOpciones`, `listProveedoresOpciones`, the unit catalog),
 * which have their own permisos: when the session lacks one the page says so instead of failing (same as
 * `/costos-proveedor/nuevo`). The jornada actual comes from the vigentes query, the way that page gets it.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { listarCostosVigentes } from "@/modules/costos-proveedor/application/listar-costos-vigentes";
import { CostosTabs } from "@/modules/costos-proveedor/ui/costos-tabs";
import { ImportarLista } from "@/modules/costos-proveedor/ui/importar-lista";
import { listDrogasOpciones } from "@/modules/drogas/application/list-drogas-opciones";
import { listProveedoresOpciones } from "@/modules/proveedores/application/list-proveedores-opciones";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { can } from "@/shared/auth/authorize";
import type { Permiso } from "@/shared/auth/authorize";
import { requireSession } from "@/shared/auth/session";
import { PageHeader } from "@/shared/ui/page-header";

/** What the import reads, and the permiso of each existing catalog query (so a session without one gets a message, not an error page). */
const CATALOGOS_DE_LA_IMPORTACION: readonly { permiso: Permiso; nombre: string }[] = [
  { permiso: "drogas.editar", nombre: "el catálogo de drogas" },
  { permiso: "proveedores.gestionar", nombre: "el catálogo de proveedores" },
  { permiso: "stock.ver", nombre: "las unidades de medida" },
];

export default async function ImportarListaPage() {
  const session = await requireSession();
  if (!can(session, "costos.proveedor.gestionar")) redirect("/costos-proveedor");

  const migas = [{ label: "Inicio", href: "/" }, { label: "Costos de proveedores", href: "/costos-proveedor" }, { label: "Importar lista" }];
  const cabecera = (
    <PageHeader
      breadcrumbs={migas}
      title="Importar lista de precios"
      description="Cargá de una vez los precios de la lista de un proveedor: revisás qué se va a actualizar antes de confirmar. Los precios son sin IVA y se usan solo para cotizar."
    />
  );

  const sinAcceso = CATALOGOS_DE_LA_IMPORTACION.filter((catalogo) => !can(session, catalogo.permiso));
  if (sinAcceso.length > 0) {
    return (
      <>
        {cabecera}
        <CostosTabs activa="importar" puedeGestionar />
        <p role="alert" className="alert alert-warn max-w-3xl">
          <CircleAlert aria-hidden />
          <span>
            Para importar una lista también necesitás permiso para ver {sinAcceso.map((catalogo) => catalogo.nombre).join(" y ")}. Pedile a quien administra los accesos que te lo
            habilite.{" "}
            <Link href="/costos-proveedor" className="underline">
              Volver a los costos
            </Link>
          </span>
        </p>
      </>
    );
  }

  const [drogas, proveedores, { unidades }, contexto] = await Promise.all([
    listDrogasOpciones(),
    listProveedoresOpciones(),
    getCatalogoUnidades(),
    listarCostosVigentes({ page: 1, pageSize: 1 }),
  ]);

  return (
    <>
      {cabecera}
      <CostosTabs activa="importar" puedeGestionar />
      <ImportarLista
        proveedores={proveedores}
        drogas={drogas.map((d) => ({ id: d.id, nombre: d.nombre, unidadBaseId: d.unidadBaseId, tipoMagnitud: d.tipoMagnitud, sinonimos: d.sinonimos }))}
        unidades={unidades.map((u) => ({ id: u.id, codigo: u.codigo, simbolo: u.simbolo, tipoMagnitud: u.tipoMagnitud, factorABase: u.factorABase, vigente: u.vigente }))}
        jornadaActual={contexto.jornadaActual}
      />
    </>
  );
}
