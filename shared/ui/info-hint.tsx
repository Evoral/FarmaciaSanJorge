import { useId, type ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Small info icon that shows `children` as a floating note on hover/focus
 * (same tooltip look as `SubmitButton`'s `disabledReason`). Safe inside a
 * `<label>`: a button is interactive content, so clicking it does not toggle
 * the labelled control.
 */
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
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
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-max max-w-[min(20rem,80vw)] rounded-md bg-zinc-900 px-3 py-2 text-[0.8125rem] font-normal text-white shadow-lg group-hover/hint:block group-focus-within/hint:block dark:bg-zinc-100 dark:text-zinc-900"
      >
        {children}
      </span>
    </span>
  );
}
