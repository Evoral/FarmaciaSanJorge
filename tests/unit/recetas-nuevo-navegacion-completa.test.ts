/**
 * Guard for the camera of the QR import: Permissions-Policy is fixed per document
 * load, so a SOFT navigation (`<Link>`, `router.push`) to `/recetas/nuevo` keeps the
 * `camera=()` of the page it started from and the scanner could never open the camera
 * (next.config.ts, docs/specs/importacion-receta-qr.md). Every way into that route must
 * be a full load: a plain `<a href>`, a redirect or `window.location`. This reads the
 * sources because the failure is silent at runtime: the link works, only the camera does not.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const CARPETAS = ["app", "modules", "shared"];
const RUTA = "/recetas/nuevo";

function archivosFuente(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) return archivosFuente(ruta);
    return /\.tsx?$/.test(entrada.name) ? [ruta] : [];
  });
}

const fuentes = CARPETAS.flatMap((c) => archivosFuente(path.join(RAIZ, c))).map((archivo) => ({
  archivo: path.relative(RAIZ, archivo).replaceAll("\\", "/"),
  texto: readFileSync(archivo, "utf8"),
}));

/** `<Link ... href="/recetas/nuevo"` (any attribute order, any whitespace) or a router call with that route. */
const NAVEGACION_SUAVE = new RegExp(`<Link\\b[^>]*["'\`{]${RUTA}["'\`}]|\\b(?:push|replace|prefetch)\\(\\s*["'\`]${RUTA}`);

describe("every entry into /recetas/nuevo is a full page load", () => {
  it("the scan reads the sources and finds the route's real entry points (it is not vacuous)", () => {
    const conLaRuta = fuentes.filter((f) => f.texto.includes(RUTA)).map((f) => f.archivo);
    expect(fuentes.length).toBeGreaterThan(100);
    expect(conLaRuta).toContain("app/(app)/recetas/page.tsx");
  });

  it("no <Link> and no router call points at /recetas/nuevo", () => {
    expect(fuentes.filter((f) => NAVEGACION_SUAVE.test(f.texto)).map((f) => f.archivo)).toEqual([]);
  });

  it("the guard itself recognizes the soft forms it forbids", () => {
    expect(NAVEGACION_SUAVE.test(`<Link href="${RUTA}" className="btn">`)).toBe(true);
    expect(NAVEGACION_SUAVE.test(`<Link\n  className="btn"\n  href='${RUTA}'\n>`)).toBe(true);
    expect(NAVEGACION_SUAVE.test(`router.push("${RUTA}")`)).toBe(true);
    expect(NAVEGACION_SUAVE.test(`<a href="${RUTA}" className="btn">`)).toBe(false);
  });
});
