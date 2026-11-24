import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { stopHub } from '../src/hub.mjs';
import { cleanup, commitAll, makeTempRepo, write } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/diff-viz.mjs', import.meta.url));

class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else entry.resolve(message.result);
    });
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async tool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    const text = result?.content?.[0]?.text || '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    if (result?.isError) throw new Error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
    return parsed;
  }

  close() {
    this.lines.close();
    this.child.stdin.end();
    return new Promise((resolve) => this.child.once('exit', resolve));
  }
}

test('MCP stdio server lists tools and round-trips a review + annotations', async () => {
  const repo = makeTempRepo();
  write(repo, 'a.ts', 'export const a = 1;\n');
  commitAll(repo, 'init');
  write(repo, 'a.ts', 'export const a = 2;\n');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-mcp-home-'));
  const child = spawn(process.execPath, [BIN, 'mcp'], {
    cwd: repo,
    env: { ...process.env, DIFF_VIZ_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  const client = new McpClient(child);
  try {
    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    assert.equal(init.serverInfo.name, 'diff-viz');
    assert.equal(init.protocolVersion, '2025-06-18');

    const tools = await client.request('tools/list', {});
    const names = tools.tools.map((tool) => tool.name);
    for (const expected of [
      'diff_viz_review',
      'diff_viz_get_review',
      'diff_viz_get_node',
      'diff_viz_annotate',
      'diff_viz_list_projects',
      'diff_viz_list_reviews',
    ]) {
      assert.ok(names.includes(expected), expected);
    }

    const empty = await client.tool('diff_viz_list_reviews', {});
    assert.deepEqual(empty.reviews, []);

    const review = await client.tool('diff_viz_review', { scope: 'worktree' });
    assert.ok(review.reviewId, 'review id');
    assert.match(review.url, /^http:\/\/127\.0\.0\.1:\d+\/\?review=/);
    assert.equal(review.stats.changedFiles, 1);

    const data = await client.tool('diff_viz_get_review', { reviewId: review.reviewId });
    assert.equal(data.reviewId, review.reviewId);
    assert.ok(Array.isArray(data.data.nodes));
    assert.equal(data.data.nodes[0].path, 'a.ts');

    const node = await client.tool('diff_viz_get_node', { reviewId: review.reviewId, id: 'a.ts' });
    assert.match(node.diff, /export const a = 2/);

    await client.tool('diff_viz_annotate', {
      reviewId: review.reviewId,
      annotations: {
        meta: { overallSummary: 'MCP smoke test' },
        nodes: { 'a.ts': { summary: 'changed a', impactAnalysis: 'none', todos: ['check MCP'] } },
      },
    });
    const annotated = await client.tool('diff_viz_get_review', { reviewId: review.reviewId });
    assert.equal(annotated.data.meta.overallSummary, 'MCP smoke test');
    assert.equal(annotated.data.nodes[0].summary, 'changed a');

    const projects = await client.tool('diff_viz_list_projects', {});
    assert.ok(Array.isArray(projects.projects));
    const reviews = await client.tool('diff_viz_list_reviews', {});
    assert.ok(reviews.reviews.some((item) => item.reviewId === review.reviewId));

    await assert.rejects(
      () => client.request('tools/call', { name: 'no_such_tool', arguments: {} }),
      /未知工具/,
    );
  } finally {
    await client.close();
    await stopHub(home);
    cleanup(repo);
    fs.rmSync(home, { recursive: true, force: true });
    if (stderr.length > 0) {
      // Protocol stdout must stay clean; stderr may carry CLI warnings only.
    }
  }
});
