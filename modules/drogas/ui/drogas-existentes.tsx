"use client";

/**
 * Live duplicate check for the droga alta (docs/specs/sinonimos-droga.md):
 * while a name is typed, the drogas that already answer to it -- by name or
 * by a vigente synonym, accents and case ignored -- are looked up and shown,
 * so the same substance is not created twice under another spelling. The
 * command re-checks on submit; this only warns early.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { SinonimoHint } from "@/shared/ui/sinonimo-hint";
import { normalizarTexto } from "../domain/normalizar";
import { buscarDrogasExistentesAction, type DrogaExistente } from "./buscar-drogas-catalogo-action";

const DEBOUNCE_MS = 250;
const MIN_CARACTERES = 3;

/** Drogas matching `texto` (substring of a name or synonym); empty while fewer than 3 characters are typed. */
export function useDrogasExistentes(texto: string): DrogaExistente[] {
  const consulta = texto.trim();
  const [resultado, setResultado] = useState<{ consulta: string; drogas: DrogaExistente[] } | null>(null);

  useEffect(() => {
    if (normalizarTexto(consulta).length < MIN_CARACTERES) return;
    let vigente = true;
    const timer = setTimeout(() => {
      buscarDrogasExistentesAction(consulta)
        .then((drogas) => {
          if (vigente) setResultado({ consulta, drogas });
        })
        .catch(() => {
          // Only a warning: a failed lookup must not block the form (the command still checks on submit).
          if (vigente) setResultado({ consulta, drogas: [] });
        });
    }, DEBOUNCE_MS);
    return () => {
      vigente = false;
      clearTimeout(timer);
    };
  }, [consulta]);

  return resultado !== null && resultado.consulta === consulta ? resultado.drogas : [];
}

/** The droga whose name or synonym IS `texto` after normalization, if any. */
export function coincidenciaExacta(texto: string, drogas: readonly DrogaExistente[]): DrogaExistente | undefined {
  const normalizado = normalizarTexto(texto);
  if (normalizado.length === 0) return undefined;
  return drogas.find((d) => normalizarTexto(d.nombre) === normalizado || d.sinonimos.some((s) => normalizarTexto(s) === normalizado));
}

function DrogaLink({ droga }: { droga: DrogaExistente }) {
  // New tab: following the link must not lose what is typed in the alta form.
  return (
    <Link href={`/catalogos/drogas/${droga.id}`} target="_blank" rel="noopener" className="font-medium text-zinc-900 underline-offset-2 hover:underline">
      {droga.nombre}
    </Link>
  );
}

/** Under the alta's name field: the exact match (blocking when vigente) or the similar drogas to review. */
export function DrogasExistentesAviso({ id, texto, drogas }: { id: string; texto: string; drogas: readonly DrogaExistente[] }) {
  if (drogas.length === 0) return null;
  const exacta = coincidenciaExacta(texto, drogas);
  const otras = drogas.filter((d) => d !== exacta);

  return (
    <div id={id} role="status" aria-live="polite" className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.8125rem]">
      {exacta ? (
        <p className={exacta.baja ? "text-zinc-700" : "font-medium text-red-700"}>
          {exacta.baja ? (
            <>
              Existe dada de baja: <DrogaLink droga={exacta} />. Reactivala en lugar de crearla de nuevo.
            </>
          ) : (
            <>
              Ya existe: <DrogaLink droga={exacta} />
              <SinonimoHint sinonimo={normalizarTexto(exacta.nombre) === normalizarTexto(texto) ? null : texto.trim()} />. Si es otro nombre de la misma droga, agregalo en
              sus «Otros nombres».
            </>
          )}
        </p>
      ) : (
        <p className="text-zinc-600">Ya hay drogas con un nombre parecido. Revisá que no sea la misma:</p>
      )}
      {otras.length > 0 ? (
        <ul className={`flex flex-col gap-0.5 ${exacta ? "mt-1.5 text-zinc-600" : "mt-1"}`}>
          {otras.map((droga) => (
            <li key={droga.id}>
              <DrogaLink droga={droga} />
              <SinonimoHint sinonimo={droga.sinonimoCoincidente} />
              {droga.baja ? <span className="ml-1.5 text-xs text-zinc-400">(baja)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
