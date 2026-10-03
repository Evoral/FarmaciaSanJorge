/**
 * Initials avatar for a person's name ("Lucía Aguirre" or "Aguirre, Lucía"
 * -> "LA"). Decorative: the name is always printed next to it.
 */
function iniciales(nombre: string): string {
  const ordenado = nombre.includes(",") ? nombre.split(",").reverse().join(" ") : nombre;
  const partes = ordenado.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primera = partes[0].charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : "";
  return `${primera}${ultima}`.toUpperCase();
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden>
      {iniciales(name)}
    </span>
  );
}
