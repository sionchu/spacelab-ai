"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[#26333e]">
        <SliderPrimitive.Range className="absolute h-full bg-[var(--primary)]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 rounded-full border-2 border-[var(--primary)] bg-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" />
    </SliderPrimitive.Root>
  );
}
