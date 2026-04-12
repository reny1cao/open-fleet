/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        fleet: {
          alive: "#22c55e",
          stale: "#eab308",
          dead: "#ef4444",
          off: "#6b7280",
        },
      },
    },
  },
  plugins: [],
}
