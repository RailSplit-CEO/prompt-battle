import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

const mapFilePath = path.resolve(__dirname, 'src/map/maps/default.json');

export default defineConfig({
  resolve: {
    alias: {
      '@prompt-battle/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 3000,
  },
  plugins: [
    {
      name: 'map-save-endpoint',
      configureServer(server) {
        server.middlewares.use('/__save_map', (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                // Validate it's valid JSON
                JSON.parse(body);
                fs.writeFileSync(mapFilePath, body, 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
              } catch (e: any) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else {
            res.writeHead(405);
            res.end();
          }
        });
      },
    },
  ],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'map-viewer': path.resolve(__dirname, 'map-viewer.html'),
        'map-editor': path.resolve(__dirname, 'map-editor.html'),
      },
    },
  },
});
