import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The app talks to the backend directly via VITE_API_BASE_URL (see
// src/lib/api.ts) in every environment, so there's no dev `/api` proxy.
//
// The ONE exception is `/cv/*`: the CV viewer is opened as a same-origin URL so
// the tab shows this portal's domain, not the raw S3 link, so in dev we proxy
// it to the backend's `/api/v1/cv/*` route (Vercel does the same via
// `vercel.json` in production). `VITE_DEV_CV_PROXY_TARGET` overrides the target
// for a dev-branch backend; default localhost.
const CV_PROXY_TARGET =
  process.env.VITE_DEV_CV_PROXY_TARGET || "http://localhost:3001";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  server: {
    port: 5174,
    proxy: {
      // Trailing slash on purpose: proxy ONLY `/cv/<id>/…` (the backend CV
      // stream) and leave `/cv-view/<id>` (the in-app viewer SPA route) to the
      // dev server. A bare `/cv` key would also swallow `/cv-view`.
      "/cv/": {
        target: CV_PROXY_TARGET,
        changeOrigin: true,
        // The browser hits `/cv/<id>/<name>`; the backend route lives under the
        // global `/api/v1` prefix.
        rewrite: (p) => p.replace(/^\/cv/, "/api/v1/cv")
      }
    }
  },
  preview: {
    port: 5174
  }
})
