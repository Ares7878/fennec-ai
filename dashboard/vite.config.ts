import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'fennec-icon-192.png', 'fennec-icon-512.png'],
      manifest: {
        name: 'Fennec AI Trading',
        short_name: 'Fennec',
        description: 'Dashboard de trading automatisé',
        theme_color: '#0b101e',
        background_color: '#0b101e',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'fennec-icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'fennec-icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})
