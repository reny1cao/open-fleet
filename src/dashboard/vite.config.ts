import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/agents": "http://localhost:4680",
      "/tasks": "http://localhost:4680",
      "/activity": "http://localhost:4680",
      "/events": "http://localhost:4680",
      "/sprints": "http://localhost:4680",
      "/skills": "http://localhost:4680",
      "/docs": "http://localhost:4680",
    },
  },
})
