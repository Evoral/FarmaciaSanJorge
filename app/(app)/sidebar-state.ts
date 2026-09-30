/**
 * Desktop sidebar collapsed/expanded preference. Plain module (not
 * "use client") so the server layout can read the cookie by the same name
 * the client shell writes it -- no flash of the wrong layout on reload.
 */
export const SIDEBAR_COLLAPSED_COOKIE = "sidebar_collapsed";
