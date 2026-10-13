/**
 * Clears `@modal` on any other soft navigation: a slot keeps its last content while the new URL does not match it, so
 * without this a pop-up would stay open after following a link out of it (Next.js parallel-routes docs, "Modals").
 */
export default function ModalCatchAll() {
  return null;
}
