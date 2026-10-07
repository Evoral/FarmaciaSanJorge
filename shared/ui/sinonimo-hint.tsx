/**
 * The deliberately quiet hint shown after a droga's canonical name when a
 * search matched it through one of its synonyms (docs/specs/sinonimos-droga.md):
 * "Vaselina sólida ≈ petrolato". Muted, small, no badge, no color -- the
 * canonical name stays the thing the user reads and picks. Render nothing
 * when the name itself matched.
 */
export function SinonimoHint({ sinonimo }: { sinonimo?: string | null }) {
  if (!sinonimo) return null;
  return (
    <span className="ml-1.5 text-xs font-normal text-zinc-400" title="Sinónimo">
      <span aria-hidden>≈ {sinonimo}</span>
      <span className="sr-only">, también conocido como {sinonimo}</span>
    </span>
  );
}

/**
 * The reverse hint, for a droga PICKED through one of its synonyms
 * (docs/specs/sinonimos-droga.md, "Nombre elegido al cargar"): the synonym
 * the user chose is the main text and the canonical name follows, just as
 * quiet: "Acetaminofén ≈ Paracetamol". Render nothing without a name.
 */
export function NombrePrincipalHint({ nombre }: { nombre?: string | null }) {
  if (!nombre) return null;
  return (
    <span className="ml-1.5 text-xs font-normal text-zinc-400" title={`Nombre principal: ${nombre}`}>
      <span aria-hidden>≈ {nombre}</span>
      <span className="sr-only">, nombre principal: {nombre}</span>
    </span>
  );
}
