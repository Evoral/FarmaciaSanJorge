"use client";

/**
 * `/stock/ingresar`: "Importar factura" plus the invoice form. Without a PDF
 * the form is empty (manual mode: the invoice is typed by hand, lote by
 * lote); a read invoice swaps it for the same form prefilled with the
 * preview, and discarding it -- or confirming it -- goes back to the manual
 * one. Each new reading remounts the form (`key`), so no state from a
 * previous PDF survives. Same shape as modules/recetas/ui/nueva-receta.tsx.
 */
import { useState } from "react";
import { ImportarFacturaPdf } from "./importar-factura-pdf";
import { ImportarFacturaForm, VISTA_PREVIA_MANUAL, type ImportarFacturaFormProps } from "./importar-factura-form";
import type { VistaPreviaFactura } from "../domain/importacion-factura-compra";

export function IngresarPartida(props: Pick<ImportarFacturaFormProps, "drogas" | "proveedores" | "unidades" | "puedeCrearProducto">) {
  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaFactura | null>(null);
  const [lecturas, setLecturas] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <ImportarFacturaPdf
        importando={vistaPrevia !== null}
        onLeida={(vista) => {
          setVistaPrevia(vista);
          setLecturas((n) => n + 1);
        }}
        onDescartar={() => setVistaPrevia(null)}
      />
      <div className="panel">
        <div className="panel-body">
          {vistaPrevia ? (
            <ImportarFacturaForm key={lecturas} vistaPrevia={vistaPrevia} {...props} onImportada={() => setVistaPrevia(null)} />
          ) : (
            <ImportarFacturaForm key="manual" vistaPrevia={VISTA_PREVIA_MANUAL} manual {...props} onImportada={() => {}} />
          )}
        </div>
      </div>
    </div>
  );
}
