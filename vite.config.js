import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        maze: resolve(__dirname, 'maze.html'),
        illusion: resolve(__dirname, 'illusion.html'),
        gacha: resolve(__dirname, 'gacha.html'),
      },
    },
  },
})