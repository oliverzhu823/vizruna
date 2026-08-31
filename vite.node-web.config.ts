import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  resolve: {
    alias: {
      electron: resolve(__dirname, 'src/node-platform/electron-shim.ts'),
      '@shared': resolve(__dirname, 'packages/shared'),
    },
  },
  build: {
    ssr: true,
    outDir: 'out/node-web',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/web/server.ts'),
      external: [
        '@earendil-works/pi-ai', '@earendil-works/pi-coding-agent',
        'better-sqlite3', 'node-pty',
      ],
      output: { format: 'es', entryFileNames: 'server.mjs' },
    },
  },
})
