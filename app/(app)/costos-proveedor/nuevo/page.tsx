/**
 * `/costos-proveedor/nuevo` -- manual entry of a costo de proveedor (openspec/specs/
 * costos-proveedor/spec.md R24): add a price for a (droga, proveedor) pair or change the vigente one.
 * "Editar" and "Cambiar el precio" open it with `?droga=&proveedor=` (opaque uuids): the pair is
 * fixed and the vigente costo prefills the form. The pair, not a costo id, identifies the entry:
 * saving replaces the vigente version, so an id would be stale right after.
 *
 * Needs `costos.proveedor.gestionar` (R36) on top of the layout's `stock.valorizado.ver`; the
 * command checks it again. The pickers read the existing catalogs (`listDrogasOpciones`,
 * `listProveedoresOpciones`, the unit catalog), which have their own permisos: when the session
 * lacks one the page says so instead of failing.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { listarCostosVigentes } from "@/modules/costos-proveedor/application/listar-costos-vigentes";
import { CostoForm } from "@/modules/costos-proveedor/ui/costo-form";
import type { CostoVigenteResumen } from "@/modules/costos-proveedor/ui/action-state";
import { listDrogasOpciones } from "@/modules/drogas/application/list-drogas-opciones";
import { listProveedoresOpciones } from "@/modules/proveedores/application/list-proveedores-opciones";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { can } from "@/shared/auth/authorize";
import type { Permiso } from "@/shared/auth/authorize";
import { requireSession } from "@/shared/auth/session";
import { PageHeader } from "@/shared/ui/page-header";
import { uuid } from "@/shared/validation";

interface NuevoCostoPageProps {
  searchParams: Promise<{ droga?: string | string[]; proveedor?: string | string[] }>;
}

/** What the pickers read, and the permiso of each existing catalog query (so a session without one gets a message, not an error page). */
const CATALOGOS_DEL_FORMULARIO: readonly { permiso: Permiso; nombre: string }[] = [
  { permiso: "drogas.editar", nombre: "el catálogo de drogas" },
  { permiso: "proveedores.gestionar", nombre: "el catálogo de proveedores" },
  { permiso: "stock.ver", nombre: "las unidades de medida" },
];

function idValido(valor: string | string[] | undefined): string | undefined {
  const candidato = Array.isArray(valor) ? valor[0] : valor;
  return candidato !== undefined && uuid.safeParse(candidato).success ? candidato : undefined;
}

export default async function NuevoCostoPage({ searchParams }: NuevoCostoPageProps) {
  const session = await requireSession();
  if (!can(session, "costos.proveedor.gestionar")) redirect("/costos-proveedor");

  const query = await searchParams;
  const drogaId = idValido(query.droga);
  const proveedorId = idValido(query.proveedor);
  const migas = [{ label: "Inicio", href: "/" }, { label: "Costos de proveedores", href: "/costos-proveedor" }];

  const sinAcceso = CATALOGOS_DEL_FORMULARIO.filter((catalogo) => !can(session, catalogo.permiso));
  if (sinAcceso.length > 0) {
    return (
      <>
        <PageHeader breadcrumbs={[...migas, { label: "Agregar costo" }]} title="Agregar costo" />
        <p role="alert" className="alert alert-warn max-w-3xl">
          <CircleAlert aria-hidden />
          <span>
            Para cargar un costo a mano también necesitás permiso para ver {sinAcceso.map((catalogo) => catalogo.nombre).join(" y ")}. Pedile a quien administra los accesos que
            te lo habilite.{" "}
            <Link href="/costos-proveedor" className="underline">
              Volver a los costos
            </Link>
          </span>
        </p>
      </>
    );
  }

  const [drogas, proveedores, { unidades }] = await Promise.all([listDrogasOpciones(), listProveedoresOpciones(), getCatalogoUnidades()]);
  // Only drogas and proveedores that can still receive a costo (R12: the option lists leave the ones de baja out).
  const droga = drogas.find((d) => d.id === drogaId) ?? null;
  const proveedor = proveedores.find((p) => p.id === proveedorId) ?? null;

  // With BOTH filters the single result is the vigente costo of the pair (R1).
  const contexto = await listarCostosVigentes({ drogaId: droga?.id, proveedorId: proveedor?.id, page: 1, pageSize: 1 });
  const fila = droga && proveedor ? contexto.items[0] : undefined;
  const vigente: CostoVigenteResumen | null = fila
    ? {
        id: fila.id,
        precioInformado: fila.precioInformado,
        unidadPrecioId: fila.unidadPrecioId,
        unidadPrecioSimbolo: fila.unidadPrecioSimbolo,
        costoUnitario: fila.costoUnitario,
        alicuotaIva: fila.alicuotaIva,
        precioInformadoConIva: fila.precioInformadoConIva,
        fechaPrecio: fila.fechaPrecio,
        listaNombreArchivo: fila.listaNombreArchivo,
      }
    : null;
  const parElegido = droga !== null && proveedor !== null;
  const titulo = vigente ? "Cambiar el precio" : "Agregar costo";

  return (
    <>
      <PageHeader
        breadcrumbs={[...migas, { label: titulo }]}
        title={titulo}
        description={
          parElegido
            ? `${droga.nombre} · ${proveedor.razonSocial}`
            : "Cargá el precio de referencia que un proveedor informó para una droga. Si ya había uno, queda en el historial como valor anterior."
        }
      />

      <section aria-label={titulo} className="panel max-w-3xl">
        <div className="panel-body">
          <CostoForm
            drogas={drogas.map((d) => ({ id: d.id, nombre: d.nombre, unidadBaseId: d.unidadBaseId, tipoMagnitud: d.tipoMagnitud, sinonimos: d.sinonimos }))}
            proveedores={proveedores}
            unidades={unidades.map((u) => ({ id: u.id, codigo: u.codigo, simbolo: u.simbolo, tipoMagnitud: u.tipoMagnitud, factorABase: u.factorABase, vigente: u.vigente }))}
            jornadaActual={contexto.jornadaActual}
            alicuotaIvaPorDefecto={contexto.alicuotaIvaPorDefecto}
            inicial={{
              droga: parElegido ? { id: droga.id, nombre: droga.nombre } : null,
              proveedor: parElegido ? { id: proveedor.id, razonSocial: proveedor.razonSocial } : null,
              vigente,
            }}
          />
        </div>
      </section>
    </>
  );
}
