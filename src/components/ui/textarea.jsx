import * as React from "react"

import { cn } from "@/lib/utils"

/** @type {import("react").ForwardRefExoticComponent<import("react").TextareaHTMLAttributes<HTMLTextAreaElement> & import("react").RefAttributes<HTMLTextAreaElement>>} */
const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-lg px-3 py-2 text-base border border-border-strong bg-surface-card dark:bg-night-sunken text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ink-900 focus-visible:ring-[3px] focus-visible:ring-ink-900/10 dark:focus-visible:border-sun-400 dark:focus-visible:ring-sun-400/20 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
