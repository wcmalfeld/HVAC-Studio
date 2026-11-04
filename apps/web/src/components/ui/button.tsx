import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium select-none transition-[background-color,border-color,color,box-shadow] duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-on-accent shadow-sm hover:bg-accent-hover active:translate-y-px",
        secondary:
          "bg-surface text-ink border border-line-strong/80 shadow-sm hover:bg-surface-2 hover:border-line-strong",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        subtle: "bg-surface-2 text-ink hover:bg-surface-3",
        danger: "bg-danger text-white shadow-sm hover:brightness-95",
        "danger-ghost": "text-danger hover:bg-danger-soft",
        link: "text-accent-ink underline-offset-2 hover:underline px-0 h-auto",
      },
      size: {
        xs: "h-6 px-2 text-xs rounded-sm [&_svg]:size-3.5",
        sm: "h-7 px-2.5 text-[13px] rounded-md [&_svg]:size-3.5",
        md: "h-8 px-3 text-[13px] rounded-md [&_svg]:size-4",
        lg: "h-10 px-4 text-sm rounded-lg [&_svg]:size-4",
        icon: "size-8 rounded-md [&_svg]:size-4",
        "icon-sm": "size-7 rounded-md [&_svg]:size-4",
        "icon-xs": "size-6 rounded-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-3.5 animate-spin", className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
