import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHub } from '../src/hub.mjs';
import { DEFAULT_HUB_SETTINGS, hubSettingsPath, readHubSettings, writeHubSettings } from '../src/settings.mjs';
import { hubFetch } from './helpers.mjs';

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'diff-viz-settings-'));
}

test('settings file defaults, persists and rejects invalid values', () => {
  const home = tempHome();
  try {
    assert.deepEqual(readHubSettings(home), DEFAULT_HUB_SETTINGS);
    assert.deepEqual(
      writeHubSettings(home, { language: 'en', diffLayout: 'split', commentsExpanded: false }),
      { language: 'en', diffLayout: 'split', commentsExpanded: false },
    );
    assert.deepEqual(readHubSettings(home), {
      language: 'en',
      diffLayout: 'split',
      commentsExpanded: false,
    });
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(hubSettingsPath(home)).mode & 0o777, 0o600);
    }
    assert.throws(() => writeHubSettings(home, { diffLayout: 'grid' }), /diffLayout/);
    assert.throws(() => writeHubSettings(home, { commentsExpanded: 'yes' }), /commentsExpanded/);
    assert.throws(() => writeHubSettings(home, { language: 'fr' }), /language/);
    // A corrupt file falls back to defaults instead of crashing the hub.
    fs.writeFileSync(hubSettingsPath(home), '{not json');
    assert.deepEqual(readHubSettings(home), DEFAULT_HUB_SETTINGS);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hub serves shared settings over HTTP', async () => {
  const home = tempHome();
  const server = await startHub({ port: 0, host: '127.0.0.1', open: false, quiet: true, home });
  try {
    const initial = await hubFetch(server, 'api/settings').then((response) => response.json());
    assert.equal(initial.ok, true);
    assert.equal(initial.initialized, false);
    assert.deepEqual(initial.settings, DEFAULT_HUB_SETTINGS);

    const saved = await hubFetch(server, 'api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'zh', diffLayout: 'split', commentsExpanded: false }),
    }).then((response) => response.json());
    assert.deepEqual(saved, {
      ok: true,
      settings: { language: 'zh', diffLayout: 'split', commentsExpanded: false },
    });

    const after = await hubFetch(server, 'api/settings').then((response) => response.json());
    assert.equal(after.initialized, true);
    assert.deepEqual(after.settings, { language: 'zh', diffLayout: 'split', commentsExpanded: false });

    const bad = await hubFetch(server, 'api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diffLayout: 'grid' }),
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(readHubSettings(home), {
      language: 'zh',
      diffLayout: 'split',
      commentsExpanded: false,
    });
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
