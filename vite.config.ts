import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base '/folio360/' porque se publica como GitHub Pages de proyecto
// (avalenm.github.io/folio360/), no como Pages de usuario/org.
export default defineConfig({
  base: '/folio360/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173
  }
})
