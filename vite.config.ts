import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Не втягивать транзитивные зависимости обратно в именованный чанк:
          // jszip используется и mammoth, и docx, поэтому должен остаться общим.
          onlyExplicitManualChunks: true,
          manualChunks(id) {
            const moduleId = id.replace(/\\/g, '/');
            if (!moduleId.includes('/node_modules/')) return undefined;

            // Функциональная форма относит только указанные пакеты, не затягивая
            // автоматически все их зависимости в тот же большой файл.
            if (/\/node_modules\/(?:react|react-dom|scheduler)\//u.test(moduleId)) return 'vendor';
            if (moduleId.includes('/node_modules/mammoth/')) return 'word-reader';
            if (moduleId.includes('/node_modules/docx/')) return 'word-writer';
            if (moduleId.includes('/node_modules/jszip/')) return 'zip-engine';
            if (
              /\/node_modules\/(?:react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|unist-|vfile)/u
                .test(moduleId)
            ) return 'markdown';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
