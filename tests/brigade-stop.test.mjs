// The stop tool's rules (issue 516; ADR 0016), tested at their own seam:
// brigade/stop.ts holds them with no engine import. brigade/register.tsx wires
// them to the engine, and the later tests here read its text for that wiring,
// and for what the mod must no longer hold: a removal command, a window, the
// typed cleanup commands, or the other package's name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { ENVELOPE, fromEngine, stopAnswer, stopTarget } = await import('../brigade/stop.ts');

const JOB = '0123abcd';
const cards = [
  { title: 'bg-1', bgId: JOB },
  { title: 'build-1', desktopId: 'local_11111111-2222-3333-4444-555555555555' },
  { title: 'twin', bgId: 'aaaa0001' },
  { title: 'twin', bgId: 'aaaa0002' },
  { title: 'renamed', bgId: 'bbbb0001' },
  { title: 'gone', bgId: 'cccc0001' },
  { title: 'dup-rows', bgId: 'dddd0001' },
  { title: 'both-ids', bgId: 'eeee0001', desktopId: 'local_22222222-2222-3333-4444-555555555555' },
  { title: 'folded  title', bgId: 'ffff0001' },
];
const rows = [
  { name: 'bg-1', status: 'idle', jobId: JOB },
  { name: 'something else', status: 'idle', jobId: 'bbbb0001' },
  { name: 'dup-rows', status: 'idle', jobId: 'dddd0001' },
  { name: 'dup-rows', status: 'idle', jobId: 'dddd0001' },
  { name: 'both-ids', status: 'idle', jobId: 'eeee0001' },
  { name: 'folded title', status: 'idle', jobId: 'ffff0001' },
];
const whole = { rows, complete: true, fileGone: false };

test('C2: stopTarget accepts exactly one background card whose one session file has the same name', () => {
  assert.deepEqual(stopTarget('bg-1', cards, whole), { jobId: JOB });
});

test('C2: titles and names are compared as the roster draws them, not raw', () => {
  assert.deepEqual(stopTarget('folded title', cards, whole), { jobId: 'ffff0001' });
  assert.deepEqual(stopTarget('  folded   title ', cards, whole), { jobId: 'ffff0001' });
});

test('C2: stopTarget refuses in fixed words that name no id or path', () => {
  const why = (title, sessions = whole) => {
    const r = stopTarget(title, cards, sessions);
    assert.ok('why' in r, `${title} was not refused`);
    assert.match(r.why, /^session: [a-z ]+$/);
    assert.ok(!r.why.includes(JOB), 'no id in the reason');
    return r.why;
  };
  assert.match(why('nobody'), /no card/);
  assert.match(why('twin'), /more than one card/);
  assert.match(why('build-1'), /not a background session/);
  assert.match(why('both-ids'), /not a background session/);
  assert.match(why('gone'), /no session file/);
  assert.match(why('dup-rows'), /two session files/);
  assert.match(why('renamed'), /not the card title/);
});

test('C2: a read that skipped a file, or lost one, can accept no stop', () => {
  for (const sessions of [{ rows, complete: false, fileGone: false }, { rows, complete: true, fileGone: true }]) {
    const r = stopTarget('bg-1', cards, sessions);
    assert.match(r.why, /could not be read whole/);
  }
});

test('C2: stopAnswer is fixed words, and only an exit of 0 is a stop', () => {
  const stopped = stopAnswer({ exitCode: 0, stdout: 'C:\\Users\\someone\\x', stderr: 'TOKEN=abc' });
  assert.equal(stopped, 'Stopped: claude stop ran and exited 0. Its worktree and branch stay.');
  for (const ran of [undefined, { exitCode: 1 }, { exitCode: '0' }, 'spawn failed: TOKEN=abc', null]) {
    assert.equal(stopAnswer(ran), 'Not stopped: claude stop did not run, or did not exit 0. Tell the owner, who can stop it by hand.');
  }
  assert.doesNotMatch(stopped, /clean_up|\/brigade done/);
});

test('C2: only the engine\'s own dispatch is the model\'s call', () => {
  assert.equal(fromEngine({ plugin: 'engine', tier: 'core' }), true);
  for (const o of [undefined, null, 'engine', { plugin: 'other', tier: 'core' }, { plugin: 'engine', tier: 'plugin' }, [], { plugin: 'engine' }]) assert.equal(fromEngine(o), false);
  assert.ok(ENVELOPE.includes('requestMeta') && ENVELOPE.includes('agentId'));
});

const register = fs.readFileSync(new URL('../brigade/register.tsx', import.meta.url), 'utf8');
const between = (from, to) => {
  const a = register.indexOf(from);
  const b = register.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${from} .. ${to}`);
  return register.slice(a, b);
};
// The statements of a slice: each line trimmed, comments and blank lines left out.
const live = text => text.split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('//'));

test('C2: the stop tool refuses a subagent or another plugin, reads the files live, runs `claude stop` alone, and answers only through stopAnswer', () => {
  const stop = between('async function stopBackground', '// end stopBackground');
  // Every live line, in order, up to each refusal's fixed rule: no guard can be
  // commented out, no exit added, and nothing but stopAnswer answers after the run.
  const lines = live(stop).map(l => l.replace(/return refuseStop\(.*\)$/, 'return refuseStop(…)'));
  assert.deepEqual(lines, [
    'async function stopBackground($: EngineInterface, e: Record<string, unknown>, origin: unknown) {',
    'if (e.agentId !== undefined) return refuseStop(…)',
    'if (!fromEngine(origin)) return refuseStop(…)',
    'const input = Object.fromEntries(Object.entries(e).filter(([k]) => !STOP_ENVELOPE.includes(k)))',
    'if (!rulesAllowTool(await $.tool.check({ tool: STOP_NAME, input }))) return refuseStop(…)',
    'if (!(await offered($))) return refuseStop(…)',
    'if (!(await paneOpen($))) return refuseStop(…)',
    'const { title } = input',
    "if (Object.keys(input).some(k => k !== 'title') || typeof title !== 'string') return refuseStop(…)",
    'const { cards } = await read($, roster)',
    'const at = await where($)',
    "if ('error' in at) return refuseStop(…)",
    'const sessions = await readSessions(at.config, sessionIo($))',
    'if (sessions === undefined) return refuseStop(…)',
    'const target = stopTarget(oneLine(title, 80), cards, sessions)',
    "if ('why' in target) return refuseStop(…)",
    'if (!(await ghFindable($))) return { result: stopAnswer(undefined) }',
    "const ran = await $.process.run(['claude', 'stop', target.jobId], { timeoutMs: 15000 }).catch(() => undefined)",
    'return { result: stopAnswer(ran) }',
    '}',
  ]);
  // Each refusal's rule is a fixed string, or stopTarget's fixed reason: no typed value reaches it.
  for (const l of live(stop)) if (l.includes('refuseStop(')) assert.match(l, /return refuseStop\((?:'[^'$]*'|"[^"$]*"|RULES_RULE|OFFER_RULE|target\.why)\)$/, l);
  assert.ok(!/["'`]rm["'`]/.test(stop), 'no claude rm');
  const handler = between("on('tool.call', { tool: STOP_NAME }", "on('tool.call', { tool: CONTEXT_NAME }");
  assert.match(handler, /return await stopBackground\(\$, e as unknown as Record<string, unknown>, next\.origin\)/);
  assert.match(handler, /\}\)\.catch\(\(\) => \(\{ deny: 'stop_background_session refused: /);
});

test('543 C8: the start tool refuses a subagent or another plugin before anything, runs every other guard in its own turn', () => {
  const start = between('async function startBackground', '// end startBackground');
  const lines = live(start.slice(0, start.indexOf('async function startRun'))).map(l => l.replace(/return refuseStart\(.*\)$/, 'return refuseStart(…)'));
  // Every live line, in order: the two cheap refusals, then one queued turn that holds each guard.
  assert.deepEqual(lines, [
    'async function startBackground($: EngineInterface, e: Record<string, unknown>, origin: unknown, signal: AbortSignal, progress: { ran: boolean }) {',
    'if (e.agentId !== undefined) return refuseStart(…)',
    'if (!fromEngine(origin)) return refuseStart(…)',
    'const input = Object.fromEntries(Object.entries(e).filter(([k]) => !STOP_ENVELOPE.includes(k)))',
    'return startTurn(async () => {',
    'if (signal.aborted) return refuseStart(…)',
    'if (!rulesAllowTool(await $.tool.check({ tool: START_NAME, input }))) return refuseStart(…)',
    'if (!(await offered($))) return refuseStart(…)',
    'if (!(await paneOpen($))) return refuseStart(…)',
    'const at = await where($)',
    "const sessions = 'error' in at ? undefined : await readSessions(at.config, sessionIo($))",
    "const own = 'error' in at ? undefined : sessions?.rows.find(r => r.sessionId === at.id)",
    'const checked = checkInputs(input, own === undefined ? undefined : oneLine(own.name, 80))',
    "if ('why' in checked) return refuseStart(…)",
    'return startRun($, checked.value, sessions, signal, progress)',
    '})',
    '}',
  ]);
  for (const l of live(start.slice(0, start.indexOf('async function startRun')))) if (l.includes('refuseStart(')) assert.match(l, /return refuseStart\((?:'[^'$]*'|"[^"$]*"|RULES_RULE|OFFER_RULE|checked\.why)\)$/, l);
  const handler = between("on('tool.call', { tool: START_NAME }", "on('tool.call', { tool: CONTEXT_NAME }");
  assert.match(handler, /startBackground\(\$, e as unknown as Record<string, unknown>, next\.origin, next\.signal, progress\)/, "the handler passes the call's own signal");
  // The run's steps, in the order of S2.2: the platform, the spelling, the folder, the name, the host, the programs, the origin, then the start.
  const run = start.slice(start.indexOf('async function startRun'));
  const order = ['hostPlatform($)', 'folderSpelling(i.folder', 'checkoutFacts($, i.folder', 'nameHeld($', 'ghFindable($)', "programPath($, 'git'", "programPath($, 'claude'", 'originArgv(git.value', 'attempted.add(', 'progress.ran = true', 'startArgv(i, claude.value'];
  assert.match(run, /originArgv\(git\.value[\s\S]*if \(signal\.aborted\) return refuseStart\('abandoned: the call ran out of time or was interrupted before its run'\)\n\s*attempted\.add\(/, 'a call abandoned before its run is refused before the name is held');
  const at = order.map(s => run.indexOf(s));
  assert.ok(at.every(n => n >= 0), `a step is missing: ${order.filter((s, k) => at[k] < 0)}`);
  assert.deepEqual(at, [...at].sort((a, b) => a - b), 'the steps are out of order');
  // Issue 579: the start reads no store and holds no list check.
  assert.doesNotMatch(run, /\$\.store\.get|listed\(/);
});

test('C1, C2: the mod holds no window, no cleaner, no archive hook and no typed cleanup command', () => {
  for (const gone of ['doneWindow', 'pinnedCleaner', 'cleanupTargets', 'ARCHIVE_TOOL', 'archive_session', 'clean_up', 'CLEAN_TOOL', 'isDoneCommand', 'isCleanerCommand', 'cleaner-path', 'CLEANER_KEY', 'bindJoined']) {
    assert.ok(!register.includes(gone), `register.tsx still holds ${gone}`);
  }
  assert.ok(!fs.existsSync(new URL('../brigade/cleanup.ts', import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../brigade/gate.ts', import.meta.url)));
  // The cleaner's home read is gone, and so is the folders list's (issue 579): no home-folder read is left.
  assert.doesNotMatch(register, /\$\.env\.get\('(?:HOME|USERPROFILE)'\)/);
});

test('C2: the stop tool\'s description names no window and no clean_up', () => {
  const d = between('const STOP_DESCRIPTION', 'const STOP_SCHEMA');
  assert.doesNotMatch(d, /window|clean_up|\/brigade done/);
});

test('C2: brigade/ holds no removal command text', () => {
  const dir = new URL('../brigade/', import.meta.url);
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => /\.(?:ts|tsx)$/.test(f) && !/\.test\./.test(f) && !f.startsWith('types'));
  assert.ok(files.length > 5);
  for (const f of files) {
    const text = fs.readFileSync(new URL(f.replace(/\\/g, '/'), dir), 'utf8');
    for (const bad of ['worktree remove', 'branch -d', 'branch -D', "'-D'", '--force', 'claude rm', "'rm'", 'read_cleanup', 'brigade done', 'brigade cleaner']) assert.ok(!text.includes(bad), `${f}: ${bad}`);
    assert.doesNotMatch(text, /'worktree',\s*'remove'|'branch',\s*'-[dD]'/, `${f}: a removal as an argument list`);
  }
});

test('579 C3, C4: register.tsx holds none of the folder list\'s names, and its only startFolders mentions are the two in the guarded clear', () => {
  for (const gone of ['FOLDERS_KEY', 'FOLDERS_REPLIES', 'foldersCommand', 'isFoldersCommand', 'folderTurn', 'foldering', 'parseFolders', 'NOT_LISTED', 'brigade folders']) {
    assert.ok(!register.includes(gone), `register.tsx still holds ${gone}`);
  }
  assert.equal([...register.matchAll(/startFolders/g)].length, 2);
});
