import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

const mapFilePath = path.resolve(__dirname, 'src/map/maps/default.json');
const hordeMapFilePath = path.resolve(__dirname, 'src/map/maps/horde-maps.json');

export default defineConfig({
  base: './',
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
      name: 'itch-io-compat',
      transformIndexHtml(html: string) {
        // Strip crossorigin attributes (breaks itch.io CDN)
        html = html.replace(/ crossorigin/g, '');
        // Remove modulepreload links (not needed, can cause CORS issues)
        html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
        // Move main script to end of <body> and strip type="module"
        const scriptMatch = html.match(/<script[^>]*src="[^"]+\.js"[^>]*><\/script>/);
        if (scriptMatch) {
          html = html.replace(scriptMatch[0], '');
          const cleaned = scriptMatch[0].replace(' type="module"', '');
          html = html.replace('</body>', cleaned + '\n</body>');
        }
        // Inject error handler + timeout in <head> before closing </head>
        const errorHandler = `
  <script>
    window.__gameStarted = false;
    window.onerror = function(msg, src, line, col, err) {
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:12px;font:14px monospace;z-index:99999;white-space:pre-wrap';
      d.textContent = 'ERROR: ' + msg + '\\n' + (src||'') + ':' + line + ':' + col + '\\n' + (err&&err.stack||'');
      document.body.appendChild(d);
    };
    window.addEventListener('unhandledrejection', function(e) {
      var d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:red;color:white;padding:12px;font:14px monospace;z-index:99999;white-space:pre-wrap';
      d.textContent = 'UNHANDLED PROMISE: ' + (e.reason&&e.reason.stack||e.reason||'unknown');
      document.body.appendChild(d);
    });
    setTimeout(function() {
      if (!window.__gameStarted) {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:orange;color:black;padding:12px;font:14px monospace;z-index:99999';
        d.textContent = 'WARNING: Game has not started after 10s. Check console (F12).';
        document.body.appendChild(d);
      }
    }, 10000);
  </script>`;
        html = html.replace('</head>', errorHandler + '\n</head>');
        return html;
      },
    },
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
    // itch-inline-assets plugin disabled — GitHub Pages serves assets as normal files
  ],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'game.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
