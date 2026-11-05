/** Unit tests for `PageHeader` markup (shared/ui/page-header.tsx): the container wrapper and the actions slot the CSS lays out. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { PageHeader } from "@/shared/ui/page-header";

describe("PageHeader", () => {
  it("wraps the header in the page-header-wrap container and the actions in page-header-actions", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Partidas",
        actions: [createElement("a", { key: "a", className: "btn" }, "Uno"), createElement("a", { key: "b", className: "btn" }, "Dos")],
      }),
    );
    expect(html).toMatch(/^<header class="page-header-wrap"><div class="page-header">/);
    expect(html).toContain('<div class="page-header-actions"><a class="btn">Uno</a><a class="btn">Dos</a></div>');
  });

  it("renders no actions slot without actions", () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: "Partidas" }));
    expect(html).not.toContain("page-header-actions");
  });
});
