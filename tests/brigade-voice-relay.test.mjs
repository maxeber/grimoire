// Tests of the Incantation relay's pure rules, brigade/voice-relay.ts: what passes, how a delivery is
// labelled and joined, which shell command counts as the listener's start, and what the relay must not
// hold. The turn-level cases (binding, the mid-turn ride, the retries, the nudge) run in
// brigade/voice-relay.test.ts under `claude plugin test .`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  homeOf,
  joinPending,
  listenScript,
  nudgeScript,
  onlyProgress,
  relayText,
  runsStart,
  statusFile,
  worthATurn,
} from '../brigade/voice-relay.ts';

const SOURCE = readFileSync(new URL('../brigade/voice-relay.ts', import.meta.url), 'utf8');

test('a heard turn is relayed under the label, timing dropped, plays kept', () => {
  const out = 'Heard (after reply): "go ahead"\ntiming: wait 2500 stt 300\nplays 1\n';
  assert.equal(worthATurn(out), true);
  assert.equal(relayText(out), '[voice] Heard (after reply): "go ahead" · plays 1');
  assert.equal(relayText('timing: wait 1\n'), '');
  assert.equal(relayText(''), '');
});

test('what is worth a turn: heard text and the notices the session acts on, never waiting or ended', () => {
  for (const out of [
    'Heard: "x"\n',
    'interrupted\nHeard: "wait"\n',
    'stt-dropped\n',
    'say-failed\n',
    'dropped\n',
    'mic-muted\n',
    'mic-unmuted\n',
    'ready\n',
    'mic-fallback "USB Mic"\nready\n',
    'progress-due\n',
    'stopped\n',
    'listener error device\n',
    'listener error relay\n',
    'listener error busy\n',
  ]) {
    assert.equal(worthATurn(out), true, out);
  }
  for (const out of ['', 'listener error ended\n', 'listener error waiting\n', 'idle\n', 'hello\n']) {
    assert.equal(worthATurn(out), false, JSON.stringify(out));
  }
});

test('turns that pile up go as one message, in order, joined by | then:', () => {
  assert.equal(joinPending(['[voice] Heard: "a" · plays 0']), '[voice] Heard: "a" · plays 0');
  assert.equal(joinPending(['[voice] Heard: "a" · plays 0', '[voice] Heard: "b" · plays 0']), '[voice] Heard: "a" · plays 0 | then: Heard: "b" · plays 0');
  assert.equal(joinPending(['[voice] a', '[voice] b', '[voice] c']), '[voice] a | then: b | then: c');
});

test('only a delivery that is nothing but progress-due is the mod\'s to speak for', () => {
  assert.equal(onlyProgress('progress-due\n'), true);
  assert.equal(onlyProgress('progress-due\ntiming: wait 90000\n'), true);
  assert.equal(onlyProgress('Heard: "x"\nprogress-due\n'), false);
  assert.equal(onlyProgress('interrupted\nprogress-due\n'), false);
  assert.equal(onlyProgress(''), false);
});

const ROOT_WIN = 'C:\\Users\\owner\\.claude\\plugins\\grimoire';
const ROOT_POSIX = '/home/owner/.claude/plugins/grimoire';

test('the listener\'s start is the plugin\'s own listen.mjs with start as the word right after it, quotes and slashes either way', () => {
  const win = `${ROOT_WIN}\\skills\\incantation\\scripts\\listen.mjs`;
  assert.equal(runsStart(`node "${win}" start`, ROOT_WIN), true);
  assert.equal(runsStart(`node '${win.replace(/\\/g, '/')}' start`, ROOT_WIN), true);
  assert.equal(runsStart(`node ${win.replace(/\\/g, '/')} start &`, ROOT_WIN), true);
  // The drive letter's case is the host's to spell either way.
  assert.equal(runsStart(`node "${win.replace('C:', 'c:')}" start`, ROOT_WIN), true);
  assert.equal(runsStart(`node ${ROOT_POSIX}/skills/incantation/scripts/listen.mjs start`, ROOT_POSIX), true);
  assert.equal(runsStart(`node ${ROOT_POSIX}/skills/incantation/scripts/listen.mjs   start`, ROOT_POSIX), true);
});

test('anything else is not a start: stop, wait, say, another script, another folder, start as part of a longer word, no root', () => {
  const base = `${ROOT_POSIX}/skills/incantation/scripts`;
  for (const command of [
    `node ${base}/listen.mjs stop`,
    `node ${base}/listen.mjs wait`,
    `node ${base}/listen.mjs say 0a1b2c3d`,
    `node ${base}/listen.mjs starter`,
    `node ${base}/listen.mjs start-now`,
    `node ${base}/setup.mjs start`,
    `node /elsewhere/skills/incantation/scripts/listen.mjs start`,
    `node ${ROOT_POSIX}/skills/incantation/scripts/listen.mjs`,
    'ls',
    '',
  ]) {
    assert.equal(runsStart(command, ROOT_POSIX), false, command);
  }
  assert.equal(runsStart(`node ${base}/listen.mjs start`, ''), false);
  assert.equal(runsStart(`node ${base}/listen.mjs start`, undefined), false);
  assert.equal(runsStart(undefined, ROOT_POSIX), false);
  assert.equal(runsStart({ toString: () => `node ${base}/listen.mjs start` }, ROOT_POSIX), false);
});

test('the paths are built from the plugin root and the person\'s home, in the host\'s own spelling', () => {
  assert.equal(listenScript(ROOT_WIN), 'C:/Users/owner/.claude/plugins/grimoire/skills/incantation/scripts/listen.mjs');
  assert.equal(nudgeScript(`${ROOT_POSIX}/`), `${ROOT_POSIX}/skills/incantation/scripts/nudge.mjs`);
  assert.equal(statusFile('C:\\Users\\owner'), 'C:\\Users\\owner\\.grimoire\\incantation\\run\\status');
  assert.equal(statusFile('/home/owner/'), '/home/owner/.grimoire/incantation/run/status');
  assert.equal(homeOf('C:\\Users\\owner', undefined), 'C:\\Users\\owner');
  assert.equal(homeOf(undefined, '/home/owner'), '/home/owner');
  assert.equal(homeOf('relative/path', undefined), undefined);
  assert.equal(homeOf('C:\\Users\\owner\nx', undefined), undefined);
  assert.equal(homeOf(undefined, undefined), undefined);
});

test('the relay writes no file, reads no file, and keeps no heard text: its only state is flags, a queue and three counts', () => {
  for (const banned of [/\$\.fs\.write/, /\$\.fs\.read/, /\$\.store\./, /\$\.state\./, /\$\.ui\.log/, /writeFile/, /appendFile/, /console\./]) {
    assert.doesNotMatch(SOURCE, banned, String(banned));
  }
  // The one file it names is the listener's status file, which it stats and never opens.
  assert.match(SOURCE, /\$\.fs\.stat\(statusFile/);
});

test('every spawn and run is node by name with no shell, and the spawn is a stdout-only wait', () => {
  const spawns = [...SOURCE.matchAll(/\$\.process\.(spawn|run)\(\{?\s*\[?(argv: \[)?'node'/g)];
  assert.ok(spawns.length >= 3, 'the wait, the nudge and the progress line');
  assert.doesNotMatch(SOURCE, /shell:\s*true|'cmd'|'powershell'|'bash'|'sh'/);
  assert.match(SOURCE, /piece\.stream === 'stdout'/);
});
