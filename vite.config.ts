import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed port; strictPort so it errors instead of silently
// hopping to 5174 when 5173 is busy.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
})
