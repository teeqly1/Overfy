import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Каталог dist чистится скриптом scripts/clean-dist.cjs (npm run build):
    // штатный emptyDir падает с EPERM, если каталог удерживается процессом.
    emptyOutDir: false,
  },
  server: {
    port: 3000
  }
})
