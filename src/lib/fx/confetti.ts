import confetti from "canvas-confetti";

export function burstConfetti(opts?: { gold?: boolean }) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = opts?.gold
    ? ["#FFD466", "#FFB020", "#FF7A1A", "#FFFFFF"]
    : ["#FF7A1A", "#3DA5F4", "#4CC76E", "#FFB020"];
  const end = Date.now() + 900;
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({ particleCount: 120, spread: 80, startVelocity: 45, origin: { y: 0.6 }, colors });
}

export function sparkleAt(x: number, y: number) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  confetti({
    particleCount: 24,
    spread: 50,
    startVelocity: 22,
    scalar: 0.7,
    origin: { x: x / window.innerWidth, y: y / window.innerHeight },
    colors: ["#FFB020", "#FF7A1A", "#FFFFFF"],
  });
}
