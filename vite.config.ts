import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const fastApiProxyTarget = env.VITE_FASTAPI_PROXY_TARGET || 'http://127.0.0.1:8010'

  return {
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api-fast': {
        target: fastApiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-fast/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router')) return 'router'
            if (id.includes('supabase')) return 'supabase'
            if (id.includes('lucide-react')) return 'icons'
            return 'vendor'
          }
        },
      },
    },
  },
  }
})
