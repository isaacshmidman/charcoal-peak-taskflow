import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          // Flat ink in the light, sun in the dark (--primary and
          // --primary-hover swap per theme). No shadow: nothing here floats.
          "bg-primary text-primary-foreground font-semibold hover:bg-[var(--primary-hover)]",
        destructive:
          "bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90",
        outline:
          "border border-border-strong bg-surface-card text-foreground hover:bg-surface-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-ink-200 dark:hover:bg-night-high",
        ghost: "hover:bg-selected hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * @typedef {import("class-variance-authority").VariantProps<typeof buttonVariants>} ButtonVariantProps
 * @typedef {import("react").ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariantProps & { asChild?: boolean }} ButtonProps
 */

/** @type {import("react").ForwardRefExoticComponent<ButtonProps & import("react").RefAttributes<HTMLButtonElement>>} */
const Button = React.forwardRef(function Button(
  { className, variant, size, asChild = false, ...props },
  ref
) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={/** @type {import("react").ForwardedRef<HTMLButtonElement>} */ (ref)}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
