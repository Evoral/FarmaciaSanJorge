"use client";

/**
 * `/recetas/nuevo`: the manual receta form plus the two imports, "Importar
 * desde PDF" and "Importar con QR". Whichever reads a receta swaps the manual
 * form for the SAME RecetaForm in `importar` mode, prefilled with the preview;
 * discarding it goes back to the manual form. Only one import is active at a
 * time: reading another one replaces the previous. Each new reading remounts
 * the form (`key`), so no state from a previous receta survives.
 */
import { useState } from "react";
import { ImportarRecetaPdf } from "./importar-receta-pdf";
import { ImportarRecetaQr } from "./importar-receta-qr";
import { RecetaForm } from "./receta-form";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import type { UnidadOpcion } from "../infrastructure/receta-repository";

export function NuevaReceta({ unidades, puedePresupuestar }: { unidades: UnidadOpcion[]; puedePresupuestar: boolean }) {
  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaImportacion | null>(null);
  const [lecturas, setLecturas] = useState(0);

  const onLeida = (vista: VistaPreviaImportacion) => {
    setVistaPrevia(vista);
    setLecturas((n) => n + 1);
  };
  const onDescartar = () => setVistaPrevia(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <ImportarRecetaPdf importando={vistaPrevia?.fuente === "PDF"} onLeida={onLeida} onDescartar={onDescartar} />
        <ImportarRecetaQr importando={vistaPrevia?.fuente === "QR"} onLeida={onLeida} onDescartar={onDescartar} />
      </div>
      {vistaPrevia ? (
        <RecetaForm key={lecturas} mode="importar" vistaPrevia={vistaPrevia} unidades={unidades} disabled={false} puedePresupuestar={puedePresupuestar} />
      ) : (
        <RecetaForm mode="crear" unidades={unidades} disabled={false} puedePresupuestar={puedePresupuestar} />
      )}
    </div>
  );
}
