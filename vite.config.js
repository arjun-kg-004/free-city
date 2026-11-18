import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> normal multi-file production build in dist/
// `npm run build:single` -> one self-contained dist-single/index.html (easy to share / host anywhere)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    server: { port: 5173, open: true },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2020',
      chunkSizeWarningLimit: 4000,
      assetsInlineLimit: single ? 100000000 : 4096,
    },
    plugins: single ? [viteSingleFile()] : [],
  };
});
