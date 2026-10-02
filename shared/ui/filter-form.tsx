"use client";

/**
 * Auto-applying GET filter form for list pages. Selects and checkboxes
 * navigate as soon as they change; text/search/number inputs wait for a
 * short pause in typing (debounce). The URL is built from the form's
 * non-empty fields only, so every filter change drops `page` (back to page
 * 1) and never leaves `?q=&estado=` noise behind. `router.replace` keeps
 * the search input mounted (and focused) across the navigation.
 *
 * - A name shared by several controls (e.g. checked chips plus an "add"
 *   select, all `name="droga"`) is serialized as a REPEATED param
 *   (`?droga=a&droga=b`, DOM order): values are appended, never overwritten.
 *   Pages read it back as `string | string[] | undefined`.
 * - Listens to NATIVE `input`/`change` events (not React's `onChange`), so
 *   composite widgets that submit through a hidden input can apply the
 *   form by dispatching a bubbling `change` on it -- `./date-input.tsx`
 *   does exactly that when a complete date is committed or cleared, never
 *   while a date is half typed. Unnamed controls (a widget's visible field)
 *   are ignored: they are not part of the query.
 * - "Limpiar filtros" (`hasActiveFilters`) empties every field except
 *   hidden context inputs (e.g. `drogaId`) and controls marked
 *   `data-preserve-on-clear` (display options such as "Unificar
 *   unidades").
 * - When the URL changes from OUTSIDE the form (a link that sets filters,
 *   the sidebar link to the bare list), the fields are reset to the new
 *   server-rendered defaults, so an edited field never contradicts the URL.
 *
 * Progressive enhancement: without JS it is still a plain `method="get"`
 * form, submitted with Enter.
 */
import { useEffect, useEffectEvent, useRef, useTransition, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const TEXT_DEBOUNCE_MS = 400;
const MAX_APPLIED_QUERIES = 5;
const TEXT_LIKE_TYPES = new Set(["text", "search", "number", "email", "tel", "url"]);

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function asNamedField(target: EventTarget | null): Field | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return null;
  return target.name ? target : null;
}

function isTextLike(field: Field): boolean {
  return field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && TEXT_LIKE_TYPES.has(field.type));
}

function buildQuery(form: HTMLFormElement): string {
  const params = new URLSearchParams();
  for (const [name, value] of new FormData(form)) {
    // `append`, not `set`: a repeated name (checked chips + an "add" select sharing one `name`) must keep EVERY value.
    if (typeof value === "string" && value.trim() !== "") params.append(name, value.trim());
  }
  return params.toString();
}

function normalizeQuery(search: string): string {
  return new URLSearchParams(search).toString();
}

export interface FilterFormProps {
  children: ReactNode;
  className?: string;
  "aria-label": string;
  /** Shows the "Limpiar filtros" button. */
  hasActiveFilters: boolean;
}

export function FilterForm({ children, className, "aria-label": ariaLabel, hasActiveFilters }: FilterFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Queries this form navigated to recently (a fast typist can have two in flight), and the last one seen in the address bar. */
  const appliedQueries = useRef<string[]>([]);
  const seenQuery = useRef<string | null>(null);

  function apply(form: HTMLFormElement) {
    clearTimeout(debounce.current);
    const query = buildQuery(form);
    appliedQueries.current = [...appliedQueries.current.slice(1 - MAX_APPLIED_QUERIES), query];
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  const onInput = useEffectEvent((event: Event) => {
    const field = asNamedField(event.target);
    if (!field || !isTextLike(field) || !field.form) return;
    const form = field.form;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply(form), TEXT_DEBOUNCE_MS);
  });

  const onChange = useEffectEvent((event: Event) => {
    const field = asNamedField(event.target);
    // Text-like fields are already handled (debounced) by `input`; their `change` only means "blurred".
    if (!field || isTextLike(field) || !field.form) return;
    apply(field.form);
  });

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const handleInput = (event: Event) => onInput(event);
    const handleChange = (event: Event) => onChange(event);
    form.addEventListener("input", handleInput);
    form.addEventListener("change", handleChange);
    return () => {
      form.removeEventListener("input", handleInput);
      form.removeEventListener("change", handleChange);
      clearTimeout(debounce.current);
    };
  }, []);

  // Runs after every render: a navigation re-renders this form with the page's new defaults.
  useEffect(() => {
    const current = normalizeQuery(window.location.search);
    if (seenQuery.current === null || current === seenQuery.current) {
      seenQuery.current = current;
      return;
    }
    seenQuery.current = current;
    if (!appliedQueries.current.includes(current)) formRef.current?.reset();
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(event.currentTarget);
  }

  function handleClear(form: HTMLFormElement | null) {
    if (!form) return;
    for (const element of Array.from(form.elements)) {
      if (element instanceof HTMLElement && element.hasAttribute("data-preserve-on-clear")) continue;
      if (element instanceof HTMLSelectElement) element.selectedIndex = 0;
      else if (element instanceof HTMLInputElement) {
        if (element.type === "checkbox" || element.type === "radio") element.checked = false;
        else if (element.type !== "hidden" || element.hasAttribute("data-date-input")) element.value = "";
      }
    }
    apply(form);
  }

  return (
    <form ref={formRef} method="get" className={className} aria-label={ariaLabel} aria-busy={isPending} onSubmit={handleSubmit}>
      {children}
      {hasActiveFilters ? (
        <button type="button" onClick={(event) => handleClear(event.currentTarget.form)} className="text-sm underline">
          Limpiar filtros
        </button>
      ) : null}
    </form>
  );
}
