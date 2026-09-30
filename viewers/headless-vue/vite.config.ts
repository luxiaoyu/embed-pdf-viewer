import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(here, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'embedpdf-headless.js',
    },
    rollupOptions: {
      external: (id) => id === 'vue' || id.startsWith('vue/'),
    },
  },
});
