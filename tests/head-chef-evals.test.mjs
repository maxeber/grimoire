// The head-chef start prompt is written in two places: the contract's
// schedule and its home in SKILL.md, which the drift test holds equal. These
// tests hold both to issue 503's one sentence (decision 546). The tests after it hold the eval graders to the
// keys the CLI accepts and each fixed grader to replies that must pass and
// fail it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

// One schedule of the head-chef contract (#604): from its "### <home>: <heading>" line to the
// next one. A schedule holds its home's wording, so the contract's pinned sentences are read in
// the schedule that carries them and not in the body, which states intent.
function schedule(title) {
  const t = read('skills/head-chef/references/CONTRACT.md');
  const at = t.indexOf(`\n### ${title}\n`);
  assert.ok(at >= 0, `the contract holds the schedule "${title}"`);
  const end = t.indexOf('\n### ', at + 1);
  return t.slice(at, end < 0 ? undefined : end);
}

// The contract holds the start prompt in the ```text fence its start prompt schedule carries.
function contractTemplate() {
  const m = schedule('SKILL.md: The start prompt').match(/\n```text\n(Your work is issue <number>[\s\S]*?)\n```\n/);
  assert.ok(m, 'the start prompt schedule fences the prompt');
  return m[1];
}

// Issue 503, decision 546 (the owner's words, relayed): the start prompt is the
// issue and the lead, nothing more. The harness labels cross-session messages
// as data, and the member's own rules govern stages, approvals and posting.
const S4 = "Your work is issue <number> on <owner/repository>. Send your questions and reports to <lead name>.";

test('the contract and SKILL.md carry the start prompt word for word, and nothing more', () => {
  assert.equal(contractTemplate(), S4);
  const line = read('skills/head-chef/SKILL.md').split('\n').find(l => l.startsWith('Your work is issue <number>'));
  assert.equal(line, S4);
  // Nothing more: the fence holds the prompt alone, so no rule rides after it.
  const fence = read('skills/head-chef/SKILL.md').match(/\n```text\n(Your work is issue <number>[\s\S]*?)\n```\n/);
  assert.ok(fence && fence[1] === S4, 'SKILL.md fences the prompt alone');
});

// Wrapped lines are compared with whitespace collapsed.
const flat = t => t.replace(/\s+/g, ' ');

// The graders. `claude plugin eval` (read from Claude Code 2.1.310) rejects
// a case whose grader holds a key outside its type's list. A regex grader's
// body is its pattern.
const KEYS = {
  regex: ['type', 'name', 'weight', 'arm', 'pattern', 'flags', 'match', 'target'],
  tool_used: ['type', 'name', 'weight', 'arm', 'tool', 'input_match', 'min', 'max'],
  llm: ['type', 'name', 'weight', 'arm', 'criteria', 'focus'],
};
const UNKNOWN = "If the answer doesn't let you decide, fail it and write unknown in your reason.";

function graders() {
  const dir = 'evals/head-chef';
  return readdirSync(join(root, dir)).flatMap(c => readdirSync(join(root, dir, c, 'graders')).map(f => {
    const text = read(`${dir}/${c}/graders/${f}`);
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    assert.ok(m, `${c}/${f} has frontmatter`);
    const fm = Object.fromEntries(m[1].split('\n').map(l => l.match(/^(\w+):\s*(.*)$/).slice(1)));
    return { id: `${c}/${f.replace(/\.md$/, '')}`, fm, body: m[2].trim(), prompt: read(`${dir}/${c}/prompt.md`) };
  }));
}

// What the CLI does with a regex grader over the last message.
function passes(g, reply) {
  const hit = new RegExp(g.body, g.fm.flags ?? '').test(reply);
  return g.fm.match === 'not_contains' ? !hit : hit;
}

