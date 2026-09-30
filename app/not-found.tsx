/**
 * Root 404 (unmatched URLs and every `notFound()` without a closer
 * not-found file): Spanish copy instead of Next's default English page.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <p className="text-zinc-600">La página que buscás no existe o ya no está disponible.</p>
      <div>
        <Link href="/" className="btn btn-primary">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
