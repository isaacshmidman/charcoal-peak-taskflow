"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

/**
 * @typedef {import("react").ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>} SelectTriggerProps
 * @typedef {import("react").ElementRef<typeof SelectPrimitive.Trigger>} SelectTriggerElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>} SelectScrollUpButtonProps
 * @typedef {import("react").ElementRef<typeof SelectPrimitive.ScrollUpButton>} SelectScrollUpButtonElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>} SelectScrollDownButtonProps
 * @typedef {import("react").ElementRef<typeof SelectPrimitive.ScrollDownButton>} SelectScrollDownButtonElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof SelectPrimitive.Content>} SelectContentProps
 * @typedef {import("react").ElementRef<typeof SelectPrimitive.Content>} SelectContentElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof SelectPrimitive.Label>} SelectLabelProps
 * @typedef {import("react").ElementRef<typeof SelectPrimitive.Label>} SelectLabelElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof SelectPrimitive.Item>} SelectItemProps
 * @typedef {import("react").ElementRef<typeof SelectPrimitive.Item>} SelectItemElement
 * @typedef {import("react").ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>} SelectSeparatorProps
 * @typedef {import("react").ElementRef<typeof SelectPrimitive.Separator>} SelectSeparatorElement
 */

/** @type {import("react").ForwardRefExoticComponent<SelectTriggerProps & import("react").RefAttributes<SelectTriggerElement>>} */
const SelectTrigger = React.forwardRef(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
        className
      )}
      {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

/** @type {import("react").ForwardRefExoticComponent<SelectScrollUpButtonProps & import("react").RefAttributes<SelectScrollUpButtonElement>>} */
const SelectScrollUpButton = React.forwardRef(function SelectScrollUpButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollUpButton
      ref={ref}
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}>
      <ChevronUp className="h-4 w-4" />
    </SelectPrimitive.ScrollUpButton>
  );
})
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

/** @type {import("react").ForwardRefExoticComponent<SelectScrollDownButtonProps & import("react").RefAttributes<SelectScrollDownButtonElement>>} */
const SelectScrollDownButton = React.forwardRef(function SelectScrollDownButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollDownButton
      ref={ref}
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}>
      <ChevronDown className="h-4 w-4" />
    </SelectPrimitive.ScrollDownButton>
  );
})
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

/** @type {import("react").ForwardRefExoticComponent<SelectContentProps & import("react").RefAttributes<SelectContentElement>>} */
const SelectContent = React.forwardRef(function SelectContent(
  { className, children, position = "popper", ...props },
  ref
) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}>
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn("p-1", position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
})
SelectContent.displayName = SelectPrimitive.Content.displayName

/** @type {import("react").ForwardRefExoticComponent<SelectLabelProps & import("react").RefAttributes<SelectLabelElement>>} */
const SelectLabel = React.forwardRef(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn("px-2 py-1.5 text-sm font-semibold", className)}
      {...props} />
  );
})
SelectLabel.displayName = SelectPrimitive.Label.displayName

/** @type {import("react").ForwardRefExoticComponent<SelectItemProps & import("react").RefAttributes<SelectItemElement>>} */
const SelectItem = React.forwardRef(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}>
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
})
SelectItem.displayName = SelectPrimitive.Item.displayName

/** @type {import("react").ForwardRefExoticComponent<SelectSeparatorProps & import("react").RefAttributes<SelectSeparatorElement>>} */
const SelectSeparator = React.forwardRef(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props} />
  );
})
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
