import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-alt": "rgb(var(--surface-alt) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          press: "rgb(var(--primary-press) / <alpha-value>)",
          fg: "rgb(var(--primary-fg) / <alpha-value>)",
        },
        secondary: "rgb(var(--secondary) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        amber: "rgb(var(--amber) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-baloo)", "system-ui", "sans-serif"],
        body: ["var(--font-nunito)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "24px",
        btn: "16px",
        chip: "999px",
      },
      boxShadow: {
        soft: "0 8px 24px rgba(0,0,0,.08)",
        lift: "0 14px 34px rgba(0,0,0,.14)",
      },
      fontSize: {
        display: ["32px", { lineHeight: "1.1", fontWeight: "800" }],
        h2: ["24px", { lineHeight: "1.15", fontWeight: "800" }],
        h3: ["20px", { lineHeight: "1.2", fontWeight: "700" }],
      },
      keyframes: {
        "bob": {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "pop": {
          "0%": { transform: "scale(0.8)", opacity: "0" },
          "70%": { transform: "scale(1.06)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "shake": {
          "0%,100%": { transform: "translateX(0)" },
          "20%,60%": { transform: "translateX(-7px)" },
          "40%,80%": { transform: "translateX(7px)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(255,122,26,.45)" },
          "70%": { boxShadow: "0 0 0 16px rgba(255,122,26,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255,122,26,0)" },
        },
        "flame": {
          "0%,100%": { transform: "scale(1) rotate(-2deg)" },
          "50%": { transform: "scale(1.12) rotate(2deg)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "rise": {
          "0%": { transform: "translateY(16px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        bob: "bob 3s ease-in-out infinite",
        pop: "pop 0.32s cubic-bezier(.34,1.56,.64,1)",
        shake: "shake 0.4s ease-in-out",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
        flame: "flame 1.4s ease-in-out infinite",
        "slide-up": "slide-up 0.35s cubic-bezier(.34,1.56,.64,1)",
        rise: "rise 0.4s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
