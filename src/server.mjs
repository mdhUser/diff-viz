import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readReviewStore } from './review-store.mjs';
import { formatTimestamp, shortId } from './util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

export function updateReviewState(dataPath, payload) {
  const store = readReviewStore(dataPath);
  const data = store.manifest;
  if (!Array.isArray(data.nodes)) throw new Error('数据文件格式不正确。');
  const node = store.findNode(payload.nodeId);
  if (!node) throw new Error(`节点不存在：${payload.nodeId}`);

  if (payload.action === 'addTodo') {
    const text = String(payload.text || '').trim();
    if (!text) throw new Error('待办内容不能为空。');
    if (text.length > 500) throw new Error('待办内容过长（最多 500 字）。');
    const todo = {
      id: `manual-${shortId(`${node.path}::${text}::${Date.now()}`, 10)}`,
      text,
      source: 'manual',
      completed: false,
      severity: payload.severity === 'high' ? 'high' : undefined,
    };
    node.todos = Array.isArray(node.todos) ? node.todos : [];
    node.todos.push(todo);
    data.meta.updatedAt = formatTimestamp();
    // Split storage only rewrites the manifest here; the per-node payload keeps
    // the original source and is never read or rewritten for a todo toggle.
    store.save();
    return { ok: true, todo };
  }

  if (payload.todoId) {
    node.todos = Array.isArray(node.todos) ? node.todos : [];
    const todo = node.todos.find((item) => item.id === payload.todoId);
    if (!todo) throw new Error(`待办不存在：${payload.todoId}`);
    todo.completed = Boolean(payload.completed);
  }
  if (payload.reviewed !== undefined) node.reviewed = Boolean(payload.reviewed);
  if (payload.ignored !== undefined) node.ignored = Boolean(payload.ignored);
  data.meta.updatedAt = formatTimestamp();
  store.save();
  return { ok: true };
}

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function createRequestHandler({ dataPath }) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, data: fs.existsSync(dataPath), dist: fs.existsSync(DIST_DIR) });
        return;
      }

      if (pathname === '/api/data') {
        if (!fs.existsSync(dataPath)) {
          sendJson(res, 404, { error: '数据文件不存在，请重新运行 diff-viz。' });
          return;
        }
        const store = readReviewStore(dataPath);
        // The legacy single-review server predates lazy node loading, so keep
        // serving the complete payload here.
        const body = JSON.stringify(store.toFullData());
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(body);
        return;
      }

      if (pathname === '/api/node') {
        const store = readReviewStore(dataPath);
        const node = store.readNode(url.searchParams.get('id'));
        if (!node) {
          sendJson(res, 404, { error: '节点不存在。' });
          return;
        }
        sendJson(res, 200, node);
        return;
      }

      if (pathname === '/api/state') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        const payload = await readBody(req);
        const result = updateReviewState(dataPath, payload);
        sendJson(res, 200, result);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      if (!fs.existsSync(DIST_DIR)) {
        sendText(
          res,
          503,
          'Review UI 尚未构建。请在工具目录执行 `npm install && npm run build` 后重试。',
          'text/plain; charset=utf-8',
        );
        return;
      }

      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      let filePath = path.resolve(DIST_DIR, relative);
      if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) {
        sendText(res, 403, 'Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        if (!path.extname(relative)) {
          filePath = path.join(DIST_DIR, 'index.html');
        } else {
          sendText(res, 404, 'Not found');
          return;
        }
      }
      const body = await fsp.readFile(filePath);
      const isHashedAsset = relative.startsWith('assets/');
      res.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-store',
        'Content-Length': body.length,
      });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export function openInBrowser(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function startServer({ dataPath, port = 5173, host = '127.0.0.1', open = false, quiet = false }) {
  const server = http.createServer(createRequestHandler({ dataPath }));
  let actualPort = port;
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await listen(server, actualPort, host);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error.code !== 'EADDRINUSE') throw error;
      actualPort += 1;
    }
  }
  if (lastError) throw lastError;

  const address = server.address();
  if (address && typeof address === 'object') actualPort = address.port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${displayHost}:${actualPort}/`;
  if (open) openInBrowser(url);
  if (quiet) {
    process.stdout.write(`${url}\n`);
  } else {
    process.stdout.write(`\n  Review UI  ${url}\n`);
    process.stdout.write(`  数据文件   ${dataPath}\n`);
    process.stdout.write('  按 Ctrl+C 停止服务\n\n');
  }

  return {
    url,
    port: actualPort,
    server,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
