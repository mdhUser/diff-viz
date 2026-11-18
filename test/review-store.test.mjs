import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  copyReviewStore,
  readReviewStore,
  removeReviewStore,
  writeReviewStore,
} from '../src/review-store.mjs';

function makeReview() {
  return {
    meta: { branch: 'main', overallSummary: '', stats: { changedFiles: 2 } },
    edges: [{ id: 'e1', source: 'a.ts', target: 'b.ts', relation: 'imports' }],
    nodes: [
      {
        id: 'a.ts',
        label: 'a.ts',
        path: 'a.ts',
        status: 'modified',
        stats: { additions: 1, deletions: 1 },
        summary: '',
        impactAnalysis: '',
        todos: [],
        diff: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
        oldContent: 'old\n',
        newContent: 'new\n',
      },
      {
        id: 'b.ts',
        label: 'b.ts',
        path: 'b.ts',
        status: 'impacted_only',
        stats: { additions: 0, deletions: 0 },
        summary: '',
        impactAnalysis: '',
        todos: [],
        diff: '',
        oldContent: '',
        newContent: '',
      },
    ],
  };
}

test('split storage keeps heavy fields out of the manifest and loads them on demand', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-store-'));
  try {
    const manifestPath = path.join(dir, '.diff-review-data.json');
    const manifest = writeReviewStore(manifestPath, makeReview());

    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(onDisk.storage.format, 2);
    assert.equal(onDisk.nodes.length, 2);
    for (const node of onDisk.nodes) {
      assert.ok(!('diff' in node), 'manifest nodes must not embed diff');
      assert.ok(!('oldContent' in node), 'manifest nodes must not embed oldContent');
      assert.ok(!('newContent' in node), 'manifest nodes must not embed newContent');
      assert.ok(node.payload);
      assert.ok(fs.existsSync(path.join(dir, '.diff-review-data.json.nodes', `${node.payload}.json`)));
    }
    assert.equal(manifest.nodes[0].hunkCount, 1);

    const store = readReviewStore(manifestPath);
    assert.equal(store.layout, 'split');
    const fullA = store.readNode('a.ts');
    assert.equal(fullA.oldContent, 'old\n');
    assert.equal(fullA.newContent, 'new\n');
    assert.match(fullA.diff, /@@/);
    const all = store.readNodes();
    assert.equal(all.length, 2);
    assert.equal(store.toFullData().nodes[0].newContent, 'new\n');

    // Saving the manifest again must not touch payload files.
    const payloadFile = path.join(dir, '.diff-review-data.json.nodes', `${manifest.nodes[0].payload}.json`);
    const before = fs.statSync(payloadFile).mtimeMs;
    store.manifest.meta.overallSummary = 'updated';
    store.save();
    assert.equal(fs.statSync(payloadFile).mtimeMs, before);
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).meta.overallSummary, 'updated');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('review directories use manifest.json + nodes/ and round-trip through copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-store-dir-'));
  try {
    const reviewDir = path.join(dir, 'review-1');
    fs.mkdirSync(reviewDir, { recursive: true });
    writeReviewStore(reviewDir, makeReview());
    assert.ok(fs.existsSync(path.join(reviewDir, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(reviewDir, 'nodes')));

    const snapshot = path.join(dir, 'snapshot');
    const source = readReviewStore(reviewDir);
    const manifest = copyReviewStore(source, snapshot, { metaPatch: { reviewId: 'review-2' } });
    assert.equal(manifest.meta.reviewId, 'review-2');
    assert.equal(manifest.storage.nodesDir, 'nodes');

    const copied = readReviewStore(snapshot);
    assert.equal(copied.readNode('a.ts').oldContent, 'old\n');
    assert.equal(copied.readNode('a.ts').newContent, 'new\n');
    assert.equal(copied.readNode('missing.ts'), null);

    removeReviewStore(snapshot);
    assert.equal(fs.existsSync(snapshot), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy single-file reviews stay readable and upgrade in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-store-legacy-'));
  try {
    const legacyPath = path.join(dir, 'legacy.json');
    fs.writeFileSync(legacyPath, JSON.stringify(makeReview()), 'utf8');

    const legacy = readReviewStore(legacyPath);
    assert.equal(legacy.layout, 'legacy');
    assert.equal(legacy.readNode('a.ts').newContent, 'new\n');

    // Annotating a legacy file rewrites it once; later runs use the manifest.
    legacy.manifest.nodes[0].summary = 'annotated';
    legacy.save();
    assert.match(fs.readFileSync(legacyPath, 'utf8'), /newContent/);

    const upgraded = legacy.upgrade();
    assert.equal(upgraded.layout, 'split');
    assert.ok(fs.existsSync(path.join(dir, 'legacy.json.nodes')));
    assert.equal(readReviewStore(legacyPath).readNode('a.ts').newContent, 'new\n');
    assert.equal(readReviewStore(legacyPath).findNode('a.ts').summary, 'annotated');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
