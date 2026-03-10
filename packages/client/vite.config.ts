import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

const mapFilePath = path.resolve(__dirname, 'src/map/maps/default.json');
const hordeMapFilePath = path.resolve(__dirname, 'src/map/maps/horde-maps.json');

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

        // Horde map editor — save all maps
        server.middlewares.use('/__save_horde_maps', (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body);
                if (!Array.isArray(parsed)) throw new Error('Expected array of maps');
                fs.mkdirSync(path.dirname(hordeMapFilePath), { recursive: true });
                fs.writeFileSync(hordeMapFilePath, JSON.stringify(parsed, null, 2), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, count: parsed.length }));
              } catch (e: any) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else if (req.method === 'GET') {
            try {
              if (fs.existsSync(hordeMapFilePath)) {
                const data = fs.readFileSync(hordeMapFilePath, 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
              } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'no saved maps' }));
              }
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: e.message }));
            }
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
        'horde-editor': path.resolve(__dirname, 'horde-editor.html'),
      },
    },
  },
});
