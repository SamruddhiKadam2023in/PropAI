import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    // true only when VITE_SHOW_DEMO_LOGIN=true is set (frontend/.env for the local demo). Never set it on a public deployment.
    __SHOW_DEMO_LOGIN__: JSON.stringify(loadEnv(mode, process.cwd(), 'VITE_').VITE_SHOW_DEMO_LOGIN === 'true'),
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    watch: {
      // Required for Docker on Windows — WSL2 doesn't propagate inotify events
      usePolling: true,
      interval: 1000,
    },
  },
}))
