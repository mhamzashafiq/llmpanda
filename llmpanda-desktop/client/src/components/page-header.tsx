import type { ReactNode } from 'react'
import { SectionHeader } from '@/components/apex/section-header'

function DefaultIcon() {
  return <span className="size-2 rounded-full bg-current" />
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  icon,
}: {
  title: string
  description?: string
  actions?: ReactNode
  /** Small breadcrumb label above the title. Defaults to the title. */
  eyebrow?: string
  icon?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <SectionHeader label={eyebrow ?? title} icon={icon ?? <DefaultIcon />} tone="dark" className="mb-4" />
        <h1 className="font-display text-3xl font-bold uppercase leading-[1.05] sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
