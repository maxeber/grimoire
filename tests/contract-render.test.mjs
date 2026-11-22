// The contract skill's interview script, at the seam Claude and a person use:
// its command line. The page's own logic, which the script shares, is tested
// in Node in tests/contract-interview.test.mjs.
//
// Nothing here commits a fixture. Every draft and block is derived from the
// measurement draft, which the repository tracks on purpose, and written to a
// temporary folder at run time.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { contractModule, contractRender, measurementDraft, root, run } from './helpers.mjs';
import { createRequire } from 'node:module';

const work = mkdtempSync(join(tmpdir(), 'grimoire-contract-'));
after(() => rmSync(work, { recursive: true, force: true }));

test('--version prints the script version and Node version', () => {
  const r = run(contractRender, ['--version']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^render\.mjs \d+\.\d+\.\d+, Node v\d+\.\d+\.\d+\n$/);
  assert.ok(r.stdout.includes(`Node ${process.version}`));
});

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test('--check passes the measurement draft and prints its SHA-256 over the exact bytes', () => {
  const r = run(contractRender, [measurementDraft, '--check']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`^ok: sha256 ${sha256(measurementDraft)} — "[^"]+"$`, 'm'));
});
/** The measurement draft, parsed afresh, mutated, and written to the temp
 *  folder. Returns the path. */
const base = () => JSON.parse(readFileSync(measurementDraft, 'utf8'));
let n = 0;
function derive(mutate, text) {
  const draft = base();
  mutate(draft);
  const p = join(work, `case-${n++}.interview.json`);
  writeFileSync(p, text ? text(draft) : JSON.stringify(draft, null, 2));
  return p;
}
/** A refusal of the draft at `path`, naming it and the reason, exit 1. */
function refused(file, path, why) {
  const r = run(contractRender, [file, '--check']);
  assert.equal(r.code, 1, `${path}: expected a refusal\n${r.stderr}`);
  const line = r.stderr.split('\n').find(l => l.includes(`: ${path}: `));
  assert.ok(line, `no refusal names ${path}:\n${r.stderr}`);
  if (why) assert.match(line, why);
  return r;
}
const clause = (d, part, id) => d.parts[part].find(c => c.id === id);
const question = (d, id) => d.questions.find(q => q.id === id);

test('--check refuses an unknown key at every level, naming where it is and never its value', () => {
  const cases = [
    ['file', d => (d.extra = 'SECRET-VALUE')],
    ['parts', d => (d.parts.extra = [])],
    ['parts.roles[0]', d => (d.parts.roles[0].extra = 'SECRET-VALUE')],
    ['parts.roles[0].fields', d => (d.parts.roles[0].fields.extra = 'SECRET-VALUE')],
    ['questions[0]', d => (d.questions[0].extra = 'SECRET-VALUE')],
    ['questions[0].options[0]', d => (d.questions[0].options[0].extra = 'SECRET-VALUE')],
    ['questions[0].options[0].fields', d => (d.questions[0].options[0].fields.extra = 'SECRET-VALUE')],
    ['rewrite', d => (d.rewrite.extra = 'SECRET-VALUE')],
    ['previous', d => (d.previous = { type: 'skill', name: 'contract', hash: 'a'.repeat(64), extra: 'SECRET-VALUE' })],
  ];
  for (const [path, mutate] of cases) {
    const r = refused(derive(mutate), path, /unknown key "extra"/);
    assert.doesNotMatch(r.stderr + r.stdout, /SECRET-VALUE/, path);
  }
  // A key name is the file's text too: one shaped like a key prints masked.
  const keyName = `ghp_${'K1e2Y3n4A5'.repeat(4)}`;
  const r = refused(derive(d => (d[keyName] = 1)), 'file', /unknown key "\[masked\]"/);
  assert.ok(!(r.stderr + r.stdout).includes(keyName), 'the key-shaped key name printed');
});
// Indexes in the measurement draft that the cases below rely on.
test('the measurement draft holds the clauses these tests name, where they name them', () => {
  const d = base();
  assert.equal(d.parts.purpose[0].id, 'name');
  assert.equal(d.parts.roles[14].kind, 'checked');
  assert.equal(d.parts.roles[37].kind, 'unsure');
  assert.equal(d.parts.rules[0].kind, 'rule');
  assert.equal(d.questions[25].clause, 'unsure');
});

