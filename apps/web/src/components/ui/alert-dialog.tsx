"use client";
import * as React from "react";
import * as A from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";

export const AlertDialog = A.Root;
export const AlertDialogCancel = A.Cancel;
export const AlertDialogAction = A.Action;

export function AlertDialogContent({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <A.Portal>
      <A.Overlay className="fixed inset-0 z-50 bg-[rgb(10_20_28/0.38)] backdrop-blur-[2px] animate-fade-in" />
      <A.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface shadow-lg animate-dialog-in focus:outline-none",
          className,
        )}
      >
        <div className="px-5 pt-4">
          <A.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</A.Title>
          {description ? <A.Description className="mt-1.5 text-[13px] text-ink-2">{description}</A.Description> : <A.Description className="sr-only">Confirm</A.Description>}
        </div>
        {children}
      </A.Content>
    </A.Portal>
  );
}
