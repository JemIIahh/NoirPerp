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

          // Borders / dividers (slightly cooler than pure neutral so the
          // mint accent reads as part of the same family).
          line:    "#1e2a28",
          edge:    "#28403b",

          // Text scale. The white token is intentionally cream — it
          // matches the off-white globe disc on Home so the page reads
          // as one tonal family (warm whites on cool noir blacks).
          mute:    "#6f6a5e",
          dim:     "#a39b89",
          white:   "#f3ede0",
          cream:   "#f3ede0",

          // Brand accent + neighbors. Mint-teal — replaces the prior
          // violet palette. Token names kept stable so all existing
          // class refs (text-noir-accent, bg-noir-accent, ...) continue
          // to work; the legacy `violet` token now holds the deeper
          // mint variant used for hover/active states.
          accent:  "#5eead4",
          accent2: "#99f6e4",
          violet:  "#2dd4bf",

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
        // Geometric display face used for h1/h2 and the brand wordmark.
        // Space Grotesk reads as "premium tech" without leaning crypto-
        // generic; pairs cleanly with Inter for body copy.
        display: [
          "Space Grotesk",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        "glow-violet": "0 0 0 1px rgba(94, 234, 212, 0.28), 0 8px 32px -8px rgba(94, 234, 212, 0.40)",
        "glow-soft":   "0 0 0 1px rgba(94, 234, 212, 0.18)",
        "inset-line":  "inset 0 1px 0 0 rgba(255, 255, 255, 0.04)",
      },
      backgroundImage: {
        "noir-grid":   "radial-gradient(circle at 1px 1px, rgba(94,234,212,0.08) 1px, transparent 0)",
        "noir-radial": "radial-gradient(ellipse at top, rgba(94,234,212,0.14), transparent 60%)",
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
