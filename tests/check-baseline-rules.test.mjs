// Tests of scripts/check.mjs: what a SkillSpector baseline may hold. The
// fixture they share, and why every case copies the tree, is in
// check-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './helpers.mjs';
import { tree, rootBaselineIn, skillBaselineIn, fixtureBaselineIn, assertPasses, assertFails, baselineBody } from './check-fixture.mjs';

test('the same rule twice in one baseline fails', () => {
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    baselineBody([
      { id: 'AR2', reason: 'One argument.' },
      { id: 'AR2', reason: 'A second argument.' },
    ]),
  );
  assertFails(dir, /AR2 appears twice/);
});

test('an unknown top-level key is named, not ignored', () => {
  // The reader is hand-written and reads one shape. A key it does not know is
  // a key it cannot honour, and honouring nothing quietly is how a baseline
  // grows a field that does nothing.
  const dir = tree();
  appendFileSync(rootBaselineIn(dir), '\nseverity_floor: HIGH\n');
  assertFails(dir, /unknown key "severity_floor"/);
});

test('an unknown field inside a rule entry is named', () => {
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    severity: "LOW"\n    reason: "x"\n',
  );
  assertFails(dir, /unknown field "severity"/);
});

test('a nested value the reader cannot follow fails rather than being skipped', () => {
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    reason:\n      - "x"\n',
  );
  assertFails(dir, /not a "key: value" field|not a rule entry/);
});

test('an empty rules block fails, because a baseline that suppresses nothing is not one', () => {
  const dir = tree();
  writeFileSync(rootBaselineIn(dir), 'version: 2\nfingerprints: []\n\nrules:\n');
  assertFails(dir, /no rules/);
});

// eagle-eye's AR2 entry as shipped: a file and an exact message, because a skill
// entry may narrow a rule-wide root entry. The root's AR2 names neither.
const SKILL_AR2 = '  - rule_id: "AR2"\n    file: "SKILL.md"\n    message: "do not judge"\n';
const ROOT_AR2 = '  - rule_id: "AR2"\n';

