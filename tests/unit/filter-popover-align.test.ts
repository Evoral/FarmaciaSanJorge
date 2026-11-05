/** Unit tests for `FilterPopover`'s `align` prop (shared/ui/filter-drawer.tsx). */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { FilterPopover, type FilterPopoverProps } from "@/shared/ui/filter-drawer";

// Children go as the third createElement argument (react/no-children-prop); the cast is only for the type,
// which otherwise wants them in the props too.
function popover(props: Omit<FilterPopoverProps, "children">) {
  return renderToStaticMarkup(createElement(FilterPopover, props as FilterPopoverProps, "x"));
}

function panelClass(html: string): string {
  return html.match(/class="(popover filter-popover-panel[^"]*)"/)?.[1] ?? "";
}

describe("FilterPopover align", () => {
  it("opens from the trigger's left edge by default", () => {
    const html = popover({ label: "Filtros" });
    expect(panelClass(html)).toBe("popover filter-popover-panel");
  });

  it('opens from the right edge with align="end"', () => {
    const html = popover({ label: "Filtros", align: "end" });
    expect(panelClass(html)).toBe("popover filter-popover-panel right-0 left-auto");
  });
});
