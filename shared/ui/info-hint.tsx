import { useId, type ReactNode } from "react";
import { Info } from "lucide-react";

const POSICION = {
  "top-start": "bottom-full left-0 mb-2",
  "bottom-end": "top-full right-0 mt-2",
} as const;

/**
 * Small info icon that shows `children` as a floating note on hover/focus
 * (same tooltip look as `SubmitButton`'s `disabledReason`). Safe inside a
 * `<label>`: a button is interactive content, so clicking it does not toggle
 * the labelled control. `placement="bottom-end"` opens the note below and
 * towards the left: for a right-aligned table header, where above it would be
 * clipped by the table's scroll container.
 */
export function InfoHint({ label, children, placement = "top-start" }: { label: string; children: ReactNode; placement?: keyof typeof POSICION }) {
  const tipId = useId();
  return (
    <span className="group/hint relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        className="inline-flex size-4 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 focus-visible:text-zinc-700 dark:hover:text-zinc-200"
      >
        <Info aria-hidden className="size-3.5" />
      </button>
      <span
        role="tooltip"
        id={tipId}
        className={`pointer-events-none absolute ${POSICION[placement]} z-30 hidden w-max max-w-[min(20rem,80vw)] rounded-md bg-zinc-900 px-3 py-2 text-left text-[0.8125rem] font-normal tracking-normal whitespace-normal normal-case text-white shadow-lg group-hover/hint:block group-focus-within/hint:block dark:bg-zinc-100 dark:text-zinc-900`}
      >
        {children}
      </span>
    </span>
  );
}
