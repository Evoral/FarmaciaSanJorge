"use client";

/**
 * `/stock/ingresar`: "Importar factura" plus the manual partida form. A read
 * invoice swaps the manual form for the import form, prefilled with the
 * preview; discarding it -- or confirming it -- goes back to the manual
 * form. Each new reading remounts the import form (`key`), so no state from
 * a previous PDF survives. Same shape as modules/recetas/ui/nueva-receta.tsx.
 */
import { useState } from "react";
import { ImportarFacturaPdf } from "./importar-factura-pdf";
import { ImportarFacturaForm } from "./importar-factura-form";
import { IngresarPartidaForm, type IngresarPartidaFormProps } from "./ingresar-partida-form";
import type { VistaPreviaFactura } from "../domain/importacion-factura-compra";

export function IngresarPartida({ puedeCrearProducto, ...props }: IngresarPartidaFormProps & { puedeCrearProducto: boolean }) {
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
            <ImportarFacturaForm key={lecturas} vistaPrevia={vistaPrevia} {...props} puedeCrearProducto={puedeCrearProducto} onImportada={() => setVistaPrevia(null)} />
          ) : (
            <IngresarPartidaForm {...props} />
          )}
        </div>
      </div>
    </div>
  );
}
