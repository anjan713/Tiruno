"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const button = cva("btn3d", {
  variants: {
    variant: {
      primary: "btn3d-primary",
      neutral: "btn3d-neutral",
      success: "btn3d-success",
      ghost: "bg-transparent text-text hover:bg-surface-alt active:translate-y-0",
    },
    size: {
      sm: "h-9 px-4 text-sm",
      md: "h-12 px-6 text-base",
      lg: "h-14 px-8 text-lg",
      icon: "h-11 w-11",
    },
    block: { true: "w-full", false: "" },
  },
  defaultVariants: { variant: "primary", size: "md", block: false },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size, block }), className)} {...props} />
  )
);
Button.displayName = "Button";