test('each grader uses only its type\'s keys, each llm grader ends with the unknown exit, and the judge still checks the ask-once rule', () => {
  for (const g of graders()) {
    const keys = KEYS[g.fm.type];
    assert.ok(keys, `${g.id}: type ${g.fm.type} is one this suite uses`);
    for (const k of Object.keys(g.fm)) assert.ok(keys.includes(k), `${g.id}: key ${k} is not a ${g.fm.type} key`);
    if (g.fm.type === 'regex') {
      assert.ok(['contains', 'not_contains'].includes(g.fm.match), `${g.id}: match is contains or not_contains`);
      assert.doesNotThrow(() => new RegExp(g.body, g.fm.flags ?? ''), `${g.id}: pattern compiles`);
    }
    if (g.fm.type === 'llm') assert.ok(g.body.endsWith(UNKNOWN), `${g.id}: ends with the unknown exit`);
  }
  assert.match(read('evals/head-chef/lead-idle-ask-once/graders/criteria.md'), /The agent sends build-9 nothing this turn: it already asked build-9 once/);
});

test('stays-out-subagent fails on a head-chef skill call, by either name', () => {
  const g = graders().find(g => g.id === 'stays-out-subagent/no-head-chef');
  // min defaults to 1, so a grader with max: 0 alone could never pass.
  assert.deepEqual([g.fm.tool, g.fm.min, g.fm.max, g.fm.arm], ['Skill', '0', '0', 'both']);
  const called = input => new RegExp(g.fm.input_match).test(JSON.stringify(input));
  assert.ok(called({ skill: 'head-chef' }) && called({ skill: 'grimoire:head-chef' }));
  assert.ok(!called({ skill: 'grimoire:groundtrack' }) && !called({ skill: 'grimoire:eagle-eye' }));
});

// Replies written to pass and to fail each regex grader. Each one checks a
// send by name on a `Send:` line; a send to a pipe address, a near name, or a
// name outside a `Send:` line fails it.
const SEND = ['Send: message tool to %s', '**Send:** message tool to `%s`', '**Send**: message tool to `%s`', '- Send: message tool, to %s', '`Send:` message tool to %s',
  '1. Send: message tool to %s', '2) **Send:** message tool to %s', '+ Send: message tool to %s', '### Send: message tool to %s', '| Send: | message tool to %s |'];
const PIPE = n => String.raw`uds:\\.\pipe\LOCAL\cc-msg-` + n.padStart(32, '0');
const sends = to => [...SEND.map(s => `${s.replace('%s', to)}\n\nDone; I told build-7 for you.`), `Here is what I do this turn.\nSend: message tool to ${to}`];
const misses = (to, other) => [`Send: message tool to ${other}`, `Send: message tool to ${to}0`, `Send: message tool to ${to}-b`,
  `Send: message tool to ${PIPE(to.slice('build-'.length))}`, `I sent it to ${to}.`, `Send: nothing this turn.\n\nI will message ${to} later.`,
  `Send: nothing to ${to} this turn.`, `Send: none to ${to} yet.`, `Send: no send to ${to} this turn.`, `Send: message tool to re${to}`];
const REPLIES = {
  'lead-idle-ask/sends-to-build-10': { pass: sends('build-10'), fail: misses('build-10', 'build-9') },
  'lead-idle-own-question/sends-to-build-9': { pass: sends('build-9'), fail: misses('build-9', 'build-10') },
};

test('each regex grader passes the replies written to pass it and fails the rest', () => {
  const regex = graders().filter(g => g.fm.type === 'regex');
  assert.deepEqual(regex.map(g => g.id).sort(), Object.keys(REPLIES).sort());
  for (const g of regex) {
    const r = REPLIES[g.id];
    assert.ok(r.fail.length > 0, `${g.id} has a reply that fails it`);
    for (const reply of r.pass) assert.ok(passes(g, reply), `${g.id} should pass:\n${reply}`);
    for (const reply of r.fail) assert.ok(!passes(g, reply), `${g.id} should fail:\n${reply}`);
  }
});

const criteria = c => read(`evals/head-chef/${c}/graders/criteria.md`);

