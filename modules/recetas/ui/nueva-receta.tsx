"use client";

/**
 * `/recetas/nuevo`: the manual receta form plus the two imports, "Importar
 * desde PDF" and "Importar con QR". Whichever reads a receta swaps the manual
 * form for the SAME RecetaForm in `importar` mode, prefilled with the preview;
 * discarding it goes back to the manual form. Only one import is active at a
 * time: reading another one replaces the previous. Each new reading remounts
 * the form (`key`), so no state from a previous receta survives. A successful
 * reading also remounts the OTHER panel (its `key` carries the other source's
 * reading count), which drops that panel's stale error; the active panel is
 * never remounted by its own reading.
 */
import { useState } from "react";
import { ImportarRecetaPdf } from "./importar-receta-pdf";
import { ImportarRecetaQr } from "./importar-receta-qr";
import { RecetaForm } from "./receta-form";
import type { FuenteImportacion, VistaPreviaImportacion } from "../domain/importacion-receta";
import type { UnidadOpcion } from "../infrastructure/receta-repository";

export function NuevaReceta({ unidades, puedePresupuestar }: { unidades: UnidadOpcion[]; puedePresupuestar: boolean }) {
  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaImportacion | null>(null);
  const [lecturas, setLecturas] = useState<Record<FuenteImportacion, number>>({ PDF: 0, QR: 0 });

  const onLeida = (vista: VistaPreviaImportacion) => {
    setVistaPrevia(vista);
    setLecturas((n) => ({ ...n, [vista.fuente]: n[vista.fuente] + 1 }));
  };
  const onDescartar = () => setVistaPrevia(null);
  const totalLecturas = lecturas.PDF + lecturas.QR;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <ImportarRecetaPdf key={`pdf-${lecturas.QR}`} importando={vistaPrevia?.fuente === "PDF"} onLeida={onLeida} onDescartar={onDescartar} />
        <ImportarRecetaQr key={`qr-${lecturas.PDF}`} importando={vistaPrevia?.fuente === "QR"} onLeida={onLeida} onDescartar={onDescartar} autoEnfocar={totalLecturas === 0} />
      </div>
      {vistaPrevia ? (
        <RecetaForm key={totalLecturas} mode="importar" vistaPrevia={vistaPrevia} unidades={unidades} disabled={false} puedePresupuestar={puedePresupuestar} />
      ) : (
        <RecetaForm mode="crear" unidades={unidades} disabled={false} puedePresupuestar={puedePresupuestar} />
      )}
    </div>
  );
}
