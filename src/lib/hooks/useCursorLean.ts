"use client";

import { useEffect, useRef } from "react";

/**
 * Subtly tilts/translates an element toward the pointer (desktop delighter).
 * No-op on touch / reduced-motion.
 */
export function useCursorLean<T extends HTMLElement>(intensity = 10) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(hover: none)").matches) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) / window.innerWidth;
        const dy = (e.clientY - cy) / window.innerHeight;
        const rot = Math.max(-6, Math.min(6, dx * intensity * 2));
        el.style.transform = `translate(${dx * intensity}px, ${dy * (intensity / 2)}px) rotate(${rot}deg)`;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [intensity]);
  return ref;
}
