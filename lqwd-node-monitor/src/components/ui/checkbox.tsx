"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// =====================================================
// checkbox — vendored radix primitive (D-10 stale-ack gate)
// =====================================================
// Vendored from the SAME radix source as button/dialog (allowlist:
// class-variance-authority, radix-ui, @radix-ui/*) — NO new third-party registry
// (components.json `registries: {}` stays empty, T-02-SC / T-06-24). Sketch
// grammar: hairline border, tight radius, mono density; navy reserved for the
// focus-visible ring + the checked chrome (the deliberate brand act). The check
// glyph is the ONLY icon here — state is otherwise plain (no icons-for-state).

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[3px] border border-border bg-card outline-none transition-colors",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