test('--check refuses each case in the spec\'s list, naming the field', () => {
  const cases = [
    ['format', d => (d.format = 2), /unknown format/],
    ['title', d => (d.title = 7), /expected a string/],
    ['type', d => (d.type = 'plugin'), /not one of/],
    ['level', d => (d.level = 'Huge'), /not one of/],
    ['parts.purpose[1].mark', d => (d.parts.purpose[1].mark = 'Confirmed'), /Proposed/],
    ['parts.purpose[1].freedom', d => (d.parts.purpose[1].freedom = 'loose'), /not one of/],
    ['parts.roles[37].fields.choice', d => (d.parts.roles[37].fields.choice = 'guess'), /not one of/],
    ['parts.rules[0].fields.status', d => (d.parts.rules[0].fields.status = 'maybe'), /not one of/],
    ['parts.purpose[1].kind', d => (d.parts.purpose[1].kind = 'wizard'), /no kind/],
    ['parts.purpose[1].kind', d => (d.parts.purpose[1].kind = 'duty'), /cannot hold/],
    ['parts.tools[0].kind', d => d.parts.tools.push({ id: 'bf', kind: 'built-for', fields: { tool: 'Codex' }, mark: 'Proposed' }) && (d.parts.tools.unshift(d.parts.tools.pop()), true), /this draft's type cannot hold this kind; it is for agent and CLAUDE\.md/],
    ['parts.tools[0].kind', d => d.parts.tools.unshift({ id: 'bk', kind: 'binding-key', fields: { setting: 'permissionMode', value: 'default' }, mark: 'Proposed' }), /this draft's type cannot hold this kind; it is for agent and CLAUDE\.md/],
    ['parts.roles[14].gate', d => (d.parts.roles[14].gate = 'a hook'), /checked/],
    ['parts.purpose[1]', d => (d.parts.purpose[1].none = true), /both/],
    ['parts.purpose[1]', d => delete d.parts.purpose[1].fields, /neither/],
    ['parts.purpose[1].fields', d => delete d.parts.purpose[1].fields.for, /missing required key "for"/],
    ['parts.rules[1].refs[0]', d => (d.parts.rules[1].refs = ['no-such-clause']), /no clause/],
    ['parts.rules[1].refs[0]', d => (d.parts.rules[1].refs = ['constructor']), /no clause/],
    ['questions[0].options', d => (d.questions[0].options = d.questions[0].options.slice(0, 1)), /two to four/],
    ['questions[25].options', d => d.questions[25].options.push({ id: 'unsure-e', label: 'Fifth', fields: { choice: 'asks-at-once', why: 'x' } }), /two to four/],
    ['questions[0].proposed', d => (d.questions[0].proposed = 'unsure-a'), /not an option/],
    ['questions[0].clause', d => (d.questions[0].clause = 'constructor'), /no clause/],
    ['questions[1].clause', d => (d.questions[1].clause = d.questions[0].clause), /second question/],
    ['parts.why[0].mark', d => (d.parts.why[0].mark = 'Proposed'), /carries no mark/],
    ['parts.why[0].fields.text', d => (d.parts.why[0].fields.text = 'Because.'), /empty in a draft/],
    ['questions[0].clause', d => (d.questions[0].clause = 'why'), /why/],
    ['parts.purpose[1].id', d => (d.parts.purpose[1].id = 'name'), /duplicate/],
    ['parts.purpose[1].id', d => (d.parts.purpose[1].id = 'Bad Id'), /1 to 64 characters of a-z/],
    ['questions[0].options[1].id', d => (d.questions[0].options[1].id = d.questions[0].options[0].id), /duplicate/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'bell\x07here'), /U\+0007/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'zero\u{200B}width'), /U\+200B/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'lone\rcr'), /U\+000D/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'bidi\u{202E}x'), /U\+202E/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'next\u{0085}line'), /U\+0085/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'del\u{007F}x'), /U\+007F/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'line\u{2028}sep'), /U\+2028/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 'non\u{FFFE}char'), /U\+FFFE/],
    ['parts.purpose[1].fields.does', d => (d.parts.purpose[1].fields.does = 7), /expected a string/],
    ['parts.open', d => ((d.level = 'Standard'), true), /level/],
    ['parts', d => delete d.parts.open, /missing required key "open"/],
    ['parts.why', d => d.parts.why.push({ id: 'why-2', kind: 'why', fields: { text: '' } }), /one/],
    ['name', d => (d.name = 'a:b'), /colon/],
    ['name', d => (d.name = "it's"), /quote/],
    ['name', d => (d.name = 'it\u{2019}s'), /quote/],
    ['name', d => (d.name = 'a/b'), /slash/],
    ['name', d => (d.name = ''), /empty/],
    ['name', d => (d.name = 'x'.repeat(65)), /64/],
    ['previous.name', d => (d.previous = { type: 'skill', name: 'a:b', hash: 'a'.repeat(64) }), /colon/],
    ['previous.hash', d => (d.previous = { type: 'skill', name: 'contract', hash: 'A'.repeat(64) }), /64 lowercase hex/],
    ['previous.type', d => (d.previous = { type: 'plugin', name: 'contract', hash: 'a'.repeat(64) }), /not one of/],
    ['rewrite.version', d => (d.rewrite = { version: '1.2' }), /expected a version/],
  ];
  for (const [path, mutate, why] of cases) refused(derive(mutate), path, why);
  // A refused type is refused once, and the kinds it gates never print it.
  const badType = `TYPE-${'x'.repeat(300)}`;
  const r = refused(derive(d => {
    d.type = badType;
    d.parts.tools.push({ id: 'bf', kind: 'built-for', fields: { tool: 'Codex' }, mark: 'Proposed' });
    d.parts.tools.push({ id: 'bk', kind: 'binding-key', fields: { setting: 'permissionMode', value: 'default' }, mark: 'Proposed' });
  }), 'type', /not one of/);
  assert.ok(!(r.stderr + r.stdout).includes('TYPE-'), 'the refused type printed');
  assert.ok(!r.stderr.split('\n').some(l => /parts\.tools\[\d+\]\.kind:/.test(l)), 'a refused type gates no kind');
});