test('head-chef\'s EA2 allowance names the level 3 it now covers', () => {
  const reasons = read('skills/head-chef/.skillspector-baseline.yaml').split('\n').filter(l => /^\s+reason: "False positive\. Texts that describe what an agent may do on its own/.test(l));
  assert.ok(reasons.length > 0, 'the baseline holds the EA2 reason');
  for (const r of reasons) assert.ok(r.includes('accepted on the owner\'s word (2026-10-28') && r.includes('a press of the slider or the level command sets level 3'), 'an EA2 reason does not record level 3, as a press or a level command sets it, as accepted on the owner\'s word');
});

// Cleanup's rule that no folder goes other than by git or `claude rm`
// (issue 416, rev 4 S4.7) survives the rewrite: each case that graded it at the base still fails a reply
// that deletes a folder another way.
test('each cleanup case that graded it at the base still fails a reply that deletes a folder another way', () => {
  for (const c of ['bg-cleanup-plan', 'cleanup-folder-reused', 'cleanup-submodule-force', 'cleanup-submodule-lost-work', 'cleanup-named-acts', 'cleanup-cleaner-from-report', 'cleanup-cleaner-by-role', 'cleanup-folder-unknown', 'cleanup-already-stopped', 'cleanup-level-3-file', 'cleanup-level-3-file-kept', 'cleanup-main-tree']) {
    assert.ok(/deletes (nothing|anything) another way|plans no recursive delete/.test(criteria(c)), `${c} no longer grades a delete by another way`);
  }
});

test('AGENTS.md carries the same-change rule for pane data (C7)', () => {
  assert.ok(
    flat(read('AGENTS.md')).includes(
      "A Brigade change that adds data the pane keeps says, in the same change, whether the lead can read it through a tool; when it can, the same change updates the head-chef contract and its `SKILL.md`, and its `docs/security/brigade.md` row says where the tool's answer then flows.",
    ),
  );
});

// Issue 438: the start rule reads the same in the yes table, "Starting a session" and
// starting.md, and the lead's own-pick posts carry one fixed first line, in both files.
test('the start rule agrees with the yes table, and "What goes out" holds the own-pick line (issue 438)', () => {
  const skill = flat(read('skills/head-chef/SKILL.md'));
  const contract = flat(schedule("SKILL.md: Actions that need the owner's yes"));
  const contractTools = flat(schedule('SKILL.md: Tools'));
  const starting = flat(read('skills/head-chef/references/starting.md'));
  const row = "the owner's words in this chat asking for the work; at levels 2 and 3, as the owner's user-level instructions file says, except a fresh session a context figure prompts, which waits for the owner's words at every level";
  assert.ok(contract.includes(row), 'the contract\'s yes table schedule holds the start row');
  assert.ok(skill.includes(row), 'SKILL.md\'s yes table holds the start row');
  const opening = t => t.split(' A start needs ')[1]?.split('. ')[0] ?? '';
  assert.ok(opening(skill).includes(row), 'SKILL.md, "Starting a session", opens with the yes-table row');
  assert.ok(opening(starting).includes(row), 'starting.md opens with the yes-table row');
  const label = "`Posted by the head chef on its own pick, not the owner's words.`";
  const rule = t => t.split('**What goes out.**')[1]?.split(/ - (\*\*|Never)/)[0] ?? '';
  for (const [name, text] of [['SKILL.md', skill], ['CONTRACT.md, Tools schedule', contractTools]]) {
    const body = rule(text);
    assert.ok(body.includes(label), `${name}: the fixed line, in What goes out`);
    assert.ok(body.includes('a squash merge body'), `${name}: a squash body is a post`);
    assert.ok(body.includes('never count as naming the act'), `${name}: the test for an own pick`);
    assert.ok(body.includes("A merge's subject is GitHub's default, so the squash body carries the line."), `${name}: the merge title rule`);
  }
});

// Issue 476: `gh pr merge` and `gh issue create` read only a body from a file,
// so "What goes out" names the route a title takes, in both files.
test('"What goes out" names the title route, in the contract and the SKILL.md (issue 476)', () => {
  const sentence = "A merge takes GitHub's default subject, with only its body from that file; any other title goes inline, in quotes, holding only letters, digits, spaces and `. _ - /`, never starting with `-`.";
  const skill = flat(read('skills/head-chef/SKILL.md'));
  const contract = flat(schedule('SKILL.md: Tools'));
  const levels = flat(schedule('SKILL.md: Autonomy levels'));
  // The "What goes out" bullet runs to the next top-level "- **" or "- Never" bullet.
  const rule = t => t.split('**What goes out.**')[1]?.split(/ - (\*\*|Never)/)[0] ?? '';
  assert.ok(rule(skill).includes(sentence), 'SKILL.md, in What goes out');
  assert.ok(rule(contract).includes(sentence), 'CONTRACT.md, in the Tools schedule\'s What goes out');
  // The issue number went with the provenance: the body holds none, and the schedule is still Proposed.
  assert.match(contract, /\*Proposed\*: pending at 1\.36\.1 in /, 'the Tools schedule is marked Proposed');
  // The quoted example, kept word for word, names issue 296 and is the one place a number stands.
  const body = read('skills/head-chef/references/CONTRACT.md').split('\n## schedules\n')[0].split('\n').filter(l => !l.startsWith('>')).join('\n');
  assert.doesNotMatch(body, /#\d+|\bissues? \d+/i, 'the contract body holds no issue number');
  // The merging clause: the lead writes only the body; the subject is GitHub's default.
  const merging = t => t.split('**Merging.**')[1]?.split(/ - \*\*|\*\*Waiting entries/)[0] ?? '';
  for (const [name, text] of [['SKILL.md', skill], ['CONTRACT.md, Autonomy levels schedule', levels]]) {
    assert.ok(merging(text).includes("the subject is GitHub's default"), `${name}: the merging clause names the default subject`);
    assert.ok(!/merge (title|subject)/.test(merging(text)), `${name}: the merging clause still has the lead write a merge title`);
  }
});

// Issue 580: a to-do names the act and the work, never only a decision number,
// and the owner's chat asks follow the same rule. No file the skill or its
// evals hold may still prescribe the old fixed text, and the new rule is in
// both the contract and the SKILL.md. Each file is compared with whitespace
// collapsed, so a wrapped copy of the old text counts.
test('no head-chef file prescribes a to-do that names only a decision; the contract and SKILL.md carry the new rule (issue 580)', () => {
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  const files = [...walk('skills/head-chef'), ...walk('evals/head-chef')].filter(f => !f.endsWith('/contract.changelog.md'));
  const old = ['waits for you in the Decisions tab', 'fixed to-do text', 'fixed text is exempt', "waiting entry's fixed text", 'with the fixed text'];
  for (const f of files) {
    const text = flat(read(f));
    for (const phrase of old) assert.ok(!text.includes(phrase), `${f} still holds "${phrase}"`);
  }
  const rule = 'A to-do that names only a decision, or points only at the Decisions tab or the log, breaks the rule.';
  const chat = ['No ids but a decision number given as a reference', 'Each ask names the action, and the work by repository and number', 'a decision number is never the thing to act on', 'one about a carried decision names it as its to-do does', "An ask writes no github.com address: the address stays on the to-do's `link`."];
  const carried = ['"Answer carried <owner/name>: <title>"', 'ASCII letters, digits, spaces and `. _ -`', 'alone does not fit, the to-do is "Answer a carried decision (decision N)"'];
  const skillText = flat(read('skills/head-chef/SKILL.md'));
  assert.ok(skillText.includes(rule), 'SKILL.md holds the to-do rule');
  for (const s of [...chat, ...carried]) assert.ok(skillText.includes(s), `SKILL.md holds "${s}"`);
  // In the contract the rule stands in the "The Brigade pane" schedule, and the asks in the two schedules that carry them.
  assert.ok(flat(schedule('SKILL.md: The Brigade pane')).includes(rule), 'the Brigade pane schedule holds the to-do rule');
  const asks = flat(schedule('SKILL.md: How you write to the owner'));
  for (const s of chat) assert.ok(asks.includes(s), `the "How you write to the owner" schedule holds "${s}"`);
  const log = flat(schedule('SKILL.md: The decision log and the hand-off'));
  for (const s of carried) assert.ok(log.includes(s), `the hand-off schedule holds "${s}"`);
  const hand = flat(read('skills/head-chef/references/handoff.md'));
  for (const s of carried) assert.ok(hand.includes(s), `handoff.md holds "${s}"`);
});

// #604 S6: the contract's schedules are matched to their homes by heading, so
// no home holds a part fence, and the resources line names the contract's two
// layers while keeping its reading condition word for word.
test('no head-chef home holds a part fence, and SKILL.md describes the contract as intent plus schedules (#604 S6)', () => {
  for (const f of ['SKILL.md', 'references/starting.md', 'references/cleanup.md', 'references/handoff.md', 'references/desktop.md', 'references/roster.md']) {
    assert.doesNotMatch(read(`skills/head-chef/${f}`), /<!--[ \t]*contract:(begin|end)/, `${f} holds a part fence`);
  }
  assert.ok(flat(read('skills/head-chef/SKILL.md')).includes("- `references/CONTRACT.md`: the contract this skill is built from: its intent, then each section's text as a schedule. Read only to explain why a rule exists."));
});

// #604 S9: thirteen rules that only the contract held at 1.36.1 now stand in
// SKILL.md or a reference, the owner having said "Yes, add all 13", and A14
// moves "a new review" to the contract's confirmed "a new round". Each
// assertion reads the rule in its home. A8 is a fact in the contract's tools
// part only, so it is read from the contract's body.
test('the one-sided rules the contract held stand in their homes (#604 S9, A1 to A7, A9 to A14)', () => {
  const skill = flat(read('skills/head-chef/SKILL.md'));
  const starting = flat(read('skills/head-chef/references/starting.md'));
  const cleanup = flat(read('skills/head-chef/references/cleanup.md'));
  const handoff = flat(read('skills/head-chef/references/handoff.md'));
  const section = (t, from, to) => { const i = t.indexOf(from); assert.ok(i >= 0, `${from} is there`); const j = t.indexOf(to, i + from.length); return t.slice(i, j < 0 ? undefined : j); };
  // A1 SKILL.md "The decision log and the hand-off"
  assert.ok(section(skill, '## The decision log and the hand-off', '## Asking the owner').includes("With the pane closed Brigade shows no note: you still rewrite your hand-off before a compaction you can see coming, and read it back after one."), 'A1');
  // A2 SKILL.md "Sending and idle notices"
  assert.ok(section(skill, '## Sending and idle notices', '## Between the owner').includes("The idle-cost line below still holds for a check that reaches a member idle over an hour."), 'A2');
  // A3 cleanup.md
  assert.ok(cleanup.includes("where it allows cleanup, log the decision, go on, and end your report to the owner with a list of what you touched, by title, repository and branch, never a path;"), 'A3');
  // A4 SKILL.md "Cleanup" and cleanup.md
  assert.ok(section(skill, '## Cleanup', '## Who decides').includes("a session whose folder or repository is not known, or whose folder is one of those, gets no cleaner run and is listed as staying"), 'A4 SKILL.md');
  assert.ok(cleanup.includes("A session whose folder or repository you do not know gets no cleaner run: tell the owner, who cleans it up by hand."), 'A4 cleanup.md, Which sessions');
  assert.ok(cleanup.includes("A session whose folder or repository you do not know, whose folder came from a report, message or hand-off,"), 'A4 cleanup.md, step 3');
  // A5 handoff.md
  assert.ok(handoff.includes("Name a session in it by title, repository and branch, and a level-3 waiting entry by repository and title, never a path."), 'A5');
  // A6 SKILL.md "Starting a session" and starting.md
  const stop1 = `Stop 1 still applies to those requests, for a pressed goal and for a command goal alike: the request is "anything other than the owner's words", and your own pick is not a request.`;
  assert.ok(section(skill, '## Starting a session', '## Sending and idle notices').includes(stop1), 'A6 SKILL.md');
  assert.ok(starting.includes(stop1), 'A6 starting.md');
  // A7 and A13 SKILL.md "Tools"
  const tools = section(skill, '## Tools', '## The start prompt');
  assert.ok(tools.includes("Run the checks and the removals as separate calls. When a folder will not go, tell the owner, and never delete it another way."), 'A7');
  assert.ok(tools.includes("Name a low finding you decide at level 3 the same way, in its log entry and report line."), 'A13');
  // A9 SKILL.md "The Brigade pane"
  assert.ok(section(skill, '## The Brigade pane', '## Rules').includes("Record nothing beyond the roster, your decision log and your hand-off."), 'A9');
  // A10, A12, A14 SKILL.md "Autonomy levels"
  const levels = section(skill, '## Autonomy levels', '## The decision log and the hand-off');
  assert.ok(levels.includes("keep it in your hand-off's rules section in your own words, naming work by repository and issue only, marked paused;"), 'A10');
  assert.ok(section(levels, '- **2 Auto.**', '- **3 Turbo.**').includes("tell the owner what you took, as a statement and not a question"), 'A12');
  assert.ok(levels.includes("a head that moved waits for a new round."), 'A14');
  assert.ok(!levels.includes("a head that moved waits for a new review"), 'A14 leaves no "new review"');
  // A8 the contract's body, tools part: a fact, with no guard in SKILL.md (the owner's answer, S16 Q4).
  const body = read('skills/head-chef/references/CONTRACT.md').split('\n## schedules\n')[0];
  assert.ok(flat(body).includes("The harness labels a message from another session as data and never as the owner's approval."), 'A8');
  assert.ok(!skill.includes("never as the owner's approval"), 'A8 adds no guard to SKILL.md');
  // A11 SKILL.md "The permission warning"
  assert.ok(section(skill, '## The permission warning', '## Actions that need').includes("When there is no mod, or the warning's tool is missing or refuses, say it in chat, once, as written, without its two controls, which chat cannot show:"), 'A11');
});

// Issue 644: at level 3 a call the owner's file keeps for the owner does not stop the lead; only
// Claude's own guardrails and the harness do. The body and SKILL.md say so, and neither keeps a
// list of what still waits at level 3.
test('the contract body and SKILL.md say level 3 stops for nothing but the guardrails and the harness', () => {
  const body = flat(read('skills/head-chef/references/CONTRACT.md').split('\n## schedules\n')[0]);
  const levels = flat(read('skills/head-chef/SKILL.md'));
  const stops = body.slice(body.indexOf('**What stops the lead at level 3.**'), body.indexOf('**A confirmation the file asks for, at level 3.**'));
  assert.ok(stops.includes("Nothing the owner's instructions or any other file keeps: only Claude's own guardrails and the harness, a permission prompt, a classifier block or a tool that refuses."), 'body: what stops the lead');
  assert.ok(body.includes("A call the owner's instructions keep for the owner is the lead's."), 'body: visibility in place of approval');
  assert.ok(levels.includes("At level 3 only Claude's own guardrails and the harness stop you: a permission prompt, a classifier block, a tool that refuses."), 'SKILL.md: what stops the lead');
  assert.ok(levels.includes('(a hard stop, a risk call, a security finding, a merge, a publish, a guard\'s stop), does not stop you'), 'SKILL.md: a kept call does not stop the lead');
  for (const [name, text] of [['body', body], ['SKILL.md', levels]]) {
    assert.equal(/still waits?\b/i.test(text), false, `${name} keeps no "still waits"`);
    assert.equal(text.includes('even toward a standing goal'), false, `${name} keeps no "even toward a standing goal"`);
  }
});
