import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // three.js plus the scene is one meaningful chunk; the warning is noise here.
    chunkSizeWarningLimit: 1400,
  },
  server: {
    // WebXR needs a secure context. localhost counts; a headset on the LAN does
    // not, so test in the headset against the deployed HTTPS URL.
    host: true,
  },
})
