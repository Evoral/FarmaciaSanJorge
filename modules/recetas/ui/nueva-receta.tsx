"use client";

/**
 * `/recetas/nuevo`: the manual receta form plus "Importar desde PDF". A
 * read PDF swaps the manual form for the SAME RecetaForm in `importar`
 * mode, prefilled with the preview; discarding it goes back to the manual
 * form. Each new reading remounts the form (`key`), so no state from a
 * previous PDF survives.
 */
import { useState } from "react";
import { ImportarRecetaPdf } from "./importar-receta-pdf";
import { RecetaForm } from "./receta-form";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import type { UnidadOpcion } from "../infrastructure/receta-repository";

export function NuevaReceta({ unidades, puedePresupuestar }: { unidades: UnidadOpcion[]; puedePresupuestar: boolean }) {
  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaImportacion | null>(null);
  const [lecturas, setLecturas] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <ImportarRecetaPdf
        importando={vistaPrevia !== null}
        onLeida={(vista) => {
          setVistaPrevia(vista);
          setLecturas((n) => n + 1);
        }}
        onDescartar={() => setVistaPrevia(null)}
      />
      {vistaPrevia ? (
        <RecetaForm key={lecturas} mode="importar" vistaPrevia={vistaPrevia} unidades={unidades} disabled={false} puedePresupuestar={puedePresupuestar} />
      ) : (
        <RecetaForm mode="crear" unidades={unidades} disabled={false} puedePresupuestar={puedePresupuestar} />
      )}
    </div>
  );
}
