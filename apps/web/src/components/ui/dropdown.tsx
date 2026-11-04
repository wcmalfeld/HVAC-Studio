"use client";
import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dropdown = DM.Root;
export const DropdownTrigger = DM.Trigger;
export const DropdownGroup = DM.Group;
export const DropdownSub = DM.Sub;

export function DropdownContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[180px] rounded-lg border border-line bg-surface p-1 shadow-md animate-pop-in focus:outline-none",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownItem({
  className,
  danger,
  shortcut,
  children,
  ...props
}: React.ComponentProps<typeof DM.Item> & { danger?: boolean; shortcut?: string }) {
  return (
    <DM.Item
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-ink outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-ink-3",
        danger && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger",
        className,
      )}
      {...props}
    >
      {children}
      {shortcut ? <span className="ml-auto pl-4 text-[11px] text-ink-4 tnum">{shortcut}</span> : null}
    </DM.Item>
  );
}

export function DropdownCheckItem({ className, children, ...props }: React.ComponentProps<typeof DM.CheckboxItem>) {
  return (
    <DM.CheckboxItem
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-md pl-7 pr-2 text-[13px] text-ink outline-none relative data-[highlighted]:bg-surface-2",
        className,
      )}
      {...props}
    >
      <DM.ItemIndicator className="absolute left-2">
        <Check className="size-3.5 text-accent" />
      </DM.ItemIndicator>
      {children}
    </DM.CheckboxItem>
  );
}

export function DropdownLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink-3", className)} {...props} />;
}

export function DropdownSeparator() {
  return <DM.Separator className="my-1 h-px bg-line" />;
}
