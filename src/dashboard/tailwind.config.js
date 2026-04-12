/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Geist Variable'", "system-ui", "sans-serif"],
        mono: ["'Geist Mono Variable'", "ui-monospace", "monospace"],
      },
      fontSize: {
        kpi: ["32px", { lineHeight: "1", fontWeight: "700" }],
        section: ["16px", { lineHeight: "1.25", fontWeight: "600" }],
        body: ["14px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.5" }],
        mono: ["12px", { lineHeight: "1.5" }],
      },
      colors: {
        bg: "#0a0a0a",
        surface: "#111111",
        border: "#222222",
        "border-subtle": "#1a1a1a",
        "text-primary": "#fafafa",
        "text-secondary": "#a1a1aa",
        "text-muted": "#52525b",
        status: {
          green: "#22c55e",
          amber: "#f59e0b",
          red: "#ef4444",
          blue: "#3b82f6",
          gray: "#6b7280",
        },
      },
      spacing: {
        "4px": "4px",
        "8px": "8px",
        "12px": "12px",
        "16px": "16px",
        "24px": "24px",
        "32px": "32px",
        "48px": "48px",
      },
      borderRadius: {
        card: "4px",
      },
    },
  },
  plugins: [],
}
