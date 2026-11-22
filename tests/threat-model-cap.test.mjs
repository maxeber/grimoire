// The threat model is one file, and it is capped at 3,100 words, so a session
// reads all of it before it rules on a finding. A model that grows past the
// cap fails here: history lives in ADRs and logs, and this file holds what
// holds now. Raising the cap is a spec change: the owner's yes in the issue.
// Only review enforces that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'docs/security/threat-model.md';
const CAP = 3100; // raised from 3,000 for Incantation's installer crossings and the ambient-speech class; the owner approved in chat on 2026-11-22

// The words in a text: runs of non-space characters, the whole file, mermaid
// included.
const words = text => text.split(/\s+/).filter(Boolean).length;

// Null when the file is within the cap, else what is wrong.
function overCap(file) {
  const n = words(readFileSync(file, 'utf8'));
  return n > CAP ? `${MODEL} holds ${n} words, over its cap of ${CAP}; cut it, or ask the owner to raise the cap` : null;
}

test('the threat model is within its word cap', () => {
  assert.equal(overCap(join(root, MODEL)), null);
});

test('the counter reports a padded copy over the cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threat-model-cap-'));
  try {
    const copy = join(dir, 'threat-model.md');
    // Fixed sizes, so a raised CAP fails here; newlines and tabs split words too.
    writeFileSync(copy, `${readFileSync(join(root, MODEL), 'utf8')}\n${'word\n'.repeat(3001)}`);
    assert.match(overCap(copy), /over its cap/);
    writeFileSync(copy, 'word\tword\n'.repeat(1550));
    assert.equal(overCap(copy), null);
    writeFileSync(copy, `${'word\tword\n'.repeat(1550)}word`);
    assert.match(overCap(copy), /over its cap/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
