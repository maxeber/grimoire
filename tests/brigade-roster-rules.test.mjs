// The roster's shared rules, tested at their own seam: the shape check and its
// strict mode, the byte cap measured on the text that is written, and the path
// decision given `stat` answers. brigade/roster.ts takes plain values and no
// engine import, so these run under `node --test` in CI, where there is no
// Claude Code.
//
// The Windows-shaped `stat` answers come from brigade/recorded-stats.ts, what
// the real engine answered about real links (scripts/record-brigade-stats.mjs
// records it). The POSIX-shaped ones are written by hand, in the same shape.
//
// The module is TypeScript; tests/brigade-view.test.mjs names the Node version
// that imports it as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const roster = await import('../brigade/roster.ts');
const { RECORDED } = await import('../brigade/recorded-stats.ts');
const { MAX_ROSTER_BYTES, checkRoster, foldsCase, placeRoster, serialize, statRejection } = roster;

// One schedule of the head-chef contract (#604): the text from its "### <home>: <heading>"
// line to the next one, with whitespace collapsed. A schedule holds its home's wording.
async function scheduleOf(title) {
  const { readFile } = await import('node:fs/promises');
  const text = (await readFile(new URL('../skills/head-chef/references/CONTRACT.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const at = text.indexOf(`\n### ${title}\n`);
  assert.ok(at >= 0, `the contract holds the schedule "${title}"`);
  const end = text.indexOf('\n### ', at + 1);
  return text.slice(at, end < 0 ? undefined : end).replace(/\s+/g, ' ');
}

const SID = '11111111-2222-3333-4444-555555555555';
const card = (title, over = {}) => ({ title, work: '', settings: '', status: 'working', ...over });

// --- the shape check ------------------------------------------------------------

test('the pane reads a missing list as empty; the strict check refuses it', () => {
  assert.deepEqual(checkRoster('{}'), { value: { cards: [], todos: [] } });
  assert.deepEqual(checkRoster('{}', true), { error: 'the roster has no "cards" list' });
  assert.deepEqual(checkRoster('{"cards":[]}', true), { error: 'the roster has no "todos" list' });
  assert.deepEqual(checkRoster('{"cards":[],"todos":[]}', true), { value: { cards: [], todos: [] } });
});

test('__proto__ and constructor are refused at the top level and nested', () => {
  for (const raw of [
    '{"cards":[],"todos":[],"__proto__":{"x":1}}',
    '{"cards":[],"todos":[],"constructor":1}',
    '{"cards":[{"title":"a","status":"working","__proto__":{"x":1}}],"todos":[]}',
    '{"cards":[],"todos":[{"id":"t","text":"x","constructor":1}]}',
  ]) {
    for (const strict of [false, true]) {
      const r = checkRoster(raw, strict);
      assert.ok('error' in r, raw);
      assert.match(r.error, /has a field the roster does not use: (__proto__|constructor)/);
    }
  }
  assert.equal({}.x, undefined);
});

test('the strict check holds every rule the normal one does', () => {
  const bad = [
    { cards: [card('a', { status: 'paused' })], todos: [] },
    { cards: [card('a'), card('a')], todos: [] },
    { cards: Array.from({ length: 51 }, (_, i) => card(`c${i}`)), todos: [] },
    { cards: [], todos: [{ id: 't', text: 'x' }, { id: 't', text: 'y' }] },
    { cards: [card('a', { colour: 'red' })], todos: [] },
  ];
  for (const r of bad) {
    assert.ok('error' in checkRoster(JSON.stringify(r)));
    assert.ok('error' in checkRoster(JSON.stringify(r), true));
  }
});

// --- the byte cap ------------------------------------------------------------------

test('the cap counts UTF-8 bytes of the text that is written, and refuses one byte over', () => {
  const empty = JSON.stringify({ cards: [], todos: [] });
  // One to-do whose text fills the roster to exactly the cap: ASCII padding,
  // then the same with one more byte.
  const base = JSON.stringify({ cards: [], todos: [{ id: 't', text: '' }] });
  const fill = MAX_ROSTER_BYTES - Buffer.byteLength(base);
  const at = { cards: [], todos: [{ id: 't', text: 'a'.repeat(fill) }] };
  assert.deepEqual(serialize(at), { value: JSON.stringify(at) });
  const over = { cards: [], todos: [{ id: 't', text: 'a'.repeat(fill + 1) }] };
  assert.match(serialize(over).error, new RegExp(`is ${MAX_ROSTER_BYTES + 1} bytes, over the cap of ${MAX_ROSTER_BYTES}`));
  // A four-byte character counts four.
  const wide = { cards: [], todos: [{ id: 't', text: '\u{1F600}'.repeat(Math.floor(fill / 4) + 1) }] };
  assert.ok('error' in serialize(wide));
  assert.deepEqual(serialize({ cards: [], todos: [] }), { value: empty });
});

test('the cap is 256 KiB', () => {
  assert.equal(MAX_ROSTER_BYTES, 256 * 1024);
});

// --- stat rejections ---------------------------------------------------------------

test('a rejection the engine gave for a missing path reads as missing, and nothing else does', () => {
  for (const template of Object.values(RECORDED.rejections)) {
    const message = template.replace('<plugin>', 'grimoire').replace('<path>', 'C:\\cfg\\x');
    assert.deepEqual(statRejection(message), { missing: true }, message);
  }
  // What a test's own `stat` hook answers reaches the mod this way.
  assert.deepEqual(statRejection('grimoire: $.fs.stat: failed: ENOENT'), { missing: true });
  for (const other of [
    'grimoire: $.fs.stat(C:\\x) failed: EACCES',
    'grimoire: $.fs.stat(C:\\x) failed: EPERM',
    'grimoire: $.fs.stat(C:\\ENOENT) failed: EIO',
    'no implementation for fs.stat',
    'ENOENTS',
  ]) {
    assert.ok('failed' in statRejection(other), other);
  }
});

// --- the path decision -------------------------------------------------------------

// A `stat` over a table: path -> answer. A path not in it is missing.
const statFrom = (table, log = []) => async path => {
  log.push(path);
  return table[path] ?? { missing: true };
};
const dir = realPath => ({ found: { kind: 'dir', size: 0, isLink: false, realPath } });
const file = (realPath, size = 10) => ({ found: { kind: 'file', size, isLink: false, realPath } });
// An answer built from the recording: the shape as the engine gave it, with
// the real path it would carry.
const recorded = (shape, realPath) => {
  const r = RECORDED.stats[shape];
  return { found: { kind: r.kind, size: 0, isLink: r.isLink, ...(r.realPath === 'none' ? {} : { realPath }) } };
};

const shapes = {
  windows: {
    config: 'C:\\cfg\\.claude',
    join: (...p) => p.join('\\'),
    other: 'D:\\elsewhere',
  },
  posix: {
    config: '/srv/u/.claude',
    join: (...p) => p.join('/'),
    other: '/srv/elsewhere',
  },
};

for (const [os, s] of Object.entries(shapes)) {
  const ID = 'grimoire-inline';
  const at = (...p) => s.join(s.config, ...p);
  const PLUGINS = at('plugins');
  const DATA = at('plugins', 'data');
  const IDDIR = at('plugins', 'data', ID);
  const BRIGADE = at('plugins', 'data', ID, 'brigade');
  const FILE = s.join(BRIGADE, `${SID}.json`);
  const all = (over = {}) => ({
    [s.config]: dir(s.config),
    [PLUGINS]: dir(PLUGINS),
    [DATA]: dir(DATA),
    [IDDIR]: dir(IDDIR),
    [BRIGADE]: dir(BRIGADE),
    ...over,
  });
  const place = (table, sid = SID, id = ID) => placeRoster(s.config, id, sid, statFrom(table));

  test(`${os}: every folder there and no file: the file may be created`, async () => {
    assert.deepEqual(await place(all()), { file: FILE });
  });

  test(`${os}: a roster file there is reported with its size`, async () => {
    assert.deepEqual(await place(all({ [FILE]: file(FILE, 42) })), { file: FILE, existing: { size: 42 } });
  });

  test(`${os}: a missing folder below plugins ends the walk, and the write creates it`, async () => {
    for (const gone of [DATA, IDDIR, BRIGADE]) {
      const t = all();
      for (const k of Object.keys(t)) if (k.startsWith(gone)) delete t[k];
      const log = [];
      assert.deepEqual(await placeRoster(s.config, ID, SID, statFrom(t, log)), { file: FILE }, gone);
      assert.equal(log.at(-1), gone, 'nothing is asked below a missing folder');
    }
  });

  test(`${os}: plugins missing is refused`, async () => {
    assert.deepEqual(await place({ [s.config]: dir(s.config) }), { refused: 'path: the config folder has no plugins folder' });
  });

  test(`${os}: a link at any folder is refused, whatever its kind`, async () => {
    const shapesOf = os === 'windows' ? ['junction', 'broken-junction', 'dir-symlink'] : ['dir-symlink'];
    for (const [name, path] of [['plugins', PLUGINS], ['data', DATA], [ID, IDDIR], ['brigade', BRIGADE]]) {
      for (const shape of shapesOf) {
        const r = await place(all({ [path]: recorded(shape, s.join(s.other, name)) }));
        assert.deepEqual(r, { refused: `link: ${name} is a link` }, `${shape} at ${name}`);
      }
    }
  });

  test(`${os}: a folder that leads elsewhere with no link flag is refused by the real-path compare`, async () => {
    // A mount point or a reparse kind `isLink` was never measured for.
    for (const [name, path] of [['plugins', PLUGINS], ['brigade', BRIGADE]]) {
      const r = await place(all({ [path]: dir(s.join(s.other, name)) }));
      assert.deepEqual(r, { refused: `link: ${name} does not lead where its name says` });
    }
  });

  test(`${os}: a folder with no real path, or not a folder, or a stat that fails, is refused`, async () => {
    assert.match((await place(all({ [DATA]: { found: { kind: 'dir', size: 0, isLink: false } } }))).refused, /^link: data does not lead/);
    assert.deepEqual(await place(all({ [DATA]: file(DATA) })), { refused: 'path: data is not a folder' });
    assert.match((await place(all({ [DATA]: { failed: 'EACCES' } }))).refused, /^path: data could not be read \(EACCES\)/);
  });

  test(`${os}: the roster file refused as a link, broken or not, as a non-file, or landing elsewhere`, async () => {
    const shapesOf = os === 'windows' ? ['file-symlink', 'broken-file-symlink', 'junction'] : ['file-symlink', 'broken-file-symlink'];
    for (const shape of shapesOf) {
      assert.deepEqual(await place(all({ [FILE]: recorded(shape, s.join(s.other, 'x.json')) })), { refused: 'link: the roster file is a link' }, shape);
    }
    assert.deepEqual(await place(all({ [FILE]: dir(FILE) })), { refused: 'path: the roster path is not a plain file' });
    assert.deepEqual(await place(all({ [FILE]: file(s.join(s.other, 'x.json')) })), { refused: 'link: the roster file does not lead where its name says' });
    assert.deepEqual(await place(all({ [FILE]: { found: { kind: 'file', size: 1, isLink: false } } })), { refused: 'link: the roster file does not lead where its name says' });
    assert.match((await place(all({ [FILE]: { failed: 'EPERM' } }))).refused, /^path: the roster file could not be read/);
  });

  test(`${os}: a hard link keeps its own spelling and is not caught here; the writer's strict check is what stops it`, async () => {
    const r = await place(all({ [FILE]: recorded('hard-link', FILE) }));
    assert.deepEqual(r, { file: FILE, existing: { size: 0 } });
  });

  test(`${os}: a config folder that is itself a link is resolved, not refused`, async () => {
    const real = s.join(s.other, 'real-config');
    const sub = (...p) => s.join(real, ...p);
    const t = {
      [s.config]: recorded(os === 'windows' ? 'junction' : 'dir-symlink', real),
      [PLUGINS]: dir(sub('plugins')),
      [DATA]: dir(sub('plugins', 'data')),
      [IDDIR]: dir(sub('plugins', 'data', ID)),
      [BRIGADE]: dir(sub('plugins', 'data', ID, 'brigade')),
    };
    assert.deepEqual(await place(t), { file: FILE });
    assert.deepEqual(await place({ ...t, [s.config]: { found: { kind: 'other', size: 0, isLink: true } } }), {
      refused: 'path: the config folder does not resolve to a folder',
    });
  });

  test(`${os}: a session id or data id out of shape is refused before any stat`, async () => {
    for (const [sid, id] of [['not-an-id', ID], [`${SID}/../x`, ID], [SID, '../x'], [SID, 'a b']]) {
      const log = [];
      const r = await placeRoster(s.config, id, sid, statFrom(all(), log));
      assert.match(r.refused, /^path: /);
      assert.deepEqual(log, []);
    }
  });
}

test('windows: the real-path compare ignores case and separators; posix: it does not ignore case', async () => {
  const C = 'C:\\cfg\\.claude';
  const ID = 'grimoire-inline';
  const t = {
    [C]: dir('c:/CFG/.Claude/'),
    [`${C}\\plugins`]: dir('C:\\cfg\\.claude\\Plugins'),
    [`${C}\\plugins\\data`]: dir('C:/cfg/.claude/plugins/DATA'),
  };
  assert.deepEqual(await placeRoster(C, ID, SID, statFrom(t)), { file: `${C}\\plugins\\data\\${ID}\\brigade\\${SID}.json` });
  const P = '/srv/u/.claude';
  const p = { [P]: dir(P), [`${P}/plugins`]: dir('/srv/u/.claude/Plugins') };
  assert.deepEqual(await placeRoster(P, ID, SID, statFrom(p)), { refused: 'link: plugins does not lead where its name says' });
});

test('case is folded for Windows paths and macOS homes and volumes only', () => {
  for (const p of ['C:\\x', 'c:/x', '\\\\server\\share', '/Users/a/.claude', '/Volumes/d/x']) assert.equal(foldsCase(p), true, p);
  for (const p of ['/srv/u/.claude', '/home/u', 'relative']) assert.equal(foldsCase(p), false, p);
});

test('the recording covers every link kind the guard is tested against', () => {
  for (const shape of ['folder', 'file', 'junction', 'broken-junction', 'dir-symlink', 'file-symlink', 'broken-file-symlink', 'hard-link']) {
    assert.ok(RECORDED.stats[shape], shape);
  }
  // What the guard leans on: every link says so, a broken one has no real
  // path, and a hard link does not look like a link at all.
  for (const shape of ['junction', 'broken-junction', 'dir-symlink', 'file-symlink', 'broken-file-symlink']) {
    assert.equal(RECORDED.stats[shape].isLink, true, shape);
  }
  assert.equal(RECORDED.stats['broken-junction'].realPath, 'none');
  assert.equal(RECORDED.stats['broken-file-symlink'].realPath, 'none');
  assert.equal(RECORDED.stats['hard-link'].isLink, false);
});

// --- Open in app: the route's pure rules -----------------------------------------
//
// Spec v3 on #212, decisions 5 and 10. Which card a press may send to the
// Desktop app's tool, whether the engine lists that tool, whether the owner's
// rules allow it, and what the app's answer means. The press itself is held
// by brigade/set-roster.test.ts under the engine's runner; the ceiling is held
// here, since the 2.1.289 engine declares none on a verdict.

const { appLink, listsOpenTool, readOpenAnswer, rulesAllowTool, toolSession } = roster;
const LOCAL = 'local_0123abcd-4567-89ab-cdef-0123456789ab';

test('only a Desktop id of the checked shape goes to the tool; every other card shape takes the link alone', () => {
  assert.equal(toolSession(card('a', { desktopId: LOCAL })), LOCAL);
  for (const over of [
    {},
    { url: 'https://claude.ai/code/session_ABC123' },
    { bgId: 'bg1' },
    { desktopId: 'local_NOT-HEX' },
    { desktopId: `${LOCAL}\n` },
    { desktopId: `local_${'a'.repeat(81)}` },
    { desktopId: 'session_ABC123' },
    { desktopId: `x${LOCAL}` },
  ]) {
    assert.equal(toolSession(card('a', over)), undefined, JSON.stringify(over));
  }
});

test('appLink is unchanged: a checked Desktop id, else a Remote Control link, else none', () => {
  assert.equal(appLink(card('a', { desktopId: LOCAL }), undefined), `claude://claude.ai/epitaxy/${LOCAL}`);
  assert.equal(appLink(card('a', { url: 'https://claude.ai/code/session_ABC123' }), undefined), 'claude://claude.ai/code/session_ABC123');
  assert.equal(appLink(card('a', { bgId: 'bg1' }), 'https://claude.ai/code/session_BG1'), 'claude://claude.ai/code/session_BG1');
  assert.equal(appLink(card('a', { bgId: 'bg1' }), undefined), undefined);
  assert.equal(appLink(card('a', { desktopId: 'local_NOT-HEX' }), undefined), undefined);
  assert.equal(appLink(card('a', { url: 'https://evil.example/code/session_A' }), undefined), undefined);
});

// Spec v4 on #220, decisions 1 and 4. The link route's program by host, and
// the real-path shape a Unix answer needs. The host reads themselves are held
// by brigade/set-roster.test.ts under the engine's runner.

const { HOST_PROBES, openerArgv, probeHost, unixRealPath, windowsEnv } = roster;

test('openerArgv gives the one program for each host and the link, as two entries', () => {
  for (const link of ['claude://claude.ai/epitaxy/' + LOCAL, 'claude://claude.ai/code/session_ABC123']) {
    assert.deepEqual(openerArgv('windows', link), ['explorer.exe', link]);
    assert.deepEqual(openerArgv('macos', link), ['/usr/bin/open', link]);
    assert.deepEqual(openerArgv('linux', link), ['/usr/bin/xdg-open', link]);
    for (const os of ['windows', 'macos', 'linux']) assert.equal(openerArgv(os, link).length, 2);
  }
});

test('a Unix answer needs a raw real path with one leading / then a non-separator, and no \\ anywhere', () => {
  for (const p of ['/System/Library/CoreServices/SystemVersion.plist', '/usr/bin/xdg-open', '/x']) {
    assert.equal(unixRealPath(p), true, p);
  }
  for (const p of [
    'C:\\System\\Library\\CoreServices\\SystemVersion.plist',
    'C:/System/Library/CoreServices/SystemVersion.plist',
    '\\\\server\\share\\System\\Library\\CoreServices\\SystemVersion.plist',
    '//server/share/System/Library/CoreServices/SystemVersion.plist',
    '/\\server\\share',
    '/usr\\bin\\xdg-open',
    '\\usr\\bin\\xdg-open',
    'usr/bin/xdg-open',
    '/',
    '',
  ]) {
    assert.equal(unixRealPath(p), false, p);
  }
});

test('Windows is named by its environment alone: OS=Windows_NT, or SystemRoot or windir set', () => {
  assert.equal(windowsEnv('OS', 'Windows_NT'), true);
  assert.equal(windowsEnv('OS', 'Darwin'), false);
  assert.equal(windowsEnv('OS', undefined), false);
  assert.equal(windowsEnv('SystemRoot', 'C:\\Windows'), true);
  assert.equal(windowsEnv('SystemRoot', ''), true);
  assert.equal(windowsEnv('SystemRoot', undefined), false);
  assert.equal(windowsEnv('windir', 'C:\\Windows'), true);
  assert.equal(windowsEnv('windir', undefined), false);
});

test('the probes are macOS then Linux, at their fixed paths', () => {
  assert.deepEqual(HOST_PROBES, [
    ['macos', '/System/Library/CoreServices/SystemVersion.plist'],
    ['linux', '/usr/bin/xdg-open'],
  ]);
});

test('a probe names its host only for a file with a Unix real path; missing asks the next; anything else is no host', () => {
  const file = (realPath) => ({ found: { kind: 'file', size: 1, isLink: false, realPath } });
  assert.equal(probeHost('macos', file('/System/Library/CoreServices/SystemVersion.plist')), 'macos');
  assert.equal(probeHost('linux', file('/usr/bin/xdg-open')), 'linux');
  assert.equal(probeHost('macos', { missing: true }), 'next');
  assert.equal(probeHost('macos', { failed: 'EACCES' }), undefined);
  assert.equal(probeHost('linux', { found: { kind: 'dir', size: 1, isLink: false, realPath: '/usr/bin/xdg-open' } }), undefined);
  assert.equal(probeHost('linux', { found: { kind: 'other', size: 1, isLink: false, realPath: '/usr/bin/xdg-open' } }), undefined);
  assert.equal(probeHost('linux', file(undefined)), undefined);
  assert.equal(probeHost('macos', file('C:\\System\\Library\\CoreServices\\SystemVersion.plist')), undefined);
  assert.equal(probeHost('macos', file('\\\\server\\share\\SystemVersion.plist')), undefined);
});

test('the tool is listed only under its exact name, in a list', () => {
  assert.equal(listsOpenTool([{ name: 'mcp__ccd_window__open_session_in', description: '', mcp: true }]), true);
  assert.equal(listsOpenTool([{ name: 'Bash' }, { name: 'mcp__ccd_window__open_session_in' }]), true);
  for (const tools of [
    [],
    [{ name: 'mcp__ccd_window__open_session_in_v2' }],
    [{ name: 'mcp__ccd window__open_session_in' }],
    [{ name: 'MCP__CCD_WINDOW__OPEN_SESSION_IN' }],
    [null, 'mcp__ccd_window__open_session_in'],
    { name: 'mcp__ccd_window__open_session_in' },
    undefined,
    'mcp__ccd_window__open_session_in',
  ]) {
    assert.equal(listsOpenTool(tools), false, JSON.stringify(tools));
  }
});

test("the owner's rules: allow and a mode's ask go on; a deny, a rule's ask, a lower ceiling or anything else stops", () => {
  for (const v of [
    { decision: 'allow' },
    { decision: 'ask' },
    { decision: 'ask', reason: 'the mode asks' },
    { decision: 'allow', ceiling: 'allow' },
    { decision: 'ask', ceiling: 'allow' },
  ]) {
    assert.equal(rulesAllowTool(v), true, JSON.stringify(v));
  }
  for (const v of [
    { decision: 'deny' },
    { decision: 'deny', reason: 'no' },
    { decision: 'ask', rule: 'mcp__ccd_window__open_session_in' },
    { decision: 'ask', rule: 'mcp__ccd_window' },
    { decision: 'ask', rule: '' },
    { decision: 'allow', ceiling: 'ask' },
    { decision: 'allow', ceiling: 'deny' },
    { decision: 'ask', ceiling: 'ask' },
    { decision: 'allow', ceiling: null },
    { decision: 'maybe' },
    {},
    null,
    undefined,
    'allow',
  ]) {
    assert.equal(rulesAllowTool(v), false, JSON.stringify(v));
  }
});

test("the app's answer has exactly one of three outcomes, and nothing in reading it throws", () => {
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
  assert.deepEqual(readOpenAnswer(text('Opened session in a split pane.\nMore')), { opened: true, toast: 'Opened session in a split pane.' });
  assert.deepEqual(readOpenAnswer(text('Opened\r\nMore')), { opened: true, toast: 'Opened' });
  assert.deepEqual(readOpenAnswer(text('Opened\u{2028}More')), { opened: true, toast: 'Opened' });
  // Success without text: the fixed line.
  for (const content of [[], [{ type: 'image', data: '', mimeType: 'image/png' }], [{ type: 'text', text: 7 }], [{ type: 'text' }], [null], [{ type: 'text', text: '' }], [{ type: 'text', text: '\nlater' }]]) {
    assert.deepEqual(readOpenAnswer({ content, isError: false }), { opened: true, toast: 'Opened in the app.' }, JSON.stringify(content));
  }
  // Not a success: the link route, with the app's words when it refused in text.
  assert.deepEqual(readOpenAnswer(text('was not started from this session.\nUse window', true)), {
    opened: false,
    reason: 'The app did not open it: was not started from this session.',
  });
  for (const answer of [
    { content: [], isError: true },
    { content: [{ type: 'image' }], isError: true },
    { content: [{ type: 'text', text: 'ok' }] },
    { content: [{ type: 'text', text: 'ok' }], isError: 'false' },
    { content: [{ type: 'text', text: 'ok' }], isError: 0 },
    { content: 'ok', isError: false },
    { content: { 0: { type: 'text', text: 'ok' } }, isError: false },
    null,
    undefined,
    'Opened',
    [],
  ]) {
    assert.deepEqual(readOpenAnswer(answer), { opened: false }, JSON.stringify(answer));
  }
});

test("the app's text is cleaned and cut to 200 characters, whether it opened or refused", () => {
  const raw = `\u{1B}[31mOpened\u{7}\u{200B} \u{2066}split\u{2069}\u{202E}\t${'x'.repeat(400)}`;
  const opened = readOpenAnswer({ content: [{ type: 'text', text: raw }], isError: false });
  assert.equal(opened.opened, true);
  assert.equal([...opened.toast].length, 200);
  assert.ok(opened.toast.startsWith('[31mOpened split xxx'), opened.toast);
  assert.ok(opened.toast.endsWith('…'));
  assert.doesNotMatch(opened.toast, /[\u{0}-\u{1F}\u{7F}-\u{9F}\u{200B}\u{202E}\u{2066}\u{2069}]/u);
  const refused = readOpenAnswer({ content: [{ type: 'text', text: raw }], isError: true });
  assert.equal(refused.reason, `The app did not open it: ${opened.toast}`);
});
test('an answer whose field throws when read is not an answer, and the reader does not throw', () => {
  const answer = { content: [], get isError() { throw new Error('planted'); } };
  assert.deepEqual(readOpenAnswer(answer), { opened: false });
  const block = { get type() { throw new Error('planted'); } };
  assert.deepEqual(readOpenAnswer({ content: [block], isError: false }), { opened: false });
});
// --- the summary path (#311) ----------------------------------------------------
//
// Spec revision 5 on #304, S4: the roster's path rule, generalized to take the
// file's place. A session's usage summary lives at
// <data>/brigade/usage/<session id>.json, a folder apart from the rosters, so
// a session that is both a lead and a member never writes one over the other.

const { placeSummary, rosterFile } = roster;

for (const [os, s] of Object.entries(shapes)) {
  const ID = 'grimoire-inline';
  const at = (...p) => s.join(s.config, ...p);
  const PLUGINS = at('plugins');
  const DATA = at('plugins', 'data');
  const IDDIR = at('plugins', 'data', ID);
  const BRIGADE = at('plugins', 'data', ID, 'brigade');
  const USAGE = at('plugins', 'data', ID, 'brigade', 'usage');
  const FILE = s.join(USAGE, `${SID}.json`);
  const all = (over = {}) => ({
    [s.config]: dir(s.config),
    [PLUGINS]: dir(PLUGINS),
    [DATA]: dir(DATA),
    [IDDIR]: dir(IDDIR),
    [BRIGADE]: dir(BRIGADE),
    [USAGE]: dir(USAGE),
    ...over,
  });
  const place = (table, sid = SID, id = ID) => placeSummary(s.config, id, sid, statFrom(table));

  test(`${os}: the summary file sits in the usage folder, apart from the roster of the same session`, async () => {
    assert.deepEqual(await place(all()), { file: FILE });
    assert.notEqual(FILE, s.join(BRIGADE, `${SID}.json`));
    assert.notEqual(FILE, rosterFile(at('plugins', 'data', ID), SID));
    assert.deepEqual(await place(all({ [FILE]: file(FILE, 300) })), { file: FILE, existing: { size: 300 } });
  });

  test(`${os}: a missing folder below plugins ends the summary walk, the usage folder included`, async () => {
    for (const gone of [DATA, IDDIR, BRIGADE, USAGE]) {
      const t = all();
      for (const k of Object.keys(t)) if (k.startsWith(gone)) delete t[k];
      const log = [];
      assert.deepEqual(await placeSummary(s.config, ID, SID, statFrom(t, log)), { file: FILE }, gone);
      assert.equal(log.at(-1), gone, 'nothing is asked below a missing folder');
    }
  });

  test(`${os}: a recorded junction or link at usage, or at any folder above it, is refused`, async () => {
    const shapesOf = os === 'windows' ? ['junction', 'broken-junction', 'dir-symlink'] : ['dir-symlink'];
    for (const [name, path] of [['plugins', PLUGINS], ['data', DATA], [ID, IDDIR], ['brigade', BRIGADE], ['usage', USAGE]]) {
      for (const shape of shapesOf) {
        assert.deepEqual(await place(all({ [path]: recorded(shape, s.join(s.other, name)) })), { refused: `link: ${name} is a link` }, `${shape} at ${name}`);
      }
    }
    // A usage folder that leads elsewhere with no link flag: the real-path compare.
    assert.deepEqual(await place(all({ [USAGE]: dir(s.join(s.other, 'usage')) })), { refused: 'link: usage does not lead where its name says' });
    assert.deepEqual(await place(all({ [USAGE]: file(USAGE) })), { refused: 'path: usage is not a folder' });
  });

  test(`${os}: the summary file refused as a link, as a non-file, or landing elsewhere`, async () => {
    const shapesOf = os === 'windows' ? ['file-symlink', 'broken-file-symlink', 'junction'] : ['file-symlink', 'broken-file-symlink'];
    for (const shape of shapesOf) {
      assert.deepEqual(await place(all({ [FILE]: recorded(shape, s.join(s.other, 'x.json')) })), { refused: 'link: the summary file is a link' }, shape);
    }
    assert.deepEqual(await place(all({ [FILE]: dir(FILE) })), { refused: 'path: the summary path is not a plain file' });
    assert.deepEqual(await place(all({ [FILE]: file(s.join(s.other, 'x.json')) })), { refused: 'link: the summary file does not lead where its name says' });
    assert.match((await place(all({ [FILE]: { failed: 'EPERM' } }))).refused, /^path: the summary file could not be read/);
  });

  test(`${os}: the summary path keeps the session-id and data-id shape checks, before any stat`, async () => {
    for (const [sid, id] of [['not-an-id', ID], [`${SID}/../x`, ID], [`..\\${SID}`, ID], [SID, '../x'], [SID, 'a b']]) {
      const log = [];
      const r = await placeSummary(s.config, id, sid, statFrom(all(), log));
      assert.match(r.refused, /^path: /);
      assert.deepEqual(log, []);
    }
  });
}

// --- the decision log's and the marks' paths (spec 402, S5.1; claim 5) -----------
//
// The same rule again, one folder past brigade: <data>/brigade/decisions and
// <data>/brigade/marks, each file named by its session id.

const { placeDecisions, placeMarks } = roster;

for (const [os, s] of Object.entries(shapes)) {
  for (const [kind, folder, placeKind] of [['decision log', 'decisions', placeDecisions], ['marks', 'marks', placeMarks]]) {
    const ID = 'grimoire-inline';
    const at = (...p) => s.join(s.config, ...p);
    const BRIGADE = at('plugins', 'data', ID, 'brigade');
    const FOLDER = s.join(BRIGADE, folder);
    const FILE = s.join(FOLDER, `${SID}.json`);
    const all = (over = {}) => ({
      [s.config]: dir(s.config),
      [at('plugins')]: dir(at('plugins')),
      [at('plugins', 'data')]: dir(at('plugins', 'data')),
      [at('plugins', 'data', ID)]: dir(at('plugins', 'data', ID)),
      [BRIGADE]: dir(BRIGADE),
      [FOLDER]: dir(FOLDER),
      ...over,
    });
    const place = (table, sid = SID) => placeKind(s.config, ID, sid, statFrom(table));

    test(`${os}: the ${kind} file sits in brigade/${folder}, under the roster's path rule`, async () => {
      assert.deepEqual(await place(all()), { file: FILE });
      assert.deepEqual(await place(all({ [FILE]: file(FILE, 300) })), { file: FILE, existing: { size: 300 } });
      const shapesOf = os === 'windows' ? ['junction', 'broken-junction', 'dir-symlink'] : ['dir-symlink'];
      for (const shape of shapesOf) {
        assert.deepEqual(await place(all({ [FOLDER]: recorded(shape, s.join(s.other, folder)) })), { refused: `link: ${folder} is a link` }, shape);
      }
      assert.deepEqual(await place(all({ [FOLDER]: dir(s.join(s.other, folder)) })), { refused: `link: ${folder} does not lead where its name says` });
      const fileShapes = os === 'windows' ? ['file-symlink', 'broken-file-symlink', 'junction'] : ['file-symlink', 'broken-file-symlink'];
      for (const shape of fileShapes) {
        assert.match((await place(all({ [FILE]: recorded(shape, s.join(s.other, 'x.json')) }))).refused, /^link: the .* file is a link$/, shape);
      }
      assert.match((await place(all({ [FILE]: file(s.join(s.other, 'x.json')) }))).refused, /^link: .* does not lead where its name says$/);
      assert.match((await place({}, 'not-an-id')).refused, /^path: /);
    });
  }
}

test('the roster path is unchanged by the generalized rule: it never walks into usage', async () => {
  const C = 'C:\\cfg\\.claude';
  const ID = 'grimoire-inline';
  const log = [];
  const t = {
    [C]: dir(C),
    [`${C}\\plugins`]: dir(`${C}\\plugins`),
    [`${C}\\plugins\\data`]: dir(`${C}\\plugins\\data`),
    [`${C}\\plugins\\data\\${ID}`]: dir(`${C}\\plugins\\data\\${ID}`),
    [`${C}\\plugins\\data\\${ID}\\brigade`]: dir(`${C}\\plugins\\data\\${ID}\\brigade`),
  };
  assert.deepEqual(await placeRoster(C, ID, SID, statFrom(t, log)), { file: `${C}\\plugins\\data\\${ID}\\brigade\\${SID}.json` });
  assert.ok(!log.some(p => p.includes('usage')));
});

test('dataPlace: the config folder from the install path, else from the start record', () => {
  const { dataPlace } = roster;
  const start = { sessionId: SID, transcript: `C:\\cfg\\.claude\\projects\\C--work\\${SID}.jsonl` };
  assert.deepEqual(dataPlace('C:\\cfg\\.claude\\plugins\\cache\\market\\grimoire\\0.60.0', 'grimoire', start), { config: 'C:\\cfg\\.claude', plugin: 'grimoire-market' });
  // The install path comes first: a start record under another config folder does not move it.
  const elsewhere = { sessionId: SID, transcript: `D:\\other\\.claude\\projects\\C--work\\${SID}.jsonl` };
  assert.deepEqual(dataPlace('C:\\cfg\\.claude\\plugins\\cache\\market\\grimoire\\0.60.0', 'grimoire', elsewhere), { config: 'C:\\cfg\\.claude', plugin: 'grimoire-market' });
  assert.deepEqual(dataPlace('C:\\work\\grimoire', 'grimoire', elsewhere), { config: 'D:\\other\\.claude', plugin: 'grimoire-inline' });
  assert.deepEqual(dataPlace('C:\\work\\grimoire', 'grimoire', start), { config: 'C:\\cfg\\.claude', plugin: 'grimoire-inline' });
});

test('dataPlace: Desktop\'s synced install folder names the config folder, after the install path and the start record', () => {
  const { dataPlace } = roster;
  const none = { sessionId: '', transcript: '' };
  const want = { config: 'C:\\cfg\\.claude', plugin: 'grimoire-inline' };
  assert.deepEqual(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\grimoire~g2', 'grimoire', none), want);
  assert.deepEqual(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\grimoire', 'grimoire', none), want);
  assert.deepEqual(dataPlace('/cfg/.claude/plugins/synced/abc123/grimoire~g12', 'grimoire', none), { config: '/cfg/.claude', plugin: 'grimoire-inline' });
  // Two folders between synced and the plugin, another plugin's name, or nothing after the id folder: no config folder.
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\a\\b\\grimoire', 'grimoire', none).config, undefined);
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\other', 'grimoire', none).config, undefined);
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123', 'grimoire', none).config, undefined);
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\other~g2', 'grimoire', none).config, undefined);
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\grimoire~g', 'grimoire', none).config, undefined);
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\grimoire\\sub', 'grimoire', none).config, undefined);
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\grimoire~gx', 'grimoire', none).config, undefined);
  // The start record wins over the synced form.
  const start = { sessionId: SID, transcript: `D:\\other\\.claude\\projects\\C--work\\${SID}.jsonl` };
  assert.deepEqual(dataPlace('C:\\cfg\\.claude\\plugins\\synced\\abc123\\grimoire', 'grimoire', start), { config: 'D:\\other\\.claude', plugin: 'grimoire-inline' });
  // The install path wins over both.
  assert.equal(dataPlace('C:\\cfg\\.claude\\plugins\\cache\\market\\grimoire\\0.60.0', 'grimoire', start).config, 'C:\\cfg\\.claude');
});

test('dataPlace: a start record of another session still names its config folder; a bad record names none', () => {
  const { dataPlace } = roster;
  const OTHER = '99999999-8888-7777-6666-555555555555';
  const root = 'C:\\work\\grimoire';
  const good = { sessionId: OTHER, transcript: `C:\\cfg\\.claude\\projects\\C--work\\${OTHER}.jsonl` };
  assert.deepEqual(dataPlace(root, 'grimoire', good), { config: 'C:\\cfg\\.claude', plugin: 'grimoire-inline' });
  // The file name does not match the record's own id.
  assert.equal(dataPlace(root, 'grimoire', { ...good, transcript: `C:\\cfg\\.claude\\projects\\C--work\\${SID}.jsonl` }).config, undefined);
  // The id is off the engine's shape.
  assert.equal(dataPlace(root, 'grimoire', { sessionId: 'x', transcript: 'C:\\cfg\\.claude\\projects\\C--work\\x.jsonl' }).config, undefined);
  // The fields are not text.
  assert.equal(dataPlace(root, 'grimoire', { sessionId: OTHER, transcript: [good.transcript] }).config, undefined);
  assert.equal(dataPlace(root, 'grimoire', { sessionId: 7, transcript: good.transcript }).config, undefined);
});

// --- issue 339: the card's PR fields, the stamp and the gh answer ------------------

const { parsePrList, stampSince } = roster;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const fileCheck = over => checkRoster(JSON.stringify({ cards: [card('a', over)], todos: [] }), true, 'file');
const toolCheck = over => checkRoster(JSON.stringify({ cards: [card('a', over)], todos: [] }), true, 'tool');

test('a card takes pr as 1 to 7 digits and prState as open, merged or closed, from the file and from the tool', () => {
  for (const check of [fileCheck, toolCheck]) {
    assert.deepEqual(check({ pr: '1', prState: 'open' }).value.cards[0], card('a', { pr: '1', prState: 'open' }));
    assert.equal(check({ pr: '9999999', prState: 'merged' }).value.cards[0].pr, '9999999');
    assert.equal(check({ prState: 'closed' }).value.cards[0].prState, 'closed');
    for (const [over, field] of [
      [{ pr: 'abc' }, 'pr'],
      [{ pr: '' }, 'pr'],
      [{ pr: '12345678' }, 'pr'],
      [{ pr: 341 }, 'pr'],
      [{ pr: '-1' }, 'pr'],
      [{ prState: 'constructor' }, 'prState'],
      [{ prState: 'OPEN' }, 'prState'],
      [{ prState: 1 }, 'prState'],
    ]) {
      const r = check(over);
      assert.ok('error' in r, JSON.stringify(over));
      assert.match(r.error, new RegExp(`^card 1 ${field} `), JSON.stringify(over));
    }
  }
});

test('since comes from the file as a whole number from 0 to 2^53 - 1, and never from the tool', () => {
  assert.equal(fileCheck({ since: 0 }).value.cards[0].since, 0);
  assert.equal(fileCheck({ since: MAX_SAFE }).value.cards[0].since, MAX_SAFE);
  for (const since of [MAX_SAFE + 1, 2 ** 53, -1, 1.5, '5', null, true, {}]) {
    const r = fileCheck({ since });
    assert.ok('error' in r, String(since));
    assert.match(r.error, /^card 1 since /);
  }
  const fromTool = toolCheck({ since: 5 });
  assert.ok('error' in fromTool);
  assert.match(fromTool.error, /^card 1 since /);
  assert.match(fromTool.error, /tool/);
  // The default source is the file's.
  assert.equal(checkRoster(JSON.stringify({ cards: [card('a', { since: 7 })], todos: [] })).value.cards[0].since, 7);
});

test('the stamp keeps a card\'s since when its drawn title and status match and the kept value is sane', () => {
  const now = 10_000_000;
  const before = { cards: [card('alpha', { since: 5_000 }), card('beta', { since: 6_000 })], todos: [] };
  const next = [card('alpha'), card('beta', { status: 'stopped' }), card('gamma')];
  const r = stampSince(before, next, now);
  assert.deepEqual(r.value.map(c => c.since), [5_000, now, now]);
  // Titles are matched as drawn: a hidden character does not make a new card.
  const hidden = stampSince(before, [card('al\u{200b}pha')], now);
  assert.equal(hidden.value[0].since, 5_000);
  // A status change restamps.
  assert.equal(stampSince(before, [card('alpha', { status: 'done' })], now).value[0].since, now);
  // No previous roster stamps everything.
  assert.equal(stampSince(undefined, [card('alpha')], now).value[0].since, now);
});

test('the stamp drops a kept since that is not sane or is more than 2 minutes ahead of the clock', () => {
  const now = 10_000_000;
  const ahead = { cards: [card('a', { since: now + 120_000 + 1 })], todos: [] };
  assert.equal(stampSince(ahead, [card('a')], now).value[0].since, now);
  const edge = { cards: [card('a', { since: now + 120_000 })], todos: [] };
  assert.equal(stampSince(edge, [card('a')], now).value[0].since, now + 120_000);
  const bad = { cards: [card('a', { since: 2 ** 53 })], todos: [] };
  assert.equal(stampSince(bad, [card('a')], now).value[0].since, now);
});

test('the stamp refuses a clock answer that is not a whole number from 0 to 2^53 - 1', () => {
  for (const clock of [1.5, NaN, Infinity, -1, 2 ** 53, '5', undefined, null, {}]) {
    const r = stampSince(undefined, [card('a')], clock);
    assert.ok('error' in r, String(clock));
    assert.match(r.error, /clock/);
  }
  assert.ok('value' in stampSince(undefined, [card('a')], 0));
});

test('a stamped roster passes the strict file check, prototype-keyed titles included', () => {
  const stamped = stampSince(undefined, [card('constructor'), card('__proto__')], 1).value;
  assert.deepEqual(stamped.map(c => c.since), [1, 1]);
  assert.ok('value' in checkRoster(JSON.stringify({ cards: stamped, todos: [] }), true, 'file'));
});

// The gh answer: untrusted text, read by shape.
const pr = (over = {}) => ({
  number: 341,
  title: 'A title',
  state: 'OPEN',
  additions: 10,
  deletions: 2,
  updatedAt: '2026-10-18T10:00:00Z',
  url: 'https://github.com/owner/repo/pull/341',
  isCrossRepository: false,
  ...over,
});
const parse = list => parsePrList(JSON.stringify(list));

test('the gh parser keeps an entry of the stated shape, keyed by number, with the repository from the URL', () => {
  const r = parse([pr()]);
  const got = r.value.get(341);
  assert.equal(got.title, 'A title');
  assert.equal(got.state, 'open');
  assert.equal(got.additions, 10);
  assert.equal(got.deletions, 2);
  assert.equal(got.repo, 'owner/repo');
  assert.equal(got.updatedAt, Date.UTC(2026, 9, 18, 10, 0, 0));
  assert.equal(parse([pr({ state: 'MERGED' })]).value.get(341).state, 'merged');
  assert.equal(parse([pr({ state: 'CLOSED' })]).value.get(341).state, 'closed');
});

test('issue 545: an open pull request that gh calls a draft parses as draft; only an open one can be a draft', () => {
  assert.equal(parse([pr({ isDraft: true })]).value.get(341).state, 'draft');
  assert.equal(parse([pr({ isDraft: false })]).value.get(341).state, 'open');
  assert.equal(parse([pr()]).value.get(341).state, 'open');
  assert.equal(parse([pr({ isDraft: 'true' })]).value.get(341).state, 'open');
  assert.equal(parse([pr({ state: 'MERGED', isDraft: true })]).value.get(341).state, 'merged');
  assert.equal(parse([pr({ state: 'CLOSED', isDraft: true })]).value.get(341).state, 'closed');
  assert.ok(roster.GH_ARGV.at(-1).split(',').includes('isDraft'));
});

test('issue 545: a card may carry prState draft, and the lead\'s tool takes it', () => {
  assert.ok(roster.PR_STATES.includes('draft'));
  for (const check of [fileCheck, toolCheck]) assert.equal(check({ pr: '5', prState: 'draft' }).value.cards[0].prState, 'draft');
});

test('the gh parser drops every entry of a wrong shape and never throws', () => {
  const bad = [
    null,
    7,
    'text',
    [],
    pr({ title: 5 }),
    pr({ title: 'x'.repeat(1001) }),
    pr({ state: 'constructor' }),
    pr({ state: '__proto__' }),
    pr({ state: 'open' }),
    pr({ number: 10_000_000 }),
    pr({ number: 0 }),
    pr({ number: 1.5 }),
    pr({ number: '341' }),
    pr({ additions: 100_000_001 }),
    pr({ additions: -1 }),
    pr({ deletions: 1.5 }),
    pr({ updatedAt: '2026-10-18T10:00:00+02:00' }),
    pr({ updatedAt: 'yesterday' }),
    pr({ url: 'https://github.com/owner/repo/pull/342' }),
    pr({ url: 'http://github.com/owner/repo/pull/341' }),
    pr({ url: 'https://evil.example/owner/repo/pull/341' }),
    pr({ url: 'https://github.com/owner/repo/pull/341/files' }),
    pr({ url: 'https://github.com/owner/re po/pull/341' }),
    pr({ isCrossRepository: true }),
    pr({ isCrossRepository: undefined }),
    pr({ isCrossRepository: 'false' }),
  ];
  for (const entry of bad) {
    const r = parse([entry]);
    assert.equal(r.value.size, 0, JSON.stringify(entry));
  }
  // An array is no plain object.
  assert.equal(parse([Object.assign([], pr())]).value.size, 0);
});

test('the gh parser looks at the first 100 entries only', () => {
  const list = Array.from({ length: 101 }, (_, i) => pr({ number: i + 1, url: `https://github.com/o/r/pull/${i + 1}` }));
  const r = parse(list);
  assert.equal(r.value.size, 100);
  assert.equal(r.value.has(101), false);
  assert.equal(r.value.has(100), true);
});

test('the gh parser refuses output that is not a list, is not JSON, or is over 1 MiB, and its error carries none of the output', () => {
  assert.ok('error' in parsePrList('not json'));
  assert.ok('error' in parsePrList('{"a":1}'));
  assert.ok('error' in parsePrList('null'));
  assert.ok('error' in parsePrList(JSON.stringify([pr()]) + ' '.repeat(1024 * 1024)));
  // Bytes, not characters: 600 KiB of 2-byte characters is over the cap.
  assert.ok('error' in parsePrList(JSON.stringify(['\u{e9}'.repeat(600 * 1024)])));
  // The same text under 1 MiB of characters is valid JSON: only the byte count refuses it.
  assert.ok('value' in parsePrList(JSON.stringify(['\u{e9}'.repeat(100 * 1024)])));
  assert.doesNotMatch(parsePrList('SECRET_MARKER').error, /SECRET_MARKER/);
});

test('the gh title is cleaned and cut to 80 characters', () => {
  const r = parse([pr({ title: `a\u{202e}b\u{7}${'c'.repeat(200)}` })]);
  const title = r.value.get(341).title;
  assert.equal([...title].length, 80);
  assert.doesNotMatch(title, /[\u{202e}\u{7}]/u);
  assert.ok(r.value instanceof Map);
});

// --- a head-chef load where the security default is seated (#380) ------------
//
// spec rev 3 on #380, S3, and the owner's q5 and q6 there: a typed load opens
// the pane only when core answered it, and the session's local skill listing
// shows one copy of the name, and it is ours. A model's Skill load counts as
// run only when the Skill tool says it succeeded.

const { listedAsOurs, skillLoadRan, typedLoadRan } = roster;
const listing = (skills, total = skills.length) => ({ totalSkills: total, includedSkills: skills.length, skillFrontmatter: skills });
const PLUGIN_COPY = { name: 'grimoire:head-chef', source: 'plugin', pluginName: 'grimoire' };
const USER_COPY = { name: 'head-chef', source: 'userSettings' };

test('the listing confirms our copy only when it is the one copy of its name, and the listing is whole', () => {
  assert.equal(listedAsOurs(listing([PLUGIN_COPY, USER_COPY]), 'grimoire:head-chef'), true);
  assert.equal(listedAsOurs(listing([PLUGIN_COPY, USER_COPY]), 'head-chef'), true);
  // Another plugin's copy, a second copy, a project copy beside the owner's, no copy, a partial listing, none.
  assert.equal(listedAsOurs(listing([{ ...PLUGIN_COPY, pluginName: 'other' }]), 'grimoire:head-chef'), false);
  assert.equal(listedAsOurs(listing([PLUGIN_COPY, { ...PLUGIN_COPY, pluginName: 'other' }]), 'grimoire:head-chef'), false);
  assert.equal(listedAsOurs(listing([USER_COPY, { name: 'head-chef', source: 'projectSettings' }]), 'head-chef'), false);
  assert.equal(listedAsOurs(listing([{ name: 'groundtrack', source: 'plugin', pluginName: 'grimoire' }]), 'head-chef'), false);
  assert.equal(listedAsOurs(listing([USER_COPY], 200), 'head-chef'), false);
  assert.equal(listedAsOurs(undefined, 'head-chef'), false);
  assert.equal(listedAsOurs({ skillFrontmatter: [USER_COPY] }, 'head-chef'), false);
});

test('a typed load ran only when core answered it with its ref', () => {
  assert.equal(typedLoadRan({ text: '', ref: 'r' }), true);
  assert.equal(typedLoadRan({ text: '' }), false);
  assert.equal(typedLoadRan({ deny: 'no' }), false);
  assert.equal(typedLoadRan(undefined), false);
});

test('a Skill load ran only when the Skill tool says it succeeded', () => {
  assert.equal(skillLoadRan({ ref: 'r', result: { success: true, commandName: 'head-chef' }, text: '' }), true);
  assert.equal(skillLoadRan({ ref: 'r', result: { success: false, commandName: 'head-chef' }, text: '' }), false);
  assert.equal(skillLoadRan({ ref: 'r', result: { success: true }, text: '', isError: true }), false);
  assert.equal(skillLoadRan({ deny: 'the owner refused the skill' }), false);
  assert.equal(skillLoadRan({ ref: 'r', result: 'no such skill', text: '' }), false);
  assert.equal(skillLoadRan(null), false);
});

// --- issue 415: a card's repository and the per-repository gh run ----------------

const { GH_ARGV, REPO, answerFor, ghRun, ghViewRun, rotate } = roster;

// Each is refused wherever a card is read: a host part, a dotted owner, a
// leading hyphen or dot, `.` and `..`, an owner over 39 or a name over 100,
// a character outside the set (a space, a line break, a hidden one, `?`, `#`,
// `_` in the owner), a URL, a missing or extra segment, and a value that is
// not text.
const BAD_REPOS = [
  'o', 'o/r/x', 'github.com/o', 'ghe.example/o/r', 'https://github.com/o/r', '/o/r', 'o/', '/r', 'o//r',
  '-o/r', 'o/-r', 'o/.r', 'o/.', 'o/..', `${'a'.repeat(40)}/r`, `o/${'r'.repeat(101)}`,
  'o/r ', ' o/r', 'o /r', 'o/r\n', 'o\u{200B}/r', 'o/r?x', 'o/r#1', 'o_x/r', 'o.x/r', '', 1, null, ['o/r'],
];
const GOOD_REPOS = ['o/r', 'O/R', 'a-b/c.d_e-f', 'o/_x', 'o/r.', `${'a'.repeat(39)}/${'r'.repeat(100)}`, 'mephistopheles4/grimoire'];

test('a card may carry repo, a plain owner/name, from the file and from the tool, strict or not', () => {
  for (const repo of GOOD_REPOS) {
    for (const strict of [false, true]) {
      for (const source of ['file', 'tool']) {
        const r = checkRoster(JSON.stringify({ cards: [card('a', { pr: '7', repo })], todos: [] }), strict, source);
        assert.equal(r.value?.cards[0].repo, repo, `${repo} ${strict} ${source}`);
      }
    }
  }
  assert.equal('repo' in checkRoster(JSON.stringify({ cards: [card('a')], todos: [] })).value.cards[0], false);
});

test('any other repo value fails the roster\'s read and the tool, names the field and never echoes the value', () => {
  for (const repo of BAD_REPOS) {
    for (const strict of [false, true]) {
      for (const source of ['file', 'tool']) {
        const r = checkRoster(JSON.stringify({ cards: [card('a', { repo })], todos: [] }), strict, source);
        assert.equal(r.error, 'card 1 repo is not a plain owner/name', `${JSON.stringify(repo)} ${strict} ${source}`);
      }
    }
  }
});

test('the repo pattern matches the whole value and is the one the tool\'s schema takes', () => {
  for (const repo of GOOD_REPOS) assert.match(repo, REPO);
  for (const repo of BAD_REPOS) if (typeof repo === 'string') assert.doesNotMatch(repo, REPO, repo);
  assert.ok(REPO.source.startsWith('^') && REPO.source.endsWith('$'));
});

test('the base run is the fixed list with no environment; a named run is the same list with the repository as GH_REPO alone', () => {
  assert.deepEqual(ghRun(), { argv: GH_ARGV, init: { timeoutMs: 15000 } });
  assert.equal('env' in ghRun().init, false);
  const named = ghRun('other/proj');
  assert.deepEqual(named, { argv: GH_ARGV, init: { timeoutMs: 15000, env: { GH_REPO: 'other/proj' } } });
  assert.deepEqual(Object.keys(named.init.env), ['GH_REPO']);
  // No roster text reaches the command line.
  assert.equal(named.argv.some(a => a.includes('other') || a.includes('proj')), false);
  // The list is checked again where the run is built: anything else builds no run.
  for (const repo of BAD_REPOS) if (repo !== '') assert.equal(ghRun(repo), undefined, JSON.stringify(repo));
  assert.equal(ghRun(''), undefined);
});

test('C1: a pill press builds gh pr view <number> --web with GH_REPO always set, the 15-second limit and nothing else', () => {
  const run = ghViewRun('341', 'other/proj');
  assert.deepEqual(run, { argv: ['gh', 'pr', 'view', '341', '--web'], init: { timeoutMs: 15000, env: { GH_REPO: 'github.com/other/proj' } } });
  assert.deepEqual(Object.keys(run.init.env), ['GH_REPO']);
  // A number or a repository that fails its check builds no run.
  for (const repo of BAD_REPOS) assert.equal(ghViewRun('341', repo), undefined, JSON.stringify(repo));
  for (const n of ['', '12345678', '1a', '-1', '--web', ' 1', '1\n', 7, undefined, null]) assert.equal(ghViewRun(n, 'o/r'), undefined, JSON.stringify(n));
  assert.equal(ghViewRun('341'), undefined);
});

const ghRow = (number, repo, over = {}) => ({ number, title: `PR ${number}`, state: 'open', additions: 1, deletions: 1, updatedAt: 0, repo, ...over });

test('an answer counts for a named repository only when every pull request names that repository, case folded', () => {
  const ok = new Map([[7, ghRow(7, 'Other/Proj')], [8, ghRow(8, 'other/proj')]]);
  assert.equal(answerFor('other/proj', ok), ok);
  assert.equal(answerFor('OTHER/PROJ', ok), ok);
  // One row from another repository makes the whole answer no answer.
  assert.equal(answerFor('other/proj', new Map([[7, ghRow(7, 'other/proj')], [9, ghRow(9, 'o/r')]])), undefined);
  assert.equal(answerFor('other/proj', new Map([[7, ghRow(7, 'other/proj2')]])), undefined);
  assert.equal(answerFor('other/proj', new Map([[7, ghRow(7, 'evil/other/proj')]])), undefined);
  // An empty list names no other repository: an answer with no rows.
  assert.equal(answerFor('other/proj', new Map()).size, 0);
});

test('the named runs take turns: at most the cap a minute, in order, from where the last minute stopped', () => {
  const repos = ['g/7', 'a/1', 'c/3', 'b/2', 'e/5', 'd/4', 'f/6'];
  assert.deepEqual(rotate(repos, undefined, 5), ['a/1', 'b/2', 'c/3', 'd/4', 'e/5']);
  assert.deepEqual(rotate(repos, 'e/5', 5), ['f/6', 'g/7', 'a/1', 'b/2', 'c/3']);
  assert.deepEqual(rotate(repos, 'c/3', 5), ['d/4', 'e/5', 'f/6', 'g/7', 'a/1']);
  // Fewer than the cap: each once, still from where the last stopped.
  assert.deepEqual(rotate(['a/1', 'b/2'], 'a/1', 5), ['b/2', 'a/1']);
  assert.deepEqual(rotate(['a/1'], 'a/1', 5), ['a/1']);
  // A last one no card names any more: the next after it in order.
  assert.deepEqual(rotate(['a/1', 'c/3', 'd/4'], 'b/2', 2), ['c/3', 'd/4']);
  assert.deepEqual(rotate(['a/1', 'c/3'], 'z/9', 5), ['a/1', 'c/3']);
  assert.deepEqual(rotate(['a/1', 'a/1', 'b/2'], undefined, 5), ['a/1', 'b/2']);
  assert.deepEqual(rotate([], 'a/1', 5), []);
});

test('the head-chef roster reference gives the repo rule as the check holds it (claim 16, the repo rule)', async () => {
  const { readFile } = await import('node:fs/promises');
  const ref = await readFile(new URL('../skills/head-chef/references/roster.md', import.meta.url), 'utf8');
  // The field is named, with when to set it and its shape.
  const rule = ref.split('\n- ').find(b => b.startsWith('`repo`'));
  assert.ok(rule, 'roster.md has a bullet for `repo`');
  // Which way the rule points: set for another repository, left out for the lead's own.
  assert.match(rule.replace(/\s+/g, ' '), /`repo` is the pull request's repository, as `owner\/name` with no host, when that pull request is in another repository than your own working folder's\. Leave it out for a pull request in your own repository\./);
  // Every owner/name the reference shows as an example passes the check.
  const examples = [...ref.matchAll(/"repo": "([^"]*)"/g)].map(m => m[1]);
  assert.ok(examples.length > 0, 'the example call carries a repo');
  for (const e of examples) assert.match(e, REPO);
  // The caps line names the field's limits as REPO holds them.
  // The skill's own text and its contract give the same rule.
  const skill = await readFile(new URL('../skills/head-chef/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill.replace(/\s+/g, ' '), /Give a card whose pull request is in another repository than your own working folder's that repository as `repo`, an `owner\/name` with no host; give no other card one\./);
  // In the contract the rule stands in SKILL.md's wording, inside its schedule.
  assert.match(await scheduleOf('SKILL.md: The Brigade pane'), /Give a card whose pull request is in another repository than your own working folder's that repository as `repo`, an `owner\/name` with no host; give no other card one\./);
  assert.match(ref.replace(/\s+/g, ' '), /`repo`: the owner 1 to 39 letters, digits or `-`, not starting with `-`; the name 1 to 100 letters, digits, `-`, `\.` or `_`, not starting with `-` or `\.`/);
});

test('issue 504: a roster file holding phase loads with the key dropped, and a tool call holding it is refused in words that say so', () => {
  const withPhase = JSON.stringify({ cards: [{ ...card('a'), phase: 'building' }], todos: [] });
  const fromFile = checkRoster(withPhase, true, 'file');
  assert.ok('value' in fromFile);
  assert.equal(Object.hasOwn(fromFile.value.cards[0], 'phase'), false);
  assert.deepEqual(fromFile.value.cards[0], card('a'));
  const fromTool = checkRoster(withPhase, true, 'tool');
  assert.deepEqual(fromTool, { error: 'phase is gone: send the cards without it' });
});

// --- issue 560: a to-do's link ---------------------------------------------------------

const { parseLink, linkUrl, linkLabel } = roster;
// the-pact#580: the Linear forms, and the words that refuse a link of neither kind.
const { parseLinear, linearSlug, linearUrl, linearLabel, LINEAR_ID, LINEAR_SLUG, TODO_LINK_ANY } = roster;
const LINK_REFUSED = 'to-do 1 link is not a github.com issue, pull request or comment link, or a Linear identifier';
const GOOD_LINKS = [
  'https://github.com/mephistopheles4/grimoire/issues/560',
  'https://github.com/o/r/pull/18',
  'https://github.com/a-b/c.d_e-f/issues/1',
  'https://github.com/o/_x/pull/9999999',
  'https://github.com/O/R/issues/7',
  `https://github.com/${'a'.repeat(39)}/${'r'.repeat(100)}/issues/1`,
];
// Issue 567 (S1.1 to S1.3): a comment on an issue or a pull request, a review, a review comment.
const ANCHORED = [
  ['https://github.com/o/r/issues/560#issuecomment-1', { repo: 'o/r', kind: 'issue', number: '560', anchor: { kind: 'comment', id: '1' } }],
  ['https://github.com/o/r/pull/18#issuecomment-123456789012', { repo: 'o/r', kind: 'pr', number: '18', anchor: { kind: 'comment', id: '123456789012' } }],
  ['https://github.com/o/r/pull/18#pullrequestreview-99', { repo: 'o/r', kind: 'pr', number: '18', anchor: { kind: 'review', id: '99' } }],
  ['https://github.com/o/r/pull/18#discussion_r5', { repo: 'o/r', kind: 'pr', number: '18', anchor: { kind: 'reviewcomment', id: '5' } }],
];
// Refused: another scheme or host, a prefix trick, userinfo, a port, a query, an unknown fragment, a path
// that is not issues or pull, a name that is `..`-shaped or starts with `.` or `-`, a number with
// a leading zero, a trailing slash, white space, a hidden or non-ASCII character, an uppercase
// scheme or host, a claude.ai address, a string over 210 characters and a value that is not text.
const BAD_LINKS = [
  'http://github.com/o/r/issues/1', 'javascript:alert(1)', 'file:///etc/passwd', 'HTTPS://github.com/o/r/issues/1',
  'https://GITHUB.com/o/r/issues/1', 'https://github.com.evil.example/o/r/issues/1',
  'https://evil.example/https://github.com/o/r/issues/1', 'https://github.com@evil.example/o/r/issues/1',
  'https://user@github.com/o/r/issues/1', 'https://github.com:443/o/r/issues/1', 'https://github.com/o/r/issues/1?x=1',
  'https://github.com/o/r/issues/1#', 'https://github.com/o/r/issues/1/',
  'https://github.com/o/r/issues/1/foo', 'https://github.com/o/r/commit/abc', 'https://github.com/o/r/discussions/1',
  'https://github.com/o/r/issues/0', 'https://github.com/o/r/issues/007', 'https://github.com/o/r/issues/12345678',
  'https://github.com/o/.github/issues/1', 'https://github.com/o/-x/issues/1', 'https://github.com/o/a..b/issues/1',
  'https://github.com/o/../issues/1', 'https://github.com/o//issues/1', 'https://github.com//r/issues/1',
  'https://github.com/-o/r/issues/1', 'https://github.com/o_x/r/issues/1', `https://github.com/${'a'.repeat(40)}/r/issues/1`,
  `https://github.com/o/${'r'.repeat(101)}/issues/1`, ' https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/1 ',
  'https://github.com/o/r/issues/1\n', 'https://github.com/o /r/issues/1', 'https://github.com/o\u{200B}/r/issues/1',
  'https://github.com/ö/r/issues/1', 'https://claude.ai/code/session_abc', 'https://github.com/o/r/issues/1'.padEnd(211, 'x'),
  '', 7, null, undefined, ['https://github.com/o/r/issues/1'], { href: 'https://github.com/o/r/issues/1' },
];
// #567 C1: the anchored refusals. Each is a near-miss of an accepted shape.
const BAD_ANCHORED = [
  'https://github.com/o/r/issues/1#', 'https://github.com/o/r/issues/1#issuecomment-', 'https://github.com/o/r/issues/1#issuecomment',
  'https://github.com/o/r/issues/1#issuecomment-0', 'https://github.com/o/r/issues/1#issuecomment-01', 'https://github.com/o/r/issues/1#issuecomment-007',
  'https://github.com/o/r/issues/1#issuecomment-1234567890123', 'https://github.com/o/r/pull/1#issuecomment-1234567890123',
  'https://github.com/o/r/pull/1#pullrequestreview-0', 'https://github.com/o/r/pull/1#pullrequestreview-', 'https://github.com/o/r/pull/1#discussion_r0',
  'https://github.com/o/r/pull/1#discussion_r', 'https://github.com/o/r/pull/1#discussion_r01', 'https://github.com/o/r/pull/1#discussion_r1234567890123',
  'https://github.com/o/r/issues/1#pullrequestreview-5', 'https://github.com/o/r/issues/1#discussion_r5',
  'https://github.com/o/r/issues/1#issuecomment-5#issuecomment-6', 'https://github.com/o/r/issues/1#issuecomment-5#', 'https://github.com/o/r/issues/1##issuecomment-5',
  'https://github.com/o/r/issues/1#issuecomment-5?x=1', 'https://github.com/o/r/issues/1?x=1#issuecomment-5', 'https://github.com/o/r/issues/1#x=issuecomment-5',
  'https://github.com/o/r/issues/1/#issuecomment-5', 'https://github.com/o/r/pull/1/#pullrequestreview-5',
  'https://github.com/o/r/issues/1#IssueComment-5', 'https://github.com/o/r/issues/1#issuecomment-5 ', ' https://github.com/o/r/issues/1#issuecomment-5',
  'https://github.com/o/r/issues/1#issuecomment-5\n', 'https://github.com/o/r/issues/1#issuecomment-\u{0665}', 'https://github.com/o/r/issues/1#issuecomment-5\u{200B}',
  'https://github.com/o/r/issues/1#issuecomment-5/', 'https://github.com/o/r/issues/1#note_5', 'https://github.com/o/r/issues/1#event-5',
  'https://github.com/o/r/pull/1#diff-abc', 'https://github.com/o/r/pull/1#r5', 'https://github.com/o/r/pull/1#discussion_r5#discussion_r6',
  'https://github.com/o/a..b/issues/1#issuecomment-5', 'https://github.com/o/../issues/1#issuecomment-5',
  'https://claude.ai/code/session_abc#issuecomment-5', 'https://github.com/o/r/discussions/1#discussioncomment-5',
];

test('#560 C3: a link is accepted only in the closed github.com issue or pull request shape', () => {
  for (const link of GOOD_LINKS) assert.ok(parseLink(link), link);
  for (const link of BAD_LINKS) assert.equal(parseLink(link), undefined, JSON.stringify(link));
});

test('#560 C3: every accepted link equals the address rebuilt from its parse, and the rebuild is on the constant prefix', () => {
  for (const link of [...GOOD_LINKS, ...ANCHORED.map(a => a[0])]) {
    const p = parseLink(link);
    assert.equal(linkUrl(p), link);
    assert.ok(linkUrl(p).startsWith('https://github.com/'));
  }
});

test('#567 C1: each anchored shape is accepted and parses to its anchor; a link with no fragment has no anchor key', () => {
  for (const [link, parts] of ANCHORED) assert.deepEqual(parseLink(link), parts, link);
  for (const link of GOOD_LINKS) assert.equal('anchor' in parseLink(link), false, link);
});

test('#567 C1: each near-miss of an anchored shape is refused, and #560\'s "any fragment" case flips on purpose', () => {
  for (const link of BAD_ANCHORED) assert.equal(parseLink(link), undefined, JSON.stringify(link));
  // #560 C3 refused every fragment; its case 'issues/1#issuecomment-5' is accepted now, by design (S1.1).
  assert.ok(parseLink('https://github.com/o/r/issues/1#issuecomment-5'));
  // The review and review-comment forms stay on a pull request (S1.2).
  assert.equal(parseLink('https://github.com/o/r/issues/1#pullrequestreview-5'), undefined);
  assert.equal(parseLink('https://github.com/o/r/issues/1#discussion_r5'), undefined);
});

test('#567 C8: the longest accepted link is 203 characters, MAX_LINK is 210, and a roster from the older skill is accepted', () => {
  const longest = `https://github.com/${'a'.repeat(39)}/${'r'.repeat(100)}/pull/9999999#pullrequestreview-999999999999`;
  assert.equal(longest.length, 203);
  assert.ok(parseLink(longest));
  assert.equal(linkUrl(parseLink(longest)), longest);
  assert.equal(roster.MAX_LINK, 210);
  const longestIssue = `https://github.com/${'a'.repeat(39)}/${'r'.repeat(100)}/issues/9999999#issuecomment-999999999999`;
  assert.equal(longestIssue.length, 200);
  assert.ok(parseLink(longestIssue));
});

test("#560 C3, the-pact#580: every accepted pull request link builds a Desktop run (the link's name set is the run's); an issue link builds none", () => {
  for (const link of GOOD_LINKS) {
    const p = parseLink(link);
    const run = ghViewRun(p.number, p.repo, p.kind);
    if (p.kind === 'issue') {
      assert.equal(run, undefined, link);
      continue;
    }
    assert.ok(run, link);
    assert.deepEqual(run.argv, ['gh', 'pr', 'view', p.number, '--web']);
  }
});

test('#560 C6: the label names the repository and the number, from the parse alone', () => {
  assert.equal(linkLabel(parseLink('https://github.com/mephistopheles4/grimoire/issues/560')), '#560 mephistopheles4/grimoire');
  assert.equal(linkLabel(parseLink('https://github.com/o/r/pull/18')), 'PR 18 o/r');
});

test('#567 C7: each anchored label is built from the parse alone, names the repository and never holds the comment id', () => {
  assert.equal(linkLabel(parseLink('https://github.com/mephistopheles4/grimoire/issues/560#issuecomment-4300000000')), '#560 comment mephistopheles4/grimoire');
  assert.equal(linkLabel(parseLink('https://github.com/o/r/pull/18#issuecomment-5')), 'PR 18 comment o/r');
  assert.equal(linkLabel(parseLink('https://github.com/o/r/pull/18#pullrequestreview-7')), 'PR 18 review o/r');
  assert.equal(linkLabel(parseLink('https://github.com/o/r/pull/18#discussion_r9')), 'PR 18 review comment o/r');
  // A look-alike repository shows in the label.
  assert.equal(linkLabel(parseLink('https://github.com/mephistopheles/grimoire/pull/18#issuecomment-5')), 'PR 18 comment mephistopheles/grimoire');
});

test('#560 C4, the-pact#580: a pull request press builds gh pr view <number> --web with GH_REPO pinned behind github.com; an issue press builds no run, and the kind is one word', () => {
  assert.deepEqual(ghViewRun('18', 'o/r', 'pr'), { argv: ['gh', 'pr', 'view', '18', '--web'], init: { timeoutMs: 15000, env: { GH_REPO: 'github.com/o/r' } } });
  // The pill's call keeps its two arguments and its kind.
  assert.deepEqual(ghViewRun('18', 'o/r'), ghViewRun('18', 'o/r', 'pr'));
  for (const kind of ['issue', '', 'merge', 'pull', 'issues', '--web', 7, null]) assert.equal(ghViewRun('18', 'o/r', kind), undefined, JSON.stringify(kind));
});

test('#560 C9: the roster reference, the skill and the contract give the to-do rules as the check holds them', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = p => readFile(new URL(`../skills/head-chef/${p}`, import.meta.url), 'utf8').then(t => t.replace(/\s+/g, ' '));
  const ref = await read('references/roster.md');
  // Every link the reference shows as an example passes the check, and the cap it names is the check's.
  const examples = [...ref.matchAll(/"link": "([^"]*)"/g)].map(m => m[1]);
  assert.ok(examples.length > 0, 'the example call carries a link');
  for (const e of examples) assert.ok(parseLink(e), e);
  assert.match(ref, /its `link` at most 210/);
  assert.match(ref, /one line the owner takes in at a glance: at most 50 characters/);
  // Issue 580: a verb first, then the act and the work; a decision number alone is never a to-do.
  assert.match(ref, /starts with a verb, then names the act and the work/);
  assert.match(ref, /A to-do that names only a decision, or points only at the Decisions tab or the log, breaks the rule\./);
  assert.match(ref, /The one exception is a carried decision, which `handoff\.md` gives/);
  assert.match(ref, /Put no other facts, options, picks, reasons, commands, file names, paths, error text or quoted text in it/);
  const texts = [...ref.matchAll(/"text": "([^"]*)"/g)].map(m => m[1]);
  assert.ok(texts.length >= 2, 'the example call carries to-dos');
  for (const x of texts) assert.ok(x.length <= 50, `the example to-do "${x}" fits 50 characters`);
  assert.match(ref, /`https:\/\/github\.com\/owner\/name\/issues\/N` or `https:\/\/github\.com\/owner\/name\/pull\/N`/);
  assert.match(ref, /delete that session's roster file by hand/);
  const rule = /one line of at most 50 characters, one ask or one owner step\. It starts with a verb, then names the act and the work\. It names the question or the decision text only as the eased control below allows, and carries no facts but the count below/;
  assert.match(await read('SKILL.md'), rule);
  assert.match(await scheduleOf('SKILL.md: The Brigade pane'), rule);
});

test('#567 C9: the roster reference, the skill and the contract give the comment link rule; the contract is 1.31.0 or later, with the 1.31.0 row and go', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = p => readFile(new URL(`../skills/head-chef/${p}`, import.meta.url), 'utf8').then(t => t.replace(/\s+/g, ' '));
  const ref = await read('references/roster.md');
  assert.match(ref, /`#issuecomment-C` added, or on a pull request `#pullrequestreview-C` or `#discussion_rC`/);
  assert.match(ref, /Take a comment's address only from a comment you or a member posted on that issue or pull request, as read back from GitHub through `gh`/);
  assert.match(ref, /If `set_roster` refuses a `link`, or the owner says the pane refused the roster file for one, send the roster again without links, and ask the owner to delete that session's roster file by hand/);
  const use = /(?:Give|It gives) the comment link when the answer or the step is in one comment or review, and the issue or pull request link otherwise/;
  assert.match(await read('SKILL.md'), use);
  const contract = await read('references/CONTRACT.md');
  assert.match(await scheduleOf('SKILL.md: The Brigade pane'), use);
  assert.match(contract, /^# .*?Version: (?:1\.(?:3[1-9]|[4-9]\d)|[2-9]\.\d+)\.\d+ /);
  assert.match(await read('SKILL.md'), /`#issuecomment-C` added/);
  const log = await read('references/contract.changelog.md');
  assert.match(log, /\| 1\.31\.0 \| [0-9-]+ \| \*Proposed\.\*/);
  assert.match(log, /the lead's decisions 426, 436 and 487 at level 3, not the owner's words; the lead accepts the E84 widening there and flags it big/);
});

test('#578 C5: the contract, the skill, the Desktop page and the README give the start note; the contract is 1.32.0 or later, with its row', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = p => readFile(new URL(`../skills/head-chef/${p}`, import.meta.url), 'utf8').then(t => t.replace(/\s+/g, ' '));
  const label = /<lead name>, not the owner, adds: <note>/;
  assert.match(await read('SKILL.md'), label);
  const contract = await read('references/CONTRACT.md');
  assert.match(await scheduleOf('SKILL.md: The start prompt'), label);
  assert.match(contract, /^# .*?Version: (?:1\.(?:3[2-9]|[4-9]\d)|[2-9]\.\d+)\.\d+ /);
  assert.match(await read('references/desktop.md'), /You may add one note after it, written, labelled and bounded as "The start prompt" in `SKILL.md` says/);
  assert.match(await read('references/starting.md'), /optionally a `note`/);
  assert.match(await read('README.md'), /one short note from the head chef, labelled as the head chef's words and not yours/);
  assert.match(await read('references/contract.changelog.md'), /\| 1\.32\.0 \| [0-9-]+ \| \*Proposed\.\* A background start may carry one `note`/);
});

test('#581 C10: the roster reference, the skill and the contract name the four statuses and write idle, never needs-you; the contract carries its 1.35.0 row', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = p => readFile(new URL(`../skills/head-chef/${p}`, import.meta.url), 'utf8').then(t => t.replace(/\s+/g, ' '));
  const roster = await read('references/roster.md');
  assert.match(roster, /`status` is one of `working`, `idle`, `done` or `stopped`/);
  assert.match(roster, /and `working` again when it resumes; put what the owner must do in a to-do/);
  const rule = /[Aa] card's `status` is `working`, `idle`, `done` or `stopped`/;
  const skill = await read('SKILL.md');
  assert.match(skill, rule);
  assert.match(skill, /and `working` again when it resumes; put what the owner must do in a to-do/);
  const contract = await read('references/CONTRACT.md');
  const pane = await scheduleOf('SKILL.md: The Brigade pane');
  assert.match(pane, rule);
  assert.match(pane, /and `working` again when it resumes; put what the owner must do in a to-do/);
  assert.match(contract, /^# .*?Version: \d+\.\d+\.\d+ /);
  assert.match(await read('references/contract.changelog.md'), /\| 1\.35\.0 \| [0-9-]+ \| \*Proposed\.\*/);
});

test('#560 C2: the text of a to-do of 300 characters is accepted and one of 301 is refused, from the file and from the tool', () => {
  const todo = n => JSON.stringify({ cards: [], todos: [{ id: 't1', text: 'x'.repeat(n) }] });
  for (const source of ['file', 'tool']) {
    assert.equal(checkRoster(todo(300), true, source).value?.todos[0].text.length, 300, source);
    assert.equal(checkRoster(todo(301), true, source).error, 'to-do 1 text is over 300 characters', source);
  }
});

test('#560 C3: a to-do may carry link from the file and from the tool; any other value is refused in fixed words that never echo it', () => {
  const todo = over => JSON.stringify({ cards: [], todos: [{ id: 't1', text: 'Review PR 18', ...over }] });
  for (const link of GOOD_LINKS) {
    for (const source of ['file', 'tool']) {
      assert.equal(checkRoster(todo({ link }), true, source).value?.todos[0].link, link, `${link} ${source}`);
    }
  }
  assert.equal('link' in checkRoster(todo({})).value.todos[0], false);
  // JSON has no undefined: a link left out is no link, which the line above holds.
  for (const link of BAD_LINKS.filter(l => l !== undefined)) {
    for (const source of ['file', 'tool']) {
      const r = checkRoster(todo({ link }), true, source);
      assert.equal(r.error, LINK_REFUSED, `${JSON.stringify(link)} ${source}`);
    }
  }
});

// --- the-pact#580: a to-do's link may be a Linear identifier ----------------------------------

const GOOD_LINEAR = ['PACT-12', 'GRIM-1', 'STACKS-100', 'ATH-9', 'MEPH-123456789', 'AB-1', 'A1-1', 'ABCDEFGHIJ-1', 'A1B2C3D4E5-987654321'];
const BAD_LINEAR = [
  'pact-12', 'Pact-12', 'PACT-', 'PACT', '-12', 'PACT-012', 'PACT-0', 'PACT--12', 'PACT-12 ', ' PACT-12', 'PACT-12\n', 'PACT\n-12',
  'P-12', 'ABCDEFGHIJK-1', 'PACT-1234567890', '1ACT-12', 'PA_CT-12', 'PA CT-12', 'PACT-1a', 'PACT-12-3', 'PACT-١٢', 'PACT-12​',
  'https://linear.app/acme/issue/PACT-12', 'linear.app/acme/issue/PACT-12', '#12', 'PACT-12?x=1', 'PACT-12#c', 'PACT-12/', '',
  7, null, undefined, ['PACT-12'], { id: 'PACT-12' },
];

test('the-pact#580: a Linear identifier is the whole string, a key of 2 to 10 characters, a hyphen and a number of 1 to 9 digits with no leading zero', () => {
  for (const id of GOOD_LINEAR) {
    const p = parseLinear(id);
    assert.ok(p, id);
    assert.equal(`${p.key}-${p.number}`, id);
  }
  assert.deepEqual(parseLinear('PACT-12'), { key: 'PACT', number: '12' });
  for (const id of BAD_LINEAR) assert.equal(parseLinear(id), undefined, JSON.stringify(id));
  // A github.com link is not a Linear identifier, and the reverse.
  for (const link of GOOD_LINKS) assert.equal(parseLinear(link), undefined, link);
  for (const id of GOOD_LINEAR) assert.equal(parseLink(id), undefined, id);
});

test('the-pact#580: the tool schema pattern takes a github.com link or a Linear identifier, whole, and nothing else', () => {
  assert.equal(TODO_LINK_ANY, `${roster.TODO_LINK.source}|${LINEAR_ID.source}`);
  for (const flags of ['', 'u']) {
    const re = new RegExp(TODO_LINK_ANY, flags);
    for (const ok of [...GOOD_LINEAR, ...GOOD_LINKS, ...ANCHORED.map(a => a[0])]) assert.equal(re.test(ok), true, `${flags} ${ok}`);
    for (const bad of BAD_LINEAR.filter(b => typeof b === 'string')) assert.equal(re.test(bad), false, `${flags} ${JSON.stringify(bad)}`);
    // An alternative never lets text ride in front of or behind the other one.
    for (const bad of ['xPACT-12', 'PACT-12x', 'PACT-12https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/1PACT-12', 'PACT-12\nPACT-13']) assert.equal(re.test(bad), false, `${flags} ${JSON.stringify(bad)}`);
  }
});

test('the-pact#580: a to-do may carry a Linear identifier from the file and from the tool, and it comes back unchanged', () => {
  const todo = link => JSON.stringify({ cards: [], todos: [{ id: 't1', text: 'Review the item', link }] });
  for (const link of GOOD_LINEAR) {
    for (const source of ['file', 'tool']) assert.equal(checkRoster(todo(link), true, source).value?.todos[0].link, link, `${link} ${source}`);
  }
  for (const link of BAD_LINEAR.filter(b => typeof b === 'string')) {
    for (const source of ['file', 'tool']) assert.equal(checkRoster(todo(link), true, source).error, LINK_REFUSED, `${JSON.stringify(link)} ${source}`);
  }
});

test('the-pact#580: the label names the identifier only, with no workspace', () => {
  assert.equal(linearLabel(parseLinear('PACT-12')), 'PACT-12');
  assert.equal(linearLabel(parseLinear('A1B2C3D4E5-987654321')), 'A1B2C3D4E5-987654321');
});

test('the-pact#580: a workspace slug is 1 to 64 lower-case letters, digits and hyphens, not starting with a hyphen, and is checked case-sensitively', () => {
  for (const slug of ['acme', 'a', '9', 'my-team', 'a-', 'a--b', 'a'.repeat(64), '0abc']) assert.equal(linearSlug(slug), slug, slug);
  const bad = ['', '-a', 'Acme', 'ACME', 'acme/', '/acme', 'a/b', 'a.b', 'acme?x=1', 'acme#c', 'acme:80', 'acme@evil', 'a b', ' acme', 'acme ', 'acme\n', 'a​b', 'a_b', '..', 'a%2Fb', 'a'.repeat(65), 'acéme', 7, null, undefined, ['acme']];
  for (const slug of bad) assert.equal(linearSlug(slug), undefined, JSON.stringify(slug));
  assert.equal(LINEAR_SLUG.test('acme\n'), false);
});

test('the-pact#580: the address is built only from constants, the slug and the parsed identifier, and any bad slug builds none', () => {
  assert.equal(linearUrl(parseLinear('PACT-12'), 'acme'), 'https://linear.app/acme/issue/PACT-12');
  assert.equal(linearUrl(parseLinear('A1B2C3D4E5-987654321'), 'my-team'), 'https://linear.app/my-team/issue/A1B2C3D4E5-987654321');
  for (const slug of ['', 'a/b', 'a?x=1', 'a#b', 'Acme', 'a.b', 'a:b', undefined, null, 7]) assert.equal(linearUrl(parseLinear('PACT-12'), slug), undefined, JSON.stringify(slug));
  // Only a parse can be built from: a made-up part with a path in it builds nothing.
  assert.equal(linearUrl({ key: 'PACT', number: '12/../x' }, 'acme'), undefined);
  assert.equal(linearUrl({ key: 'pact', number: '12' }, 'acme'), undefined);
  assert.equal(linearUrl(undefined, 'acme'), undefined);
});