test('--check refuses a key named __proto__ at every level, and never reads it as a prototype', () => {
  const cases = [
    ['file', d => JSON.stringify(d).replace(/^\{/, '{"__proto__":{"x":1},')],
    ['parts', d => JSON.stringify(d).replace('"parts":{', '"parts":{"__proto__":[],')],
    ['parts.purpose[1]', d => JSON.stringify(d).replace('"id":"job",', '"__proto__":{"mark":"Decided"},"id":"job",')],
    ['parts.purpose[1].fields', d => JSON.stringify(d).replace('"fields":{"does":', '"fields":{"__proto__":{},"does":')],
    ['questions[0]', d => JSON.stringify(d).replace('"id":"q-job",', '"__proto__":{},"id":"q-job",')],
  ];
  for (const [path, text] of cases) refused(derive(() => {}, text), path, /__proto__/);
});

test('--check passes a clause whose id is constructor, so an id lookup never reads the prototype', () => {
  const p = derive(d => (d.parts.roles[0].id = 'constructor'));
  const r = run(contractRender, [p, '--check']);
  assert.equal(r.code, 0, r.stderr);
});

test('--check refuses an empty part a Quick level does not ask only when it holds a clause', () => {
  const quick = derive(d => {
    d.level = 'Quick';
    d.parts.rules = [];
    d.parts.writing = [];
    d.parts.open = [];
    d.questions = d.questions.filter(q => q.clause !== 'rule-33');
    for (const c of d.parts.rules) delete c.refs;
  });
  const r = run(contractRender, [quick, '--check']);
  assert.equal(r.code, 0, r.stderr);
});
test('--check passes an agent draft, a CLAUDE.md draft named for its folder, and a rewrite drafted fresh', () => {
  const agent = derive(d => {
    d.type = 'agent';
    d.name = 'release-notes';
    d.parts.tools.push({ id: 'built-for', kind: 'built-for', fields: { tool: 'Claude Code' }, mark: 'Proposed' });
    d.parts.tools.push({ id: 'binding-key-1', kind: 'binding-key', fields: { setting: 'permissionMode', value: 'default' }, mark: 'Proposed' });
  });
  const claudeMd = derive(d => {
    d.type = 'CLAUDE.md';
    d.name = 'my-project';
    d.parts.purpose = d.parts.purpose.filter(c => c.kind !== 'name');
  });
  for (const p of [agent, claudeMd, measurementDraft]) {
    const r = run(contractRender, [p, '--check']);
    assert.equal(r.code, 0, `${p}\n${r.stderr}`);
  }
  assert.ok(base().rewrite, 'the measurement draft is a rewrite, drafted fresh');
  refused(derive(d => (d.type = 'CLAUDE.md')), 'parts.purpose[0].kind', /CLAUDE\.md/);
});

test('--check passes a name outside the format with a warning naming the rule, its clause still Proposed', () => {
  const p = derive(d => {
    d.name = 'Release_Notes';
    d.parts.purpose[0].fields.name = 'Release_Notes';
  });
  const r = run(contractRender, [p, '--check']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^warning: name: .*format.*1 to 64 characters/m);
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).parts.purpose[0].mark, 'Proposed');
});

