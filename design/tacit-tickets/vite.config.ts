import { lstatSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
// A checkout in a cloud-synced folder keeps node_modules outside it, as a symlink. Vite's cache is
// thousands of small files and stalls the dev server inside a synced tree, so it moves out too, and
// the dev server may serve files (fonts) from where node_modules really is. An ordinary checkout
// gets Vite's defaults.
const linked = lstatSync(resolve(import.meta.dirname, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink() ?? false

export default defineConfig({
  plugins: [react(), tailwindcss()],
  ...(linked && {
    cacheDir: resolve(homedir(), "Library/Caches/tacit-tickets-vite"),
    server: { fs: { allow: [".", resolve(homedir(), ".tacit-tickets")] } },
  }),
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
