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
