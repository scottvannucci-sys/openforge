import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08080d",
          900: "#0b0b12",
          850: "#101018",
          800: "#15151f",
          700: "#1d1d2b",
          600: "#2a2a3d",
        },
        accent: {
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
        },
        ember: {
          400: "#fb923c",
          500: "#f97316",
        },
      },
      boxShadow: {
        glow: "0 0 24px -6px rgba(56, 189, 248, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
