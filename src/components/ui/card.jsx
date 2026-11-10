import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Zephyrly base card: one flat surface with a hairline and a 12px radius.
 * No shadow, at rest or on hover — a card that lifts when the pointer
 * passes says "press me", and most cards aren't buttons. The token
 * classes (surface-card / border-hairline) swap with the theme.
 */

/** @type {import("react").ForwardRefExoticComponent<import("react").HTMLAttributes<HTMLDivElement> & import("react").RefAttributes<HTMLDivElement>>} */
const Card = React.forwardRef(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "bg-surface-card border border-border-hairline rounded-xl",
        className
      )}
      {...props}
    />
  );
})
Card.displayName = "Card"

/** @type {import("react").ForwardRefExoticComponent<import("react").HTMLAttributes<HTMLDivElement> & import("react").RefAttributes<HTMLDivElement>>} */
const CardHeader = React.forwardRef(function CardHeader({ className, ...props }, ref) {
  return <div ref={ref} className={cn("flex flex-col gap-0.5 p-4", className)} {...props} />;
})
CardHeader.displayName = "CardHeader"

/** @type {import("react").ForwardRefExoticComponent<import("react").HTMLAttributes<HTMLHeadingElement> & import("react").RefAttributes<HTMLHeadingElement>>} */
const CardTitle = React.forwardRef(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn("text-sm font-semibold tracking-tight text-ink-900 dark:text-ink-100", className)}
      {...props}
    />
  );
})
CardTitle.displayName = "CardTitle"

/** @type {import("react").ForwardRefExoticComponent<import("react").HTMLAttributes<HTMLParagraphElement> & import("react").RefAttributes<HTMLParagraphElement>>} */
const CardDescription = React.forwardRef(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn("text-xs text-ink-500 dark:text-ink-400", className)}
      {...props}
    />
  );
})
CardDescription.displayName = "CardDescription"

/** @type {import("react").ForwardRefExoticComponent<import("react").HTMLAttributes<HTMLDivElement> & import("react").RefAttributes<HTMLDivElement>>} */
const CardContent = React.forwardRef(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />;
})
CardContent.displayName = "CardContent"

/** @type {import("react").ForwardRefExoticComponent<import("react").HTMLAttributes<HTMLDivElement> & import("react").RefAttributes<HTMLDivElement>>} */
const CardFooter = React.forwardRef(function CardFooter({ className, ...props }, ref) {
  return <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />;
})
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
