"use client";

/**
 * Idle watcher for every authenticated route (the session idle timeout lives in `shared/auth/policy.ts`; a cuenta de
 * sector gets the longer one). The server only counts REQUESTS as use, so typing a long form would let the session
 * lapse mid-edit. While the user is active (keys, clicks, scroll) this pings the server every `PING_MS` to keep the
 * session alive; after `idleMinutes` without activity it closes the session and does a hard load of /login, so the next
 * touch lands on the login instead of an "Algo salió mal" screen. A ping that finds the session gone (absolute expiry,
 * revoked elsewhere) also goes to /login.
 *
 * Activity is shared across tabs through localStorage: an idle tab never logs out a session another tab is using.
 */
import { useEffect } from "react";
import { cerrarSesionPorInactividadAction, verificarSesionAction } from "./sesion-actions";

const PING_MS = 2 * 60_000;
const CHEQUEO_MS = 30_000;
/** The server's `ultimo_uso_en` can trail the last activity by one ping plus its 1 min touch granularity (validate-session.ts) plus one check: close before the server does. */
const MARGEN_MS = PING_MS + 60_000 + CHEQUEO_MS;
const CLAVE_ACTIVIDAD = "fsj:ultima-actividad";
const EVENTOS_ACTIVIDAD = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

function leerActividadCompartida(): number {
  try {
    return Number(window.localStorage.getItem(CLAVE_ACTIVIDAD)) || 0;
  } catch {
    return 0;
  }
}

function escribirActividadCompartida(valor: number) {
  try {
    window.localStorage.setItem(CLAVE_ACTIVIDAD, String(valor));
  } catch {
    // Private mode / blocked storage: this tab still tracks its own activity.
  }
}

function irAlLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

export function VigilanteInactividad({ idleMinutes }: { idleMinutes: number }) {
  useEffect(() => {
    const limiteMs = idleMinutes * 60_000 - MARGEN_MS;
    let ultimaActividad = Date.now();
    let ultimoPing = Date.now();
    let ultimaEscritura = 0;
    let saliendo = false;

    escribirActividadCompartida(ultimaActividad);

    async function verificar() {
      ultimoPing = Date.now();
      try {
        if (!(await verificarSesionAction())) salir(false);
      } catch {
        // Network hiccup: the next ping or check retries.
      }
    }

    function salir(cerrar: boolean) {
      if (saliendo) return;
      saliendo = true;
      void (cerrar ? cerrarSesionPorInactividadAction() : Promise.resolve()).catch(() => {}).finally(irAlLogin);
    }

    function alActuar() {
      if (saliendo) return;
      const ahora = Date.now();
      ultimaActividad = ahora;
      if (ahora - ultimaEscritura > 5_000) {
        ultimaEscritura = ahora;
        escribirActividadCompartida(ahora);
      }
      if (ahora - ultimoPing > PING_MS) void verificar();
    }

    function chequear() {
      if (saliendo) return;
      const actividad = Math.max(ultimaActividad, leerActividadCompartida());
      if (Date.now() - actividad >= limiteMs) salir(true);
    }

    function alVolverVisible() {
      if (document.visibilityState !== "visible") return;
      // After a laptop sleep or a long time in another tab: the timer may not have run.
      chequear();
      if (!saliendo) void verificar();
    }

    for (const evento of EVENTOS_ACTIVIDAD) window.addEventListener(evento, alActuar, { passive: true, capture: true });
    document.addEventListener("visibilitychange", alVolverVisible);
    const intervalo = window.setInterval(chequear, CHEQUEO_MS);
    return () => {
      for (const evento of EVENTOS_ACTIVIDAD) window.removeEventListener(evento, alActuar, { capture: true });
      document.removeEventListener("visibilitychange", alVolverVisible);
      window.clearInterval(intervalo);
    };
  }, [idleMinutes]);

  return null;
}
