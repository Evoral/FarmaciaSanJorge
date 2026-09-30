"use client";

/**
 * Client frame for every authenticated route: owns the desktop sidebar's
 * collapsed state so the content gutter and the sidebar stay in sync. The
 * initial value comes from a cookie read server-side (see
 * `app/(app)/layout.tsx`), so a reload never flashes the wrong layout.
 * `children` (banners + page) stay server-rendered; toggling only
 * re-renders this frame and the sidebar.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { SidebarNav, type SidebarNavProps } from "./sidebar-nav";
import { SIDEBAR_COLLAPSED_COOKIE } from "./sidebar-state";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function AppShell({
  nav,
  initialCollapsed,
  children,
}: {
  nav: Omit<SidebarNavProps, "collapsed" | "onCollapsedChange">;
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function changeCollapsed(value: boolean) {
    setCollapsed(value);
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${value ? "1" : "0"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }

  return (
    <div className={`min-h-screen ${collapsed ? "lg:pl-18" : "lg:pl-66"}`}>
      {/* Static glow behind the floating sidebar panel; spans the panel + its gutter only, so page content stays clean and the layer stays small. */}
      <div aria-hidden className={`app-backdrop hidden lg:block ${collapsed ? "lg:w-18" : "lg:w-66"}`} />
      <SidebarNav {...nav} collapsed={collapsed} onCollapsedChange={changeCollapsed} />
      {children}
    </div>
  );
}