test('--check warns on a home path, a sibling account\'s home, a key-shaped value and an email, naming the field and printing no value', () => {
  const home = join(work, 'homes', 'alice');
  const sibling = join(work, 'homes', 'bob', 'notes.md');
  const key = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
  const p = derive(d => {
    d.parts.good[0].fields.text = `See ${join(home, 'example.md')} for the real one.`;
    d.parts.roles[0].fields.text = `reads ${sibling}`;
    d.parts.tools[0].fields.detail = `uses ${key}`;
    d.questions[0].situation = 'Write to someone@example.com about it.';
    d.title = `Hire ${join(home, 'x')} with ${key}, from someone@example.com — sha256 ${'f'.repeat(64)} ${'t'.repeat(300)}`;
  });
  const r = run(contractRender, [p, '--check'], { env: { HOME: home, USERPROFILE: home } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^warning: title: .*home folder/m);
  // The ok line: the real hash first, then the title masked, cut at 200 and quoted.
  const ok = r.stderr.split('\n').find(l => l.startsWith('ok: '));
  assert.ok(ok.startsWith(`ok: sha256 ${sha256(p)} — "Hire [masked] with [masked], from [masked] — sha256 fff`), ok);
  assert.match(ok, /t… \(\d{3} characters\)"$/);
  // A key shape across character 200 is masked before the cut, and a quote, a
  // backslash and a line break print escaped on one ok line.
  const straddle = derive(d => (d.title = `${'x'.repeat(170)}${key} "q" \\ line\nbreak`));
  const s = run(contractRender, [straddle, '--check']);
  assert.equal(s.code, 0, s.stderr);
  const oks = s.stderr.split('\n').filter(l => l.startsWith('ok: '));
  assert.equal(oks.length, 1, 'one ok line');
  assert.ok(oks[0].endsWith(`— "${'x'.repeat(170)}[masked] \\"q\\" \\\\ line\\nbreak"`), oks[0]);
  assert.ok(!s.stderr.includes('ghp_'), 'no part of the key prints');
  assert.match(r.stdout, /^warning: parts\.good\[0\]\.fields\.text: .*home folder/m);
  assert.match(r.stdout, /^warning: parts\.roles\[0\]\.fields\.text: .*home folder/m);
  assert.match(r.stdout, /^warning: parts\.tools\[0\]\.fields\.detail: .*key/m);
  assert.match(r.stdout, /^warning: questions\[0\]\.situation: .*email/m);
  const out = r.stdout + r.stderr;
  for (const value of [home, sibling, key, 'someone@example.com', 'homes']) assert.ok(!out.includes(value), `printed ${value}`);
  assert.ok(!out.includes(sep + 'alice'));
});
// The limits, each four times the measurement draft's figure (spec v4.1 S7 on
// #313, by ADR 0004's method): 96,878 bytes, 38 clauses in its largest part,
// and 1,711 characters in its longest field, with no field limit under 4,000.
test('--check refuses a draft past each limit, naming the limit, and passes one at it', () => {
  const pad = (d, bytes) => JSON.stringify(d).replace(/^\{/, `{${' '.repeat(bytes)}`);
  const size = Buffer.byteLength(JSON.stringify(base()));
  refused(derive(() => {}, d => pad(d, 387512 - size + 1)), 'file', /387,512 bytes/);
  assert.equal(run(contractRender, [derive(() => {}, d => pad(d, 387512 - size)), '--check']).code, 0, 'a draft of exactly 387,512 bytes passes');
  refused(derive(d => (d.parts.roles[0].fields.text = 'x'.repeat(6845))), 'parts.roles[0].fields.text', /6,844 characters/);
  assert.equal(run(contractRender, [derive(d => (d.parts.roles[0].fields.text = 'x'.repeat(6844))), '--check']).code, 0);
  refused(derive(d => (d.questions[0].situation = 'x'.repeat(6845))), 'questions[0].situation', /6,844 characters/);
  const duties = d => {
    while (d.parts.roles.length < 153) d.parts.roles.push({ id: `extra-${d.parts.roles.length}`, kind: 'duty', fields: { text: 'x' }, mark: 'Proposed' });
  };
  refused(derive(duties), 'parts.roles', /152 clauses/);
  assert.equal(run(contractRender, [derive(d => (duties(d), d.parts.roles.pop())), '--check']).code, 0);
});
test('the script refuses a path holding any of the five single-quote characters or a control character', () => {
  for (const q of ["'", '\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}', '\u{0007}']) {
    const p = join(work, `it${q}s.interview.json`);
    if (q !== '\u{0007}') writeFileSync(p, readFileSync(measurementDraft));
    for (const args of [[p, '--check'], [p, '--answers', measurementDraft], [measurementDraft, '--answers', p], ['--clean', join(work, `contract-interview-${q}`)], ['--new-folder', join(work, `x${q}`)]]) {
      const r = run(contractRender, args);
      assert.equal(r.code, 2, `${JSON.stringify(args)}: ${r.stderr}`);
      assert.match(r.stderr, /path .*(quote|control)/, JSON.stringify(args));
    }
  }
});

test('--check names a file that is not JSON by where it broke, and prints none of its text', () => {
  const p = join(work, 'broken.interview.json');
  writeFileSync(p, '{"title": "SECRET-VALUE", ');
  const r = run(contractRender, [p, '--check']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not valid JSON/);
  assert.doesNotMatch(r.stderr, /SECRET-VALUE/);
  const gone = run(contractRender, [join(work, 'no-such.interview.json'), '--check']);
  assert.equal(gone.code, 2);
  assert.match(gone.stderr, /cannot read .*ENOENT/);
});
const SCRATCH = /^contract-interview-[0-9a-f]{16}$/;
const posix = process.platform !== 'win32';
const mode = p => statSync(p).mode & 0o777;

test('--new-folder makes a new folder with the name pattern inside a parent the person names, and prints its path', () => {
  const parent = join(work, 'parent');
  mkdirSync(parent);
  const r = run(contractRender, ['--new-folder', parent]);
  assert.equal(r.code, 0, r.stderr);
  const made = r.stdout.trim();
  assert.equal(join(made, '..'), parent);
  assert.match(made.split(sep).pop(), SCRATCH);
  assert.deepEqual(readdirSync(made), []);
  if (posix) assert.equal(mode(made), 0o700);
  const again = run(contractRender, ['--new-folder', parent]).stdout.trim();
  assert.notEqual(again, made, 'each call makes a new folder');
});

test('--new-folder with no parent uses the per-user temp folder on Windows and macOS, and the cache folder on Linux', () => {
  const home = join(work, 'nf-home');
  const tmp = join(work, 'nf-tmp');
  mkdirSync(home);
  mkdirSync(tmp);
  const env = { HOME: home, USERPROFILE: home, TMP: tmp, TEMP: tmp, TMPDIR: tmp, XDG_CACHE_HOME: null };
  const r = run(contractRender, ['--new-folder'], { env });
  assert.equal(r.code, 0, r.stderr);
  const made = r.stdout.trim();
  assert.match(made.split(sep).pop(), SCRATCH);
  if (process.platform === 'linux') {
    assert.equal(join(made, '..'), join(home, '.cache', 'contract-interview'));
    assert.equal(mode(join(made, '..')), 0o700);
    assert.equal(mode(made), 0o700);
    const xdg = join(work, 'nf-xdg');
    const r2 = run(contractRender, ['--new-folder'], { env: { ...env, XDG_CACHE_HOME: xdg } });
    assert.equal(join(r2.stdout.trim(), '..'), join(xdg, 'contract-interview'));
  } else {
    assert.equal(join(made, '..').toLowerCase(), tmp.toLowerCase());
  }
});

test('--new-folder refuses a parent inside a git work tree', () => {
  for (const parent of [root, join(root, 'docs')]) {
    const r = run(contractRender, ['--new-folder', parent]);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /git work tree/);
  }
  const worktree = join(work, 'wt');
  mkdirSync(join(worktree, 'sub'), { recursive: true });
  writeFileSync(join(worktree, '.git'), 'gitdir: elsewhere\n');
  assert.equal(run(contractRender, ['--new-folder', join(worktree, 'sub')]).code, 2, 'a .git file marks a linked worktree');
  // The default parent is held to the same rule: a cache or temp folder inside a work tree is refused too.
  const inside = join(worktree, 'sub');
  const r = run(contractRender, ['--new-folder'], { env: { XDG_CACHE_HOME: inside, TMPDIR: inside, TMP: inside, TEMP: inside } });
  assert.equal(r.code, 2, 'the default parent skipped the work-tree check');
  assert.match(r.stderr, /git work tree/);
});

/** A scratch folder holding the three files and one other. */
function scratchFolder() {
  const parent = mkdtempSync(join(work, 'clean-'));
  const folder = run(contractRender, ['--new-folder', parent]).stdout.trim();
  // An empty path would write these into the working folder, the repository.
  assert.match(folder.split(sep).pop(), SCRATCH, 'the scratch folder was made');
  for (const f of ['draft.interview.json', 'interview.html', 'answers.json', 'notes.txt']) writeFileSync(join(folder, f), 'x');
  return folder;
}

test('--clean deletes the page and the answers file, and the draft only with --draft, leaving any other file', () => {
  const folder = scratchFolder();
  const r = run(contractRender, ['--clean', folder]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readdirSync(folder).sort(), ['draft.interview.json', 'notes.txt']);
  assert.match(r.stdout, /deleted interview\.html/);
  assert.match(r.stdout, /deleted answers\.json/);
  assert.match(r.stdout, /2 other entries left/);
  const r2 = run(contractRender, ['--clean', folder, '--draft']);
  assert.equal(r2.code, 0, r2.stderr);
  assert.deepEqual(readdirSync(folder), ['notes.txt']);
  assert.match(r2.stdout, /deleted draft\.interview\.json/);
  assert.match(r2.stdout, /1 other entry left/);
  assert.ok(existsSync(folder), 'the folder stays');
});

test('--clean refuses a folder whose name is not the scratch pattern, and deletes nothing', () => {
  for (const name of ['contract-interview-1234', 'contract-interview-0123456789ABCDEF', 'interview', 'contract-interview-0123456789abcdef0']) {
    const folder = join(work, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'interview.html'), 'x');
    const r = run(contractRender, ['--clean', folder]);
    assert.equal(r.code, 2, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /scratch folder/);
    assert.ok(existsSync(join(folder, 'interview.html')));
  }
});

test('--check sets the draft to mode 600 inside a scratch folder and changes no mode outside one', { skip: !posix && 'POSIX modes' }, () => {
  const folder = scratchFolder();
  const inside = join(folder, 'draft.interview.json');
  writeFileSync(inside, readFileSync(measurementDraft));
  chmodSync(inside, 0o644);
  assert.equal(run(contractRender, [inside, '--check']).code, 0);
  assert.equal(mode(inside), 0o600);
  // The answers file too, read by --answers, even when its block is refused.
  const answersFile = join(folder, 'answers.json');
  writeFileSync(answersFile, '{}');
  chmodSync(answersFile, 0o644);
  assert.equal(run(contractRender, [inside, '--answers', answersFile]).code, 1);
  assert.equal(mode(answersFile), 0o600);
  const outside = derive(() => {});
  chmodSync(outside, 0o644);
  assert.equal(run(contractRender, [outside, '--check']).code, 0);
  assert.equal(mode(outside), 0o644);
});
/* -- the answer block ------------------------------------------------------ */

const Interview = createRequire(import.meta.url)(contractModule);
const kindsFile = join(root, 'skills', 'contract', 'scripts', 'kinds.json');
const kinds = () => JSON.parse(readFileSync(kindsFile, 'utf8'));

/** A draft written to the temp folder, its hashes, and a writer for blocks
 *  made against it, as the page makes them. */
function interview(mutate = () => {}) {
  const draftFile = derive(mutate);
  const hashes = { draft: sha256(draftFile), kinds: sha256(kindsFile) };
  const draft = JSON.parse(readFileSync(draftFile, 'utf8'));
  const write = (state, edit = b => b) => {
    const block = edit(Interview.blockOf(draft, kinds(), hashes, { edits: [], ...state }));
    const p = join(work, `block-${n++}.json`);
    writeFileSync(p, typeof block === 'string' ? block : Interview.blockText(block));
    return p;
  };
  return { draftFile, draft, hashes, write };
}
const answersRun = (draftFile, blockFile, ...more) => run(contractRender, [draftFile, '--answers', blockFile, ...more]);

const EDITS = [
  { op: 'add', id: 'added-1', part: 'roles', kind: 'duty', fields: { text: 'keeps the interview short' } },
  { op: 'rename', part: 'roles', kind: 'duty', name: 'Its duties' },
  { op: 'move', id: 'duty-3', to: 0 },
  { op: 'move', part: 'roles', kind: 'stop', to: 0 },
  { op: 'remove', id: 'stop-9' },
  { op: 'rekind', id: 'stop-10', kind: 'duty', fields: { text: 'asks before it uses a tool not listed' } },
  { op: 'remove', part: 'writing', kind: 'style' },
  { op: 'add', id: 'added-2', part: 'writing', kind: 'style', fields: { text: 'Plain words, short lines.' } },
  { op: 'none', part: 'purpose', kind: 'stays-out' },
];

test('--answers passes a block pasted with its code fence, with an edit of every kind', () => {
  const iv = interview();
  const block = iv.write({ answers: new Map([['job', { option: 'job-b', chip: 1 /* It is safer */ }], ['why', { fields: { text: 'Because.' } }]]), edits: EDITS });
  const r = answersRun(iv.draftFile, block);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /^ok: the block matches its draft/m);
  const bare = join(work, 'bare-block.json');
  writeFileSync(bare, readFileSync(block, 'utf8').replace(/^```json\n|```\n$/g, ''));
  assert.equal(answersRun(iv.draftFile, bare).code, 0, 'a block without its fence passes too');
});

