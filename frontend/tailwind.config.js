export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        noir: {
          black: "#0a0a0a",
          gray: "#1a1a1a",
          line: "#2a2a2a",
          mute: "#6b6b6b",
          white: "#e8e8e8",
          accent: "#7c5cff",
          green: "#3ddc84",
          red: "#ff5c5c",
        },
      },
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
