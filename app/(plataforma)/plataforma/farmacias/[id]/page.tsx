/**
 * `/plataforma/farmacias/[id]` (openspec/changes/plataforma-superadmin P9, P11, P12): the pharmacy's datos, contacto,
 * estado and the platform's history of it. Reads only fsj.tenant and the platform tables (D11).
 */
import { notFound } from "next/navigation";
import { verFarmacia } from "@/modules/plataforma/application/ver-farmacia";
import { ACCION_PLATAFORMA_LABEL, ESTADO_FARMACIA_LABEL } from "@/modules/plataforma/domain/farmacia";
import { ContactoForm } from "@/modules/plataforma/ui/contacto-form";
import { EstadoFarmaciaAcciones } from "@/modules/plataforma/ui/estado-farmacia-acciones";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { uuid } from "@/shared/validation";

const ZONA_PLATAFORMA = "America/Argentina/Buenos_Aires";

interface FarmaciaPageProps {
  params: Promise<{ id: string }>;
}

export default async function FarmaciaPage({ params }: FarmaciaPageProps) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const detalle = await verFarmacia(id);
  if (!detalle) notFound();
  const { farmacia, historial } = detalle;
  const dadaDeBaja = farmacia.fechaBaja !== null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Farmacias", href: "/plataforma" }, { label: farmacia.razonSocial }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {farmacia.razonSocial}
            {dadaDeBaja ? (
              <ToneBadge tone="neutral">Dada de baja</ToneBadge>
            ) : (
              <ToneBadge tone={farmacia.estado === "ACTIVO" ? "success" : "danger"}>{ESTADO_FARMACIA_LABEL[farmacia.estado]}</ToneBadge>
            )}
          </span>
        }
        description={
          <>
            CUIT <span className="font-mono text-zinc-900">{farmacia.cuit}</span>
          </>
        }
      />

      <div className="split-layout">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="panel" aria-labelledby="datos-heading">
            <div className="panel-header">
              <h2 id="datos-heading">Datos</h2>
            </div>
            <div className="panel-body">
              <dl className="summary-dl">
                <dt>Nombre de fantasía</dt>
                <dd data-empty={farmacia.nombreFantasia ? undefined : ""}>{farmacia.nombreFantasia ?? "—"}</dd>
                <dt>Domicilio</dt>
                <dd data-empty={farmacia.domicilio ? undefined : ""}>{farmacia.domicilio ?? "—"}</dd>
                <dt>Matrícula</dt>
                <dd data-empty={farmacia.matriculaFarmacia ? undefined : ""}>{farmacia.matriculaFarmacia ?? "—"}</dd>
                <dt>Teléfonos</dt>
                <dd data-empty={farmacia.telefonoFijo || farmacia.telefonoCelular ? undefined : ""}>
                  {[farmacia.telefonoFijo, farmacia.telefonoCelular].filter(Boolean).join(" · ") || "—"}
                </dd>
                <dt>Zona horaria</dt>
                <dd>{farmacia.zonaHoraria}</dd>
                <dt>Alta</dt>
                <dd className="tabular-nums">{formatFecha(farmacia.creadoEn, ZONA_PLATAFORMA)}</dd>
                {farmacia.fechaBaja ? (
                  <>
                    <dt>Baja</dt>
                    <dd className="tabular-nums">{formatFecha(farmacia.fechaBaja, ZONA_PLATAFORMA)}</dd>
                  </>
                ) : null}
              </dl>
              <p className="field-help mt-3">Estos datos los mantiene el administrador de la farmacia desde Configuración › Farmacia.</p>
            </div>
          </section>

          <section className="panel" aria-labelledby="contacto-heading">
            <div className="panel-header">
              <h2 id="contacto-heading">Contacto</h2>
            </div>
            <div className="panel-body">
              <ContactoForm
                id={farmacia.id}
                valores={{ contactoNombre: farmacia.contactoNombre, contactoEmail: farmacia.contactoEmail, contactoTelefono: farmacia.contactoTelefono }}
              />
            </div>
          </section>

          <section className="panel" aria-labelledby="historial-heading">
            <div className="panel-header">
              <h2 id="historial-heading">Historial en la plataforma</h2>
            </div>
            <div className="panel-body">
              {historial.length === 0 ? (
                <p className="text-[0.8125rem] text-zinc-600">Sin movimientos.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {historial.map((evento) => (
                    <li key={evento.id} className="text-[0.8125rem]">
                      <span className="font-medium text-zinc-900">{ACCION_PLATAFORMA_LABEL[evento.accion] ?? evento.accion}</span>
                      <span className="text-zinc-500">
                        {" "}
                        · {formatFechaHora(evento.ocurridoEn, ZONA_PLATAFORMA)} · {evento.superadmin}
                      </span>
                      {evento.motivo ? <span className="block text-zinc-600">{evento.motivo}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        <aside className="split-aside" aria-label="Estado de la farmacia">
          <section className="panel" aria-labelledby="estado-heading">
            <div className="panel-header">
              <h2 id="estado-heading">Estado</h2>
            </div>
            <div className="panel-body flex flex-col gap-3">
              {dadaDeBaja ? (
                <p className="text-[0.8125rem] text-zinc-600">Dada de baja: no se puede suspender ni reactivar desde el panel.</p>
              ) : (
                <>
                  <p className="text-[0.8125rem] text-zinc-600">
                    {farmacia.estado === "ACTIVO"
                      ? "Activa: sus usuarios trabajan con normalidad."
                      : "Suspendida: nadie puede iniciar sesión. Sus datos se conservan y los plazos legales siguen corriendo."}
                  </p>
                  <EstadoFarmaciaAcciones id={farmacia.id} estado={farmacia.estado} />
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
