import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      // Suppress password-manager / browser autofill badges (the red "•••"
      // overlay) on provider-key fields. Callers can override via props.
      autoComplete="off"
      data-1p-ignore="true"
      data-lpignore="true"
      data-form-type="other"
      className={cn(
        // apex inputs — matches the auth screens: tall, dark #272727, rounded-xl,
        // accent-green focus ring.
        "h-11 w-full min-w-0 rounded-xl border border-white/10 bg-[#272727] px-4 py-2.5 text-sm text-white transition-colors outline-none placeholder:text-white/30 focus-visible:border-[#5fb13a] focus-visible:ring-2 focus-visible:ring-[#5fb13a]/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
