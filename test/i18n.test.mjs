import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.resolve('web/src');
const EN_PATH = path.join(WEB_SRC, 'i18n', 'en.json');

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(tsx?|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function placeholders(template) {
  return [...String(template).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

test('English UI dictionary covers every literal t() key and placeholders match', () => {
  const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
  const keys = new Set();
  const pattern = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  for (const file of walk(WEB_SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      if (!match[2].includes('${')) keys.add(match[2]);
    }
  }
  assert.ok(keys.size > 100, `expected a substantial dictionary, got ${keys.size}`);
  const missing = [...keys].filter((key) => !(key in en));
  assert.deepEqual(missing, []);
  for (const key of keys) {
    assert.deepEqual(placeholders(key), placeholders(en[key]), `placeholder mismatch for ${key}`);
    assert.ok(!/[\u4e00-\u9fff]/.test(en[key]), `English value contains CJK: ${key}`);
  }
});