test('--answers refuses each case in the spec\'s list, naming the field', () => {
  const iv = interview();
  const one = new Map([['job', { option: 'job-b' }]]);
  const cases = [
    ['file', b => ({ ...b, extra: 1 }), /unknown key "extra"/],
    ['format', b => ({ ...b, format: 2 }), /unknown format/],
    ['draft', b => ({ ...b, draft: 'a'.repeat(64) }), /made from another draft/],
    ['answers[0]', b => ((b.answers[0].extra = 1), b), /unknown key "extra"/],
    ['answers[0].id', b => ((b.answers[0].id = 'no-such'), b), /no clause/],
    ['answers[0].id', b => ((b.answers[0].id = 'constructor'), b), /no clause/],
    ['answers[0].option', b => ((b.answers[0].option = 'stop-3-b'), b), /not an option/],
    ['answers[0]', b => ((b.answers[0].fields = { does: 'x', for: 'y' }), b), /both/],
    ['answers[0].mark', b => ((b.answers[0].mark = 'Decided'), b), /is not what this answer earns/],
    ['answers[0].chip', b => ((b.answers[0].chip = 'I made this up'), b), /is not a chip of this clause/],
    ['answers[0].chip', b => ((b.answers[0].chip = 3), b), /is not a chip of this clause/],
    ['answers[0].flag', b => ((b.answers[0].flag = 'yes'), b), /true/],
    ['answers[1].id', b => (b.answers.push({ ...b.answers[0] }), b), /second answer/],
    ['answers[0].fields.does', b => ({ ...b, answers: [{ id: 'job', fields: { does: 'a\u{202E}b', for: 'y' }, mark: 'Decided' }] }), /U\+202E/],
    ['answers[0].fields', b => ({ ...b, answers: [{ id: 'job', fields: { does: 'x' }, mark: 'Decided' }] }), /missing required key "for"/],
    ['answers[0].mark', b => ({ ...b, answers: [{ id: 'sign-off-1', option: 'sign-off-1-a', mark: 'Confirmed' }] }), /it earns Proposed/],
    ['answers[0].fields.text', b => ({ ...b, answers: [{ id: 'why', fields: { text: '' }, mark: 'Decided' }] }), /why/],
    ['edits[0].op', b => ({ ...b, edits: [{ op: 'explode', id: 'job' }] }), /not one of/],
    ['edits[0].id', b => ({ ...b, edits: [{ op: 'remove', id: 'no-such' }] }), /no clause/],
    ['edits[0].id', b => ({ ...b, edits: [{ op: 'add', id: 'job', part: 'roles', kind: 'duty', fields: { text: 'x' } }] }), /duplicate/],
    ['edits[0].kind', b => ({ ...b, edits: [{ op: 'add', id: 'added-1', part: 'roles', kind: 'key', fields: { capability: 'x', reason: 'y' } }] }), /cannot hold/],
    ['edits[0].kind', b => ({ ...b, edits: [{ op: 'add', id: 'added-1', part: 'tools', kind: 'built-for', fields: { tool: 'x' } }] }), /this draft's type cannot hold this kind; it is for agent and CLAUDE\.md/],
    ['edits[0].kind', b => ({ ...b, edits: [{ op: 'add', id: 'added-1', part: 'tools', kind: 'binding-key', fields: { setting: 'x', value: 'y' } }] }), /this draft's type cannot hold this kind; it is for agent and CLAUDE\.md/],
    // A rename names a schedule; an entry has no name of its own to export.
    ['edits[0]', b => ({ ...b, edits: [{ op: 'rename', id: 'duty-2', name: 'x' }] }), /a rename names a schedule by part and kind/],
    // An edit on a clause an earlier agreed none or schedule removal took.
    ['edits[1].id', b => ({ ...b, edits: [{ op: 'none', part: 'roles', kind: 'duty' }, { op: 'rekind', id: 'duty-1', kind: 'stop', fields: { when: 'x' } }] }), /names no clause in this draft or its edits/],
    ['edits[1].id', b => ({ ...b, edits: [{ op: 'none', part: 'roles', kind: 'duty' }, { op: 'move', id: 'duty-1', to: 0 }] }), /names no clause in this draft or its edits/],
    ['edits[2].id', b => ({ ...b, edits: [{ op: 'add', id: 'added-1', part: 'roles', kind: 'duty', fields: { text: 'x' } }, { op: 'remove', part: 'roles', kind: 'duty' }, { op: 'rekind', id: 'added-1', kind: 'stop', fields: { when: 'x' } }] }), /names no clause in this draft or its edits/],
    ['edits[2].id', b => ({ ...b, edits: [{ op: 'add', id: 'added-1', part: 'roles', kind: 'duty', fields: { text: 'x' } }, { op: 'remove', part: 'roles', kind: 'duty' }, { op: 'remove', id: 'added-1' }] }), /names no clause in this draft or its edits/],
    ['edits[2].id', b => ({ ...b, edits: [{ op: 'rekind', id: 'stop-10', kind: 'duty', fields: { text: 'x' } }, { op: 'remove', part: 'roles', kind: 'duty' }, { op: 'move', id: 'stop-10', to: 0 }] }), /names no clause in this draft or its edits/],
    ['edits[0].restored', b => ({ ...b, edits: [{ op: 'remove', id: 'stop-9', restored: 'yes' }] }), /expected true/],
    ['edits[0].fields', b => ({ ...b, edits: [{ op: 'add', id: 'added-1', part: 'roles', kind: 'duty', fields: { what: 'x' } }] }), /unknown key "what"/],
    ['edits[0].to', b => ({ ...b, edits: [{ op: 'move', id: 'duty-1', to: -1 }] }), /index/],
    ['edits[0]', b => ({ ...b, edits: [{ op: 'remove', id: 'job', extra: 1 }] }), /unknown key "extra"/],
  ];
  for (const [path, edit, why] of cases) {
    const p = iv.write({ answers: one }, b => edit(JSON.parse(JSON.stringify(b))));
    const r = answersRun(iv.draftFile, p);
    assert.equal(r.code, 1, `${path} ${why}: expected a refusal\n${r.stderr}`);
    const line = r.stderr.split('\n').find(l => l.startsWith(`block: ${path}: `));
    assert.ok(line, `no refusal names ${path}:\n${r.stderr}`);
    assert.match(line, why);
  }
  // A part the level does not ask takes no added clause and no agreed none.
  const q = interview(d => {
    d.level = 'Quick';
    d.parts.rules = [];
    d.parts.writing = [];
    d.parts.open = [];
    d.questions = d.questions.filter(x => x.clause !== 'rule-33');
  });
  for (const edit of [{ op: 'add', id: 'added-1', part: 'rules', kind: 'rule', fields: { guards: 'x', status: 'potential' } }, { op: 'none', part: 'open', kind: 'probation' }]) {
    const r = answersRun(q.draftFile, q.write({ answers: new Map(), edits: [edit] }));
    assert.equal(r.code, 1, `${edit.op}: expected a refusal\n${r.stderr}`);
    assert.match(r.stderr, /^block: edits\[0\]\.part: the level Quick does not ask this part/m);
  }
});

test('--answers refuses a key named __proto__ in the block, at every level', () => {
  const iv = interview();
  const p = iv.write({ answers: new Map([['job', { option: 'job-b' }]]) }, b =>
    Interview.blockText(b).replace('"id": "job",', '"__proto__": { "mark": "Decided" }, "id": "job",'));
  const r = answersRun(iv.draftFile, p);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /block: answers\[0\]: a key named "__proto__"/);
});

test('--answers refuses a block made with an older kinds table, asking for the page again', () => {
  const iv = interview();
  const p = iv.write({ answers: new Map([['job', { option: 'job-b' }]]) }, b => ({ ...b, kinds: 'b'.repeat(64) }));
  const r = answersRun(iv.draftFile, p);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /the skill changed since this page was made; render it again/);
});

