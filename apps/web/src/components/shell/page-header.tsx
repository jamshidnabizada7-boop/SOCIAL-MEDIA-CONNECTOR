"use client";

import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="border-b bg-paper/60 px-4 pb-5 pt-6 lg:px-8">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mx-auto mt-4 max-w-[1200px]">{children}</div>}
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1200px] px-4 py-6 lg:px-8 ${className ?? ""}`}>{children}</div>;
}
