import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv, build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * Firefox-specific Vite config
 * - No @crxjs/vite-plugin (Chrome-only)
 * - Builds background.ts separately as IIFE (Firefox MV3 event page)
 * - Main build targets content script (index.tsx)
 * - Separate output dir: dist-firefox/
 * - No offscreen document (Firefox doesn't support it)
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';
  const commonDefine = {
    'import.meta.url': JSON.stringify('https://extension-dummy-url/'),
    'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    'process.env.X_PUBLIC_API_KEY': JSON.stringify(env.X_PUBLIC_API_KEY),
    'process.env.API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || 'http://localhost:8000'),
    'process.env.WS_BASE_URL': JSON.stringify(env.VITE_WS_BASE_URL || ''),
    '__FIREFOX__': 'true',
  };

  // Read Firefox manifest and adjust for environment
  const getFirefoxManifest = () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'manifest.firefox.json'), 'utf-8'));
    if (isDev) {
      manifest.name = `${manifest.name} (Dev)`;
    } else {
      // Remove localhost URLs for production
      manifest.host_permissions = manifest.host_permissions.filter((p: string) => !p.includes('localhost'));
    }
    return manifest;
  };

  // Build background.ts separately as IIFE (single entry = no code splitting issue)
  const buildBackground = async () => {
    await build({
      configFile: false,
      build: {
        outDir: 'dist-firefox',
        emptyOutDir: false,
        minify: isDev ? false : 'esbuild',
        lib: {
          entry: path.resolve(__dirname, 'background.ts'),
          name: 'background',
          formats: ['iife'],
          fileName: () => 'background.js',
        },
        rollupOptions: {
          output: {
            entryFileNames: 'background.js',
          },
        },
      },
      define: commonDefine,
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
      },
    });
    console.log('[vite:firefox] Built background.js');
  };

  // Main build: content script (index.tsx) with React, Tailwind, etc.
  return {
    build: {
      outDir: 'dist-firefox',
      emptyOutDir: true,
      minify: isDev ? false : 'esbuild',
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          content: path.resolve(__dirname, 'index.tsx'),
        },
        output: {
          // Use IIFE for single content entry
          format: 'iife' as const,
          entryFileNames: '[name].js',
          assetFileNames: 'assets/[name][extname]',
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      viteStaticCopy({
        targets: [
          {
            src: 'assets/*',
            dest: 'assets',
          },
          {
            src: 'public/wechat-scraper-inject.js',
            dest: '.',
          },
          {
            src: 'public/tiktok-inject.js',
            dest: '.',
          },
          {
            src: 'public/xiaohongshu-inject.js',
            dest: '.',
          },
          {
            src: 'public/timeline-interceptor.js',
            dest: '.',
          },
        ],
      }),
      // Build background.ts separately + copy Firefox manifest after main build
      {
        name: 'firefox-post-build',
        closeBundle: {
          sequential: true,
          async handler() {
            // Build background.js as separate IIFE bundle
            await buildBackground();

            // Write Firefox manifest
            const manifest = getFirefoxManifest();
            const outDir = path.resolve(__dirname, 'dist-firefox');
            fs.writeFileSync(
              path.join(outDir, 'manifest.json'),
              JSON.stringify(manifest, null, 2)
            );
            console.log('[vite:firefox] Wrote manifest.json to dist-firefox/');
          },
        },
      },
    ],
    optimizeDeps: {},
    define: commonDefine,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
