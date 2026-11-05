/** Unit tests for `FilterPopover`'s `align` prop (shared/ui/filter-drawer.tsx). */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { FilterPopover } from "@/shared/ui/filter-drawer";

function panelClass(html: string): string {
  return html.match(/class="(popover filter-popover-panel[^"]*)"/)?.[1] ?? "";
}

describe("FilterPopover align", () => {
  it("opens from the trigger's left edge by default", () => {
    const html = renderToStaticMarkup(createElement(FilterPopover, { label: "Filtros", children: "x" }));
    expect(panelClass(html)).toBe("popover filter-popover-panel");
  });

  it('opens from the right edge with align="end"', () => {
    const html = renderToStaticMarkup(createElement(FilterPopover, { label: "Filtros", align: "end", children: "x" }));
    expect(panelClass(html)).toBe("popover filter-popover-panel right-0 left-auto");
  });
});
