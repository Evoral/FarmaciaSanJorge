/**
 * Logo + name of the farmacia, shown above the card of every page outside the
 * app shell (`app/(auth)/layout.tsx`, `app/(pasos)/layout.tsx`).
 */
import Image from "next/image";

export function BrandHeader() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-11 items-center justify-center rounded-lg bg-white ring-1 ring-zinc-200 dark:ring-zinc-800">
        <Image src="/logo.png" alt="" width={38} height={38} priority />
      </span>
      <span className="text-base font-semibold leading-tight">Farmacia Magistral</span>
    </div>
  );
}