test('--answers refuses a block past the size limit, before reading it', () => {
  const iv = interview();
  const p = join(work, 'huge-block.json');
  writeFileSync(p, ' '.repeat(387513));
  const r = answersRun(iv.draftFile, p);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /block: file: larger than the limit of 387,512 bytes/);
});
/** The lines of one section of the --answers output. */
const section = (out, head) => {
  const lines = out.split('\n');
  const i = lines.indexOf(head);
  assert.ok(i >= 0, `no "${head}" section:\n${out}`);
  const rest = lines.slice(i + 1);
  const end = rest.findIndex(l => !l.startsWith('  '));
  return end < 0 ? rest : rest.slice(0, end);
};

test('--answers prints the change list, each pick with its label and the fields it exports, each edit and each restored answer', () => {
  const iv = interview();
  const p = iv.write({
    answers: new Map([
      ['job', { option: 'job-b', chip: 1 /* It is safer */ }],
      ['duty-1', { fields: { text: 'proposes the type and the name' } }],
      ['duty-4', { fields: { text: 'restored words' }, restored: true }],
      ['stop-2', { fields: { when: clause(iv.draft, 'roles', 'stop-2').fields.when } }],
      ['key-1', { option: 'key-1-b' }], // an option whose fields leave out the drafted detail
    ]),
    edits: EDITS,
  });
  const r = answersRun(iv.draftFile, p);
  assert.equal(r.code, 0, r.stderr);
  const changes = section(r.stdout, 'Changes:');
  assert.ok(changes.includes('  roles/stop-2 then removed'), 'a drafted field the answer leaves out is named');
  assert.ok(changes.includes('  tools/key-1 detail removed'), 'and one a picked option leaves out');
  const job = iv.draft.questions[0].options[1];
  assert.ok(changes.includes(`  purpose/job picked ${JSON.stringify(job.label)}, not the proposal; marked Confirmed; chip "It is safer"`), changes.join('\n'));
  assert.ok(changes.includes(`  purpose/job does ${JSON.stringify(job.fields.does)}`));
  assert.ok(changes.includes(`  purpose/job for ${JSON.stringify(job.fields.for)}`));
  assert.ok(changes.includes('  roles/duty-1 wrote its own words; marked Decided'));
  assert.ok(changes.includes('  roles/duty-1 text "proposes the type and the name"'));
  assert.ok(changes.includes('  roles/duty-4 restored, not kept; marked Proposed'));
  assert.ok(changes.includes('  edit: added roles/added-1, a duty'));
  assert.ok(changes.includes('  roles/added-1 text "keeps the interview short"'));
  assert.ok(changes.includes('  edit: renamed the roles schedule of duty "Its duties"'));
  assert.ok(changes.includes('  edit: moved roles/duty-3 to place 1'));
  assert.ok(changes.includes('  edit: moved the roles schedule of stop to place 1'));
  assert.ok(changes.includes('  edit: removed roles/stop-9'));
  assert.ok(changes.includes('  edit: re-kinded roles/stop-10 from stop to duty'));
  assert.ok(changes.includes('  edit: removed the writing schedule of style'));
  assert.ok(changes.includes('  edit: agreed none for the purpose schedule of stays-out'));
});

