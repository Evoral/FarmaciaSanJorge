/**
 * Empty and no-results state for lists: an icon, what happened, and the one
 * action that gets the user out of it. Server Component.
 */
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden>
        {icon}
      </span>
      <p className="text-[0.9375rem] font-semibold text-zinc-900">{title}</p>
      {description ? <p className="max-w-[42ch] text-sm text-zinc-500">{description}</p> : null}
      {action ? <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
