"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

/**
 * @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>} DialogOverlayProps
 * @typedef {import("react").ElementRef<typeof DialogPrimitive.Overlay>} DialogOverlayElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Content>} DialogContentProps
 * @typedef {import("react").ElementRef<typeof DialogPrimitive.Content>} DialogContentElement
 * @typedef {import("react").HTMLAttributes<HTMLDivElement>} DialogHeaderProps
 * @typedef {import("react").HTMLAttributes<HTMLDivElement>} DialogFooterProps
 * @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Title>} DialogTitleProps
 * @typedef {import("react").ElementRef<typeof DialogPrimitive.Title>} DialogTitleElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof DialogPrimitive.Description>} DialogDescriptionProps
 * @typedef {import("react").ElementRef<typeof DialogPrimitive.Description>} DialogDescriptionElement
 */

/** @type {import("react").ForwardRefExoticComponent<DialogOverlayProps & import("react").RefAttributes<DialogOverlayElement>>} */
const DialogOverlay = React.forwardRef(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props} />
  );
})
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/** @type {import("react").ForwardRefExoticComponent<DialogContentProps & import("react").RefAttributes<DialogContentElement>>} */
const DialogContent = React.forwardRef(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-slate-200 dark:border-[#303030] bg-surface-card text-slate-900 dark:text-slate-100 p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

/** @param {DialogHeaderProps} props */
const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

/** @param {DialogFooterProps} props */
const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

/** @type {import("react").ForwardRefExoticComponent<DialogTitleProps & import("react").RefAttributes<DialogTitleElement>>} */
const DialogTitle = React.forwardRef(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props} />
  );
})
DialogTitle.displayName = DialogPrimitive.Title.displayName

/** @type {import("react").ForwardRefExoticComponent<DialogDescriptionProps & import("react").RefAttributes<DialogDescriptionElement>>} */
const DialogDescription = React.forwardRef(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props} />
  );
})
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
