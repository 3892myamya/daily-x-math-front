import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

function nonoPuzzlePathFallback() {
  const rewritePuzzlePath = (req, _res, next) => {
    if (/^\/nono(?:\.html)?\/[^/?]+\/[^/?]+\/[^/?]+(?:\?.*)?$/.test(req.url ?? '')) {
      req.url = '/nono.html'
    }
    next()
  }

  return {
    name: 'nono-puzzle-path-fallback',
    configureServer(server) {
      server.middlewares.use(rewritePuzzlePath)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewritePuzzlePath)
    },
  }
}

export default defineConfig({
  plugins: [vue(), nonoPuzzlePathFallback()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        maze: resolve(__dirname, 'maze.html'),
        illusion: resolve(__dirname, 'illusion.html'),
        gacha: resolve(__dirname, 'gacha.html'),
        shogi: resolve(__dirname, 'shogi.html'),
        bcvq: resolve(__dirname, 'bcvq.html'),
        nono: resolve(__dirname, 'nono.html'),
      },
    },
  },
})
