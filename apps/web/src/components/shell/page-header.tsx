"use client";

import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`page-header px-4 pb-5 pt-6 lg:px-8 ${className ?? ""}`}>
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-[-.015em]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-2">{description}</p>}
        </div>
        {actions && <div className="page-header-actions flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mx-auto mt-4 max-w-[1200px]">{children}</div>}
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1200px] px-4 py-6 lg:px-8 ${className ?? ""}`}>{children}</div>;
}
