// Tests of brigade/mic-view.ts: what the Incantation mic band reads from the
// listener's levels file and how it draws it (docs/spec/incantation.md, T16).
// The band's own behaviour under the engine is in brigade/mic-band.test.tsx.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BARS, EASE_STEPS, FRESH_MS, HUES, WORDS, bars, colorAt, commandFile, homeFrom, labelOf, levelsFile, mix, parseLevels, toggleFor } from '../brigade/mic-view.ts';

const NOW = 1_700_000_000_000;
const ROW = '000012345678765432100000';

test('a levels line is read only in the listener\'s one shape, and only while fresh', () => {
  assert.deepEqual(parseLevels(`${NOW} hearing ${ROW}\n`, NOW), { stamp: NOW, word: 'hearing', digits: ROW });
  assert.deepEqual(parseLevels(`${NOW} muted ${ROW}`, NOW + 1000), { stamp: NOW, word: 'muted', digits: ROW });
  assert.ok(parseLevels(`${NOW} listening ${ROW}\r\n`, NOW), 'a line ending of either kind');
  for (const bad of [
    `${NOW} shouting ${ROW}`,
    `${NOW} hearing ${ROW.slice(1)}`,
    `${NOW} hearing ${ROW}0`,
    `${NOW} hearing ${'9'.repeat(24)}`,
    `${NOW} hearing ${ROW} extra`,
    `${NOW} hearing ${ROW}\n${NOW} muted ${ROW}`,
    `hearing ${ROW}`,
    '',
    'x'.repeat(200),
  ]) assert.equal(parseLevels(bad, NOW), null, JSON.stringify(bad.slice(0, 30)));
  assert.equal(parseLevels(`${NOW} hearing ${ROW}`, NOW + FRESH_MS + 1), null, 'a stamp from a listener that has gone');
  assert.equal(parseLevels(`${NOW} hearing ${ROW}`, NOW - FRESH_MS - 1), null, 'nor one from far ahead');
  assert.equal(parseLevels(undefined, NOW), null);
  assert.equal(parseLevels(`${NOW} hearing ${ROW}`, Number.NaN), null);
});

test('the wave is one block a bar, smoothed, and a muted mic is a flat line of dots', () => {
  const wave = bars(ROW, 'hearing');
  assert.equal([...wave].length, BARS);
  assert.match(wave, /^[▁▂▃▄▅▆▇█]{24}$/);
  assert.equal(bars('0'.repeat(24), 'listening'), '▁'.repeat(24));
  assert.equal(bars('8'.repeat(24), 'listening'), '█'.repeat(24));
  assert.equal(bars(ROW, 'muted'), '·'.repeat(24));
  const rise = [...bars('012345678'.padEnd(24, '8'), 'hearing')];
  for (let i = 1; i < 9; i++) assert.ok(rise[i] >= rise[i - 1], 'a rising row never draws a lower block');
});

test('the state word changes colour in steps from the old word\'s colour to the new one\'s', () => {
  assert.equal(colorAt('listening', 'hearing', 0), HUES.listening);
  assert.equal(colorAt('listening', 'hearing', EASE_STEPS), HUES.hearing);
  const mid = colorAt('listening', 'hearing', EASE_STEPS / 2);
  assert.match(mid, /^#[0-9a-f]{6}$/);
  assert.notEqual(mid, HUES.listening);
  assert.notEqual(mid, HUES.hearing);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#102030', '#102030', 0.3), '#102030');
  assert.equal(mix('#000000', '#ffffff', 7), '#ffffff', 'k is held to 0..1');
  for (const w of WORDS) assert.match(HUES[w], /^#[0-9a-f]{6}$/);
});

test('the button says what it will do, and a click writes one word: mute, or unmute while muted', () => {
  assert.deepEqual(toggleFor('listening'), { label: 'Mute mic', command: 'mute' });
  assert.deepEqual(toggleFor('hearing'), { label: 'Mute mic', command: 'mute' });
  assert.deepEqual(toggleFor('muted'), { label: 'Unmute mic', command: 'unmute' });
  assert.equal(labelOf('thinking'), 'mic: thinking');
});

test('the two files are in the listener\'s run folder under the person\'s home, spelled the way the home is', () => {
  assert.equal(levelsFile('C:\\Users\\someone'), 'C:\\Users\\someone\\.grimoire\\incantation\\run\\levels');
  assert.equal(commandFile('C:\\Users\\someone\\'), 'C:\\Users\\someone\\.grimoire\\incantation\\run\\command');
  assert.equal(levelsFile('/home/someone'), '/home/someone/.grimoire/incantation/run/levels');
  assert.equal(commandFile('/home/someone/'), '/home/someone/.grimoire/incantation/run/command');
});

test('the home is an absolute path of sane length from the engine\'s environment, the profile first', () => {
  assert.equal(homeFrom('C:\\Users\\a', '/home/b'), 'C:\\Users\\a');
  assert.equal(homeFrom(undefined, '/home/b'), '/home/b');
  assert.equal(homeFrom('relative\\path', '/home/b'), '/home/b');
  assert.equal(homeFrom('', ''), undefined);
  assert.equal(homeFrom(42, null), undefined);
  assert.equal(homeFrom('/home/' + 'x'.repeat(300), undefined), undefined);
  assert.equal(homeFrom('/home/a\nb', undefined), undefined);
});
