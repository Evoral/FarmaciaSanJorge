"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * "Imprimir hoja" link: opens the jornada's sheet (`/api/cierres/[id]/pdf`) in a new tab and then refreshes this page,
 * so it never keeps a stale "Sin imprimir" / disabled next day. The PDF route marks the impresión in the same request
 * that renders the sheet, so this page fetches the PDF itself and refreshes once the response arrives -- no guessing
 * how long the other tab takes. The tab is opened synchronously on the click (popup blockers allow it) and receives
 * the PDF when it is ready. If the tab cannot be opened, the plain link opens the sheet and the page refreshes when
 * the user comes back to it.
 */
export function ImprimirHojaLink({ cierreId, className, children }: { cierreId: string; className: string; children: ReactNode }) {
  const router = useRouter();
  const href = `/api/cierres/${cierreId}/pdf`;

  function imprimir(event: MouseEvent<HTMLAnchorElement>) {
    const pestana = window.open("", "_blank");
    if (!pestana) {
      window.addEventListener("focus", () => router.refresh(), { once: true });
      return;
    }
    event.preventDefault();
    pestana.document.title = "Generando hoja…";
    pestana.document.body.textContent = "Generando la hoja del libro…";

    fetch(href, { cache: "no-store" })
      .then(async (response) => {
        // An error (permiso, print order...) is shown by the route itself, as with the plain link.
        if (!response.ok) {
          pestana.location.href = href;
          return;
        }
        pestana.location.href = URL.createObjectURL(await response.blob());
      })
      .catch(() => {
        pestana.location.href = href;
      })
      .finally(() => router.refresh());
  }

  return (
    <a href={href} target="_blank" rel="noopener" className={className} onClick={imprimir}>
      {children}
    </a>
  );
}
