import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'The Roots Attendance',
        short_name: 'Roots',
        description: 'Check in and check out for The Roots',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#2e6b2e',
        background_color: '#f4f7f2',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      // Cache the app shell only; attendance calls must always hit the network
      workbox: { navigateFallback: '/index.html', runtimeCaching: [] }
    })
  ]
});
