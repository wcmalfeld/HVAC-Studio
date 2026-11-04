"use client";
import * as React from "react";
import * as T from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  children,
  disabled,
}: {
  content: React.ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
  disabled?: boolean;
}) {
  if (disabled) return children;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex items-center gap-2 rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-surface shadow-md animate-fade-in"
        >
          {content}
          {shortcut ? (
            <kbd className={cn("rounded border border-white/20 px-1 font-sans text-[11px] text-white/70 tnum")}>{shortcut}</kbd>
          ) : null}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
