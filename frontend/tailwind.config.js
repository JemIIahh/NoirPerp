export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        noir: {
          // Layered surfaces. Base → panel → raised → hover.
          black:   "#050507",
          gray:    "#0d0d12",
          panel:   "#101018",
          raised:  "#161620",
          hover:   "#1c1c28",

          // Borders / dividers (slightly bluer than pure neutral so the
          // violet accent reads as part of the same family).
          line:    "#1f1f2a",
          edge:    "#2a2a3a",

          // Text scale.
          mute:    "#6b6b7a",
          dim:     "#8b8b9a",
          white:   "#e8e8ee",

          // Brand accent + neighbors.
          accent:  "#7c5cff",
          accent2: "#a78bfa",
          violet:  "#5b3df5",

          // Semantic.
          green:   "#3ddc84",
          red:     "#ff5c5c",
          amber:   "#f5b041",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        "glow-violet": "0 0 0 1px rgba(124, 92, 255, 0.25), 0 8px 32px -8px rgba(124, 92, 255, 0.35)",
        "glow-soft":   "0 0 0 1px rgba(124, 92, 255, 0.18)",
        "inset-line":  "inset 0 1px 0 0 rgba(255, 255, 255, 0.04)",
      },
      backgroundImage: {
        "noir-grid":   "radial-gradient(circle at 1px 1px, rgba(124,92,255,0.08) 1px, transparent 0)",
        "noir-radial": "radial-gradient(ellipse at top, rgba(124,92,255,0.18), transparent 60%)",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%":      { opacity: "1" },
        },
        "fade-in": {
          "0%":   { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "fade-in":    "fade-in 200ms ease-out",
      },
    },
  },
  plugins: [],
};
