import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// apex-ui: every button is a pill (rounded-full), uppercase, accent-green for
// primary actions. Restyling this primitive themes every page's buttons at once.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium uppercase tracking-wide whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-[#5fb13a]/40 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[#1e6602] text-white hover:bg-[#27800a]",
        outline:
          "border-border bg-transparent text-foreground hover:border-white/40 hover:bg-muted aria-expanded:bg-muted",
        secondary:
          "bg-card text-foreground hover:bg-secondary aria-expanded:bg-secondary",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted",
        destructive:
          "bg-[#ff4d4f]/10 text-[#ff4d4f] hover:bg-[#ff4d4f]/20 focus-visible:ring-[#ff4d4f]/30",
        link: "rounded-none normal-case tracking-normal text-[#5fb13a] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-5",
        xs: "h-7 gap-1 px-3 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-4 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-6",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
