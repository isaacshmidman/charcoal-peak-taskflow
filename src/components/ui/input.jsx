import * as React from "react"

import { cn } from "@/lib/utils"

/** @type {import("react").ForwardRefExoticComponent<import("react").InputHTMLAttributes<HTMLInputElement> & import("react").RefAttributes<HTMLInputElement>>} */
const Input = React.forwardRef(function Input({ className, type, ...props }, ref) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg px-3 py-1 text-base md:text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground border border-border-strong bg-surface-card dark:bg-night-sunken text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ink-900 focus-visible:ring-[3px] focus-visible:ring-ink-900/10 dark:focus-visible:border-sun-400 dark:focus-visible:ring-sun-400/20 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