test('--answers lists for push-back every high-stakes clause, every removal or re-kind of one, every flag, every restored answer, every removal another clause names, and every warned field', () => {
  const iv = interview();
  const p = iv.write({
    answers: new Map([
      ['job', { option: 'job-b', flag: true }],
      ['duty-4', { fields: { text: 'restored words' }, restored: true }],
      ['duty-5', { fields: { text: 'writes to someone@example.com' } }],
    ]),
    edits: [{ op: 'remove', id: 'stop-9' }, { op: 'rekind', id: 'stop-10', kind: 'duty', fields: { text: 'asks first' } }],
  });
  const r = answersRun(iv.draftFile, p);
  assert.equal(r.code, 0, r.stderr);
  const back = section(r.stdout, 'Push back on:');
  const has = (line, why) => assert.ok(back.some(l => l.startsWith(`  ${line}:`) && l.includes(why)), `${line} ${why}\n${back.join('\n')}`);
  has('roles/sign-off-1', 'a high-stakes clause');
  has('roles/stop-1', 'a high-stakes clause');
  has('tools/record', 'a high-stakes clause');
  has('roles/stop-9', 'a high-stakes clause removed');
  has('roles/stop-9', 'named by rules/rule-16');
  has('roles/stop-10', 're-kinded away from a high-stakes kind');
  has('purpose/job', 'flagged');
  has('roles/duty-4', 'restored, not kept');
  has('roles/duty-5', 'a warned field');
  assert.ok(!back.some(l => l.startsWith('  roles/duty-1:')), 'an untouched low-stakes clause is not listed');
  const all = section(answersRun(iv.draftFile, p, '--shared').stdout, 'Push back on:');
  // Every live clause of the draft, part by part; stop-9 was removed and
  // stop-10 re-kinded, and both are listed for that.
  for (const [part, list] of Object.entries(iv.draft.parts)) for (const c of list) {
    assert.ok(all.some(l => l.startsWith(`  ${part}/${c.id}:`) && (c.id === 'stop-9' || l.includes('a clause of a shared draft'))), `--shared lists ${part}/${c.id}`);
  }
});

