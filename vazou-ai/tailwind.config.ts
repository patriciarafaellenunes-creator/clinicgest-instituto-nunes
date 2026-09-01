import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0E11",
        surface: "#12161B",
        "surface-2": "#181D23",
        border: "#232A31",
        text: "#E7ECEF",
        "text-muted": "#8A97A0",
        accent: "#22C55E",
        "accent-soft": "#0F2A1C",
        "accent-2": "#A78BFA",
        "accent-2-soft": "#231C3D",
        warn: "#E0B24D",
        danger: "#E2665A",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