// A checkout with autocrlf holds CRLF, which the reader strips and these
// strings do not carry, so every read here goes through lf().
const lf = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Replaces text that must be there. A case that edits a file which no longer
// holds the text would otherwise pass for the wrong reason.
function edit(path, from, to) {
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), `${path} does not hold ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}
const skillSides = dir => [skillBaselineIn(dir), fixtureBaselineIn(dir)];

test('a skill entry that names a file where the root names none passes', () => {
  // A skill entry may be narrower than the root's, never broader. The shipped
  // tree is the proof: the skill's AR2 is on SKILL.md and the root's is on no
  // file.
  const dir = tree();
  assert.match(lf(skillBaselineIn(dir)), /rule_id: "AR2"\n    file: "SKILL\.md"\n/);
  assert.doesNotMatch(lf(rootBaselineIn(dir)), /rule_id: "AR2"\n    file:/);
  assertPasses(dir);
});

test('a rule narrowed to the same file in both baselines passes', () => {
  const dir = tree();
  edit(rootBaselineIn(dir), ROOT_AR2, `${ROOT_AR2}    file: "*SKILL.md"\n`);
  for (const p of skillSides(dir)) edit(p, '    file: "SKILL.md"\n    message: "do not judge"\n', '    file: "*SKILL.md"\n    message: "do not judge"\n');
  assertPasses(dir);
});

test('a rule narrowed to a message in the skill and not the root fails when the message holds a wildcard', () => {
  // A message glob narrows a suppression the way a file glob does: the scanner
  // suppresses a finding only when its message, finding or matched text
  // matches. A narrowing of a rule-wide entry names one exact text.
  const dir = tree();
  edit(skillBaselineIn(dir), 'message: "do not judge"', 'message: "*preview pane*"');
  const r = assertFails(dir, /matched to \*preview pane\* here and to every message/);
  assert.match(r.stderr, /a narrowing of a rule-wide entry names one exact text/);
});

test('a rule narrowed to the same message in both baselines passes', () => {
  const dir = tree();
  edit(rootBaselineIn(dir), ROOT_AR2, `${ROOT_AR2}    file: "*SKILL.md"\n    message: "*preview pane*"\n`);
  for (const p of skillSides(dir)) edit(p, SKILL_AR2, '  - rule_id: "AR2"\n    file: "*SKILL.md"\n    message: "*preview pane*"\n');
  assertPasses(dir);
});

test('a disagreeing glob is printed masked, because the CI log is public', () => {
  // The root baseline sits outside skills/, so the home-path rule never reads
  // it. A message glob is the field most likely to hold pasted matched text.
  const dir = tree();
  edit(rootBaselineIn(dir), ROOT_AR2, `${ROOT_AR2}    file: "/Users/someone/*"\n    message: "*C:/Users/someone/box*"\n`);
  const r = assertFails(dir, /matched to do not judge here and to \*C:\/Users\/<name>\/box\* in/);
  assert.match(r.stderr, /narrowed to SKILL\.md here and to \/Users\/<name>\/\* in/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
});

test('a disagreeing glob on the skill side is printed masked too', () => {
  // The same lines print the skill's glob as well, so the mask is held on that
  // side by its own case. The clause after the dash is printed through
  // shown() as well.
  const dir = tree();
  edit(skillBaselineIn(dir), SKILL_AR2, '  - rule_id: "AR2"\n    file: "/Users/someone/*"\n    message: "*C:/Users/someone/box*"\n');
  const r = assertFails(dir, /matched to \*C:\/Users\/<name>\/box\* here and to every message in/);
  assert.match(r.stderr, /narrowed to \/Users\/<name>\/\* here and to every file in/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
});

test('a value the reader refuses is printed masked too', () => {
  // A Windows path in double quotes holds backslashes, which this reader
  // refuses. The refusal names the value, and the root file is read by no
  // home-path rule, so the mask has to be on this line.
  const dir = tree();
  const root = readFileSync(rootBaselineIn(dir), 'utf8');
  writeFileSync(rootBaselineIn(dir), root.replace('  - rule_id: "AR2"\n', '  - rule_id: "AR2"\n    message: "*C:\\Users\\someone\\box*"\n'));
  const r = assertFails(dir, /"message" is not a plainly double-quoted value/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
});

test('two different messages for one rule fail, not only a message on one side', () => {
  // Both sides narrowed is not agreement unless they narrow the same way: a
  // root that matches more than the skill would suppress more than it says.
  const dir = tree();
  edit(rootBaselineIn(dir), ROOT_AR2, `${ROOT_AR2}    message: "*preview pane*"\n`);
  edit(skillBaselineIn(dir), 'message: "do not judge"', 'message: "*preview*"');
  edit(fixtureBaselineIn(dir), 'message: "do not judge"', 'message: "*preview pane*"');
  assertFails(dir, /matched to \*preview\* here and to \*preview pane\* in/);
});

// The reader and SkillSpector's YAML loader must agree on what an entry says.
// Each case below is a spelling they read differently, so two files could agree
// in the check while the scanner applied a broader suppression than either
// appears to say.
function rootWith(dir, fields) {
  writeFileSync(rootBaselineIn(dir), `version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n${fields}    reason: "x"\n`);
}

test('a bare entry value with a trailing comment fails, because YAML ends the value at the comment', () => {
  const dir = tree();
  rootWith(dir, '    message: preview pane # a note\n');
  assertFails(dir, /"message" must be double-quoted/);
});

test('a bare rule_id or reason fails too', () => {
  const dir = tree();
  writeFileSync(rootBaselineIn(dir), 'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: AR2\n    reason: "x"\n');
  assertFails(dir, /"rule_id" must be double-quoted/);
  writeFileSync(rootBaselineIn(dir), 'version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "AR2"\n    reason: x\n');
  assertFails(dir, /"reason" must be double-quoted/);
});

test('a file or message written as a YAML null fails, because the scanner reads it as no narrowing', () => {
  for (const nul of ['~', 'null']) {
    for (const key of ['file', 'message']) {
      const dir = tree();
      rootWith(dir, `    ${key}: ${nul}\n`);
      assertFails(dir, new RegExp(`"${key}" must be double-quoted`));
    }
  }
});

test('a rule_id with a wildcard fails, because the scanner reads it as a pattern', () => {
  for (const id of ['A*', 'AR?', 'A[RS]2', '*']) {
    const dir = tree();
    writeFileSync(rootBaselineIn(dir), `version: 2\nfingerprints: []\n\nrules:\n  - rule_id: "${id}"\n    reason: "x"\n`);
    assertFails(dir, /"rule_id" holds a wildcard/);
  }
});

test('a file or message made only of wildcard characters fails, because it narrows nothing', () => {
  for (const key of ['file', 'message']) {
    for (const glob of ['*', '**', '?*', '[*]']) {
      const dir = tree();
      rootWith(dir, `    ${key}: "${glob}"\n`);
      assertFails(dir, new RegExp(`"${key}" is empty or made only of wildcard characters`));
    }
  }
});

test('two rule ids that differ only in case fail, because the scanner ignores case', () => {
  // The scanner lower-cases both sides before it matches. A narrowed "AR2" and
  // an un-narrowed "ar2" are one rule to it, and the wide entry would win.
  const dir = tree();
  writeFileSync(
    rootBaselineIn(dir),
    baselineBody([
      { id: 'AR2', reason: 'One argument.' },
      { id: 'ar2', reason: 'A second argument.' },
    ]),
  );
  assertFails(dir, /ar2 and AR2 are one rule/);
  // The mirror lookup folds case too: a skill's lower-case twin of AR2 is held
  // to the root's AR2 reason and scope, not skipped as an unknown rule.
  const other = tree();
  edit(skillBaselineIn(other), SKILL_AR2, '  - rule_id: "ar2"\n    file: "*SKILL.md"\n');
  assertFails(other, /ar2 is narrowed to \*SKILL\.md here and to every file/);
});

test('a quoted version is read, because the entries accept quoting too', () => {
  const dir = tree();
  const text = readFileSync(rootBaselineIn(dir), 'utf8');
  writeFileSync(rootBaselineIn(dir), text.replace('version: 2', 'version: "2"'));
  assertPasses(dir);
});

// C1. The exact set of narrowed entries the four skills ship. The reader in
// scripts/check.mjs exports nothing, so this parses the fixed entry shape
// itself: a "- rule_id" line opens an entry, and its file, message and reason
// lines follow, each double-quoted. An entry added, dropped or re-pointed needs
// an edit here in the same diff.
function entriesOf(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const text = line.replace(/\r$/, '');
    if (!text.trim() || text.trimStart().startsWith('#') || /^[a-z_]+:/.test(text)) continue;
    const m = /^(?:  - | {4})([a-z_]+):\s*"([^"]*)"\s*$/.exec(text);
    if (!m) throw new Error(`entriesOf cannot read: ${text}`);
    if (line.startsWith('  - ')) out.push({});
    if (out.length) out[out.length - 1][m[1]] = m[2];
  }
  return out;
}
const TR2_MESSAGE =
  'e asks for work to run in another session, to start or hand off to a new session, or to lead several sessions, or types /head-chef';
const SHIPPED = {
  'eagle-eye': [
    ['AR2', 'SKILL.md', 'do not judge'],
    ['EA2', 'SKILL.md'],
    ['EA2', 'CONTRACT.md'],
    ['EA3', 'assets/OFL.txt'],
    ['LP3', 'SKILL.md'],
    ['MP3', 'lib/template.html'],
    ['RA2', 'SKILL.md'],
    ['PE3', 'audit.mjs', '.env '],
    ['E1', 'audit.mjs'],
  ],
  groundtrack: [
    ['LP3', 'SKILL.md'],
    ['EA3', 'assets/OFL.txt'],
    ['P2', 'assets/template.html'],
  ],
  'head-chef': [
    ['RP1', 'README.md'],
    ['TR2', '*SKILL.md', TR2_MESSAGE],
    ['EA2', 'SKILL.md'],
    ['EA2', 'references/CONTRACT.md'],
    ['EA2', 'README.md'],
    ['EA2', 'references/contract.changelog.md'],
  ],
  contract: [
    ['EA2', 'references/binding-antigravity.md'],
    ['EA2', 'references/binding-claude.md'],
    ['EA2', 'references/binding-codex.md'],
    ['EA2', 'references/contract.changelog.md'],
    ['EA2', 'references/CONTRACT.md'],
    ['P2', 'SKILL.md'],
    ['RA2', 'references/binding-codex.md'],
    ['LP3', 'SKILL.md'],
    ['MP1', '*contract.changelog.md'],
    ['RA2', 'README.md'],
    ['EA3', 'assets/OFL.txt'],
    ['AS3', 'references/template.md', 'skills/*/SKILL.md'],
  ],
};

test('each skill ships exactly its narrowed entries, none with a wildcard except head-chef TR2 and contract MP1 and AS3', () => {
  for (const [skill, want] of Object.entries(SHIPPED)) {
    const got = entriesOf(join(root, 'skills', skill, '.skillspector-baseline.yaml'));
    assert.deepEqual(
      got.map(e => [e.rule_id, e.file, e.message].filter(v => v !== undefined)),
      want,
      `${skill}: the shipped entries`,
    );
    for (const e of got) {
      // These keep the root's own wildcard, which a skill entry may repeat.
      if (e.rule_id === 'TR2' || (skill === 'contract' && (e.rule_id === 'MP1' || e.rule_id === 'AS3'))) continue;
      assert.doesNotMatch(`${e.file}${e.message ?? ''}`, /[*?[]/, `${skill} ${e.rule_id}: a wildcard in a narrowing`);
    }
  }
});

// The root's own narrowed entries, pinned too: a skill entry may be narrower
// than the root's, so dropping a root file or message would otherwise pass.
test('the root baseline keeps its three narrowed entries', () => {
  const got = entriesOf(join(root, '.skillspector-baseline.yaml')).filter(e => e.file !== undefined || e.message !== undefined);
  assert.deepEqual(
    got.map(e => [e.rule_id, e.file, e.message].filter(v => v !== undefined)),
    [['AS3', 'skills/*/SKILL.md'], ['MP1', '*contract.changelog.md'], ['TR2', '*SKILL.md']],
  );
});

// C5. A skill entry that is broader than, or different from, the root's.
test('a skill entry broader than or different from the root entry fails', () => {
  const rows = [
    // the root names a file, the skill names another
    ['a different file', d => edit(rootBaselineIn(d), ROOT_AR2, `${ROOT_AR2}    file: "*SKILL.md"\n`), /narrowed to SKILL\.md here and to \*SKILL\.md in/, /never broader/],
    // the root names a file, the skill names none
    ['no file where the root has one', d => {
      edit(rootBaselineIn(d), ROOT_AR2, `${ROOT_AR2}    file: "SKILL.md"\n`);
      for (const p of skillSides(d)) edit(p, '    file: "SKILL.md"\n    message: "do not judge"\n', '    message: "do not judge"\n');
    }, /narrowed to every file here and to SKILL\.md in/, /never broader/],
    // the root names none, the skill names a wildcard
    ...['*SKILL.md', 'SKILL.m?', 'SKILL.m[d]'].map(g => [`a wildcard file ${g} on a rule-wide root entry`, d => edit(skillBaselineIn(d), 'file: "SKILL.md"\n    message: "do not judge"', `file: "${g}"\n    message: "do not judge"`), new RegExp(`narrowed to ${g.replace(/[\\*?[\]]/g, '\\$&')} here and to every file in`), /names one exact path/]),
  ];
  for (const [name, mutate, head, tail] of rows) {
    const dir = tree();
    mutate(dir);
    const r = assertFails(dir, head);
    assert.match(r.stderr, tail, name);
  }
});

// C6. A skill baseline may repeat a rule, each copy on its own file.
test('a skill baseline repeats a rule only when every copy names a different file', () => {
  const ea2 = '  - rule_id: "EA2"\n    file: "CONTRACT.md"\n';
  const rows = [
    ['a distinct file on every copy passes', p => edit(p, ea2, '  - rule_id: "EA2"\n    file: "README.md"\n'), null],
    ['a copy with no file fails', p => edit(p, ea2, '  - rule_id: "EA2"\n'), /EA2 appears twice and a copy names no file/],
    ['an earlier copy with no file fails', p => edit(p, '  - rule_id: "EA2"\n    file: "SKILL.md"\n', '  - rule_id: "EA2"\n'), /EA2 appears twice and a copy names no file/],
    ['equal files fail', p => edit(p, ea2, '  - rule_id: "EA2"\n    file: "SKILL.md"\n'), /EA2 appears twice for SKILL\.md/],
    ['files equal once case-folded fail', p => edit(p, ea2, '  - rule_id: "EA2"\n    file: "skill.MD"\n'), /EA2 appears twice for skill\.MD/],
  ];
  for (const [name, mutate, fails] of rows) {
    const dir = tree();
    for (const p of skillSides(dir)) mutate(p);
    if (fails) assertFails(dir, fails);
    else assertPasses(dir);
  }
  // A refusal prints the file masked, because the CI log is public.
  const dup = tree();
  edit(skillBaselineIn(dup), ea2, '  - rule_id: "EA2"\n    file: "/Users/someone/x"\n');
  edit(skillBaselineIn(dup), '  - rule_id: "EA2"\n    file: "SKILL.md"\n', '  - rule_id: "EA2"\n    file: "/users/someone/X"\n');
  const r = assertFails(dup, /EA2 appears twice for \/Users\/<name>\/x/);
  assert.doesNotMatch(r.stdout + r.stderr, /someone/);
  // The root never repeats a rule.
  const rootDir = tree();
  edit(rootBaselineIn(rootDir), '  - rule_id: "EA2"\n', '  - rule_id: "EA2"\n    file: "A.md"\n    reason: "x"\n  - rule_id: "EA2"\n    file: "B.md"\n');
  assertFails(rootDir, /EA2 appears twice/);
});

// C7. An exact message narrows a rule-wide root entry; a wildcard one does not.
test('a skill entry may pin an exact message where the root has none, never a wildcard or a different one', () => {
  const pass = tree();
  edit(skillBaselineIn(pass), 'message: "do not judge"', 'message: "another exact text"');
  assertPasses(pass);
  for (const bad of ['do not *', 'do not judg?', 'do not [j]udge']) {
    const dir = tree();
    edit(skillBaselineIn(dir), 'message: "do not judge"', `message: "${bad}"`);
    const r = assertFails(dir, /matched to .* here and to every message in/);
    assert.match(r.stderr, /names one exact text/, bad);
  }
  const differs = tree();
  edit(rootBaselineIn(differs), ROOT_AR2, `${ROOT_AR2}    file: "SKILL.md"\n    message: "root text"\n`);
  assertFails(differs, /matched to do not judge here and to root text in/);
});

// The skill's RA2 entry names its file, and dropping it, or widening it, would
// pass every other check: pin the entries here.
test('the incantation skill ships exactly its two entries, LP3 and RA2 with its file', () => {
  const got = entriesOf(join(root, 'skills', 'incantation', '.skillspector-baseline.yaml'));
  assert.deepEqual(
    got.map(e => [e.rule_id, e.file, e.message].filter(v => v !== undefined)),
    [
      ['LP3'],
      ['RA2', 'SKILL.md'],
    ],
  );
});
