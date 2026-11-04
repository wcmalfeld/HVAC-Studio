"use client";
import * as React from "react";
import * as S from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function Slider({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root className={cn("relative flex h-4 w-full touch-none select-none items-center", className)} {...props}>
      <S.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-3">
        <S.Range className="absolute h-full bg-accent" />
      </S.Track>
      <S.Thumb className="block size-3.5 rounded-full border border-line-strong bg-surface shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" aria-label="Value" />
    </S.Root>
  );
}
