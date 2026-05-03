import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const noCacheHeaders = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

const serviceWorkerRemovalScript = `
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});
`

function removeStaleServiceWorkers() {
  let outDir = 'dist'
  const serviceWorkerPaths = new Set([
    '/sw.js',
    '/service-worker.js',
    '/steno-trainer/sw.js',
    '/steno-trainer/service-worker.js',
  ])

  return {
    name: 'remove-stale-service-workers',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        const isServiceWorkerUpdate =
          req.headers['service-worker'] === 'script' ||
          req.headers['sec-fetch-dest'] === 'serviceworker'

        if (!isServiceWorkerUpdate && !serviceWorkerPaths.has(path)) {
          next()
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/javascript')
        for (const [name, value] of Object.entries(noCacheHeaders)) {
          res.setHeader(name, value)
        }
        res.end(serviceWorkerRemovalScript)
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerRemovalScript,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'service-worker.js',
        source: serviceWorkerRemovalScript,
      })
    },
    async closeBundle() {
      await copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
    },
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) registration.unregister();
      });
      if (window.caches) {
        caches.keys().then((cacheNames) => {
          for (const cacheName of cacheNames) caches.delete(cacheName);
        });
      }
    }
  </script>
</head>`
      )
    },
  }
}

export default defineConfig({
  base: '/steno-trainer/',
  plugins: [removeStaleServiceWorkers(), react()],
  server: {
    headers: noCacheHeaders,
  },
  preview: {
    headers: noCacheHeaders,
  },
})
