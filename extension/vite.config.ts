import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv, build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import manifestJson from './manifest.json';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';

  // 根据环境修改 manifest
  const manifest = {
    ...manifestJson,
    name: isDev ? `${manifestJson.name} (Dev)` : manifestJson.name,
    // Production: remove localhost from host_permissions (Chrome Web Store rejects it)
    // WebSocket connections still work via content_security_policy connect-src
    host_permissions: isDev
      ? manifestJson.host_permissions
      : manifestJson.host_permissions.filter((p: string) => !p.includes('localhost'))
  };

  // Build offscreen.ts separately
  const buildOffscreen = async () => {
    await build({
      configFile: false,
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: path.resolve(__dirname, 'offscreen.ts'),
          name: 'offscreen',
          formats: ['iife'],
          fileName: () => 'offscreen.js',
        },
        rollupOptions: {
          output: {
            entryFileNames: 'offscreen.js',
          },
        },
      },
      define: {
        'process.env.API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || 'http://localhost:8000'),
        'process.env.WS_BASE_URL': JSON.stringify(env.VITE_WS_BASE_URL || ''),
        '__FIREFOX__': 'false',
      },
    });
    console.log('[vite] Built offscreen.js');
  };

  return {
    server: {
      port: 3030,
      host: 'localhost',
      strictPort: false,
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 3032,
      },
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      }
    },
    plugins: [
      // Patch Vite HMR client to stop reconnect loop when extension context is invalidated
      {
        name: 'patch-vite-hmr-for-crx',
        enforce: 'post',
        transform(code, id) {
          if (id.includes('vite/dist/client/client.mjs') || id.includes('@vite/client')) {
            const patch = `
;(function(){
  if(typeof chrome!=='undefined'&&chrome.runtime){
    var _WS=window.WebSocket;
    window.WebSocket=function(u,p){
      var s=typeof u==='string'?u:u.toString();
      if(s.includes('localhost:3030')||s.includes('127.0.0.1:3030')){
        try{chrome.runtime.getURL('')}catch(e){
          var d=Object.create(_WS.prototype);
          Object.defineProperty(d,'readyState',{value:_WS.CLOSED});
          return d;
        }
      }
      return p?new _WS(u,p):new _WS(u);
    };
    window.WebSocket.prototype=_WS.prototype;
    window.WebSocket.CONNECTING=_WS.CONNECTING;
    window.WebSocket.OPEN=_WS.OPEN;
    window.WebSocket.CLOSING=_WS.CLOSING;
    window.WebSocket.CLOSED=_WS.CLOSED;
  }
})();
`;
            return patch + code;
          }
          // Patch CRXJS HMR port: wrap chrome.runtime.connect in try-catch
          // to suppress "Extension context invalidated" from vendor/crx-client-port.js
          if (id.includes('@crx/client-port') || id.includes('crx-client-port')) {
            return code.replace(
              'this.port = chrome.runtime.connect({ name: "@crx/client" })',
              'try { this.port = chrome.runtime.connect({ name: "@crx/client" }) } catch { return }'
            );
          }
        },
      },
      {
        name: 'build-offscreen',
        closeBundle: {
          sequential: true,
          async handler() {
            await buildOffscreen();
          }
        },
        async configureServer() {
          // Also build offscreen.js in dev mode
          await buildOffscreen();
        }
      },
      react(),
      tailwindcss(),
      crx({ manifest }),
      viteStaticCopy({
        targets: [
          {
            src: 'assets/*',
            dest: 'assets'
          },
        ]
      }),
    ],
    optimizeDeps: {},
    define: {
      'import.meta.url': JSON.stringify('https://extension-dummy-url/'),
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.X_PUBLIC_API_KEY': JSON.stringify(env.X_PUBLIC_API_KEY),
      'process.env.API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || 'http://localhost:8000'),
      'process.env.WS_BASE_URL': JSON.stringify(env.VITE_WS_BASE_URL || ''),
      '__FIREFOX__': 'false',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
  };
});