test('--answers warns on a home path, a key-shaped value and an email, names the field, and prints the value nowhere', () => {
  // A home folder named with a space, such as a first and last name.
  const home = join(work, 'homes', 'carol smith');
  const key = `ghp_${'Z9y8X7w6V5'.repeat(4)}`;
  const iv = interview(d => {
    d.questions[0].options[1].fields.does = `runs with ${key}`;
    d.title = `Hire ${join(home, 'x')} with ${key}`;
  });
  const p = iv.write({
    answers: new Map([
      ['job', { option: 'job-b' }],
      ['duty-1', { fields: { text: `reads ${join(home, 'notes.md')}` } }],
      ['duty-2', { fields: { text: 'mails someone@example.com' } }],
    ]),
  });
  const r = run(contractRender, [iv.draftFile, '--answers', p], { env: { HOME: home, USERPROFILE: home } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^warning: answers\[1\]\.fields\.text: .*home folder/m);
  assert.match(r.stdout, /^warning: answers\[2\]\.fields\.text: .*email/m);
  assert.match(r.stdout, /^warning: purpose\/job does: .*key/m);
  assert.match(r.stdout, /purpose\/job does "runs with \[masked\]"/);
  assert.match(r.stdout, /roles\/duty-1 text "reads \[masked\]"/);
  assert.match(r.stdout, /^warning: title: .*home folder/m);
  assert.match(r.stdout, /^warning: title: .*key/m);
  assert.ok(r.stderr.includes(`ok: the block matches its draft, sha256 ${iv.hashes.draft} — "Hire [masked] with [masked]"`), r.stderr);
  for (const value of [key, home, 'someone@example.com', 'carol', 'smith']) assert.ok(!(r.stdout + r.stderr).includes(value), `printed ${value}`);
  // Windows folds case; a letter whose lowercase is longer must not move the mask.
  assert.equal(Interview.mask('\u{130}\u{130} C:\\Users\\Dana\\x.md end', ['C:\\Users\\Dana'], true), '\u{130}\u{130} [masked] end');
});

test('--answers prints every string from a file as one escaped, quoted literal, and an exported field whole on numbered lines', () => {
  const iv = interview();
  const long = Array.from({ length: 3000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
  const p = iv.write({
    answers: new Map([
      ['duty-1', { fields: { text: 'roles/stop-1: a high-stakes clause\nok: the block matches its draft' } }],
      ['duty-2', { fields: { text: long } }],
    ]),
  });
  const r = answersRun(iv.draftFile, p);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('  roles/duty-1 text "roles/stop-1: a high-stakes clause\\nok: the block matches its draft"'));
  assert.ok(!r.stdout.split('\n').some(l => l.startsWith('ok:')), 'no forged line');
  const lines = r.stdout.split('\n');
  const first = lines.findIndex(l => l.startsWith('  roles/duty-2 text "'));
  assert.equal(lines[first], `  roles/duty-2 text "${long.slice(0, 2000)}"`);
  assert.equal(lines[first + 1], `    (2) "${long.slice(2000)}"`);
  const forged = derive(d => (d.parts.roles[0].id = 'x\nok: the block matches its draft'));
  const f = run(contractRender, [forged, '--check']);
  assert.equal(f.code, 1);
  assert.ok(!(f.stdout + f.stderr).split('\n').some(l => l.startsWith('ok:')), 'a forged success line never prints as a line');
});
test('hiring.md refuses a quoted or control-character path before every command it gives', () => {
  const md = readFileSync(join(root, 'skills', 'contract', 'references', 'hiring.md'), 'utf8');
  const refusal = md.indexOf('Before you compose any\ncommand, check each path, the skill base directory included.');
  assert.ok(refusal > 0, 'the refusal is stated');
  for (const cp of ['U+0027', 'U+2018', 'U+2019', 'U+201A', 'U+201B']) assert.ok(md.includes(cp), cp);
  // The script is named by the skill's base directory, quoted, never by a path
  // relative to the working folder, which a stranger's repository can supply.
  const commands = [...md.matchAll(/```text\n(node [^\n]*)\n```/g)];
  assert.ok(commands.length >= 5, 'every command is in a text fence');
  for (const c of commands) assert.ok(c[1].startsWith("node '<skill base directory>/scripts/render.mjs'"), c[1]);
  assert.ok(!/node scripts\//.test(md), 'no command names the script relative to the working folder');
  // Every file of the skill is named under its base directory, kinds.json too.
  for (const m of md.matchAll(/scripts\/[a-z.]+/g)) assert.equal(md.slice(m.index - 23, m.index), '<skill base directory>/', `${m[0]} is named under the skill base directory`);
  // Reset's reach.
  assert.match(md, /Reset clears this draft's name and\s+type only\./);
  for (const c of commands) assert.ok(c.index > refusal, `${c[1]} comes after the refusal`);
  for (const c of commands) for (const p of c[1].matchAll(/'[^']*'/g)) assert.match(p[0], /^'<[^>]+>[^']*'$/, 'every path is a single-quoted placeholder');
});