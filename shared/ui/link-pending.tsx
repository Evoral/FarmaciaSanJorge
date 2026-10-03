"use client";

/**
 * Fixed-size loading hint for a `<Link>` (must be rendered inside it): a
 * thin bar that fades in while that navigation is pending, so a slow
 * server-rendered list still acknowledges the click. No layout shift.
 */
import { useLinkStatus } from "next/link";

export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-pending${pending ? " is-pending" : ""}`} />;
}
