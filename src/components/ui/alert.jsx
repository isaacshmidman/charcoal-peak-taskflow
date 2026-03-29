import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/**
 * @typedef {import("class-variance-authority").VariantProps<typeof alertVariants>} AlertVariantProps
 * @typedef {import("react").HTMLAttributes<HTMLDivElement> & AlertVariantProps} AlertProps
 * @typedef {import("react").HTMLAttributes<HTMLHeadingElement>} AlertTitleProps
 * @typedef {import("react").HTMLAttributes<HTMLDivElement>} AlertDescriptionProps
 */

/** @type {import("react").ForwardRefExoticComponent<AlertProps & import("react").RefAttributes<HTMLDivElement>>} */
const Alert = React.forwardRef(function Alert({ className, variant, ...props }, ref) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props} />
  );
})
Alert.displayName = "Alert"

/** @type {import("react").ForwardRefExoticComponent<AlertTitleProps & import("react").RefAttributes<HTMLHeadingElement>>} */
const AlertTitle = React.forwardRef(function AlertTitle({ className, ...props }, ref) {
  return (
    <h5
      ref={ref}
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props} />
  );
})
AlertTitle.displayName = "AlertTitle"

/** @type {import("react").ForwardRefExoticComponent<AlertDescriptionProps & import("react").RefAttributes<HTMLDivElement>>} */
const AlertDescription = React.forwardRef(function AlertDescription({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("text-sm [&_p]:leading-relaxed", className)}
      {...props} />
  );
})
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
