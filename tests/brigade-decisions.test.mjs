// The decision log's shared rules, tested at their own seam: the check of a
// log_decision call's input and of each file kind, the append with its caps
// and drop rule, the marks merge and the marks cap, the review queue, the
// history pages, the search, and the SHA-256 the project digest takes.
// brigade/decisions.ts takes plain values and no engine import, so these run
// under `node --test` in CI, where there is no Claude Code. Each test names
// the acceptance claim of spec 402 (S7) it backs, or C9 to C12 for the
// decisions taken at #430's build and its Test rounds, which the closing
// read's claims list on #430 records.
//
// The module is TypeScript; tests/brigade-view.test.mjs names the Node version
// that imports it as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const d = await import('../brigade/decisions.ts');
const {
  MAX_ENTRIES, MAX_LOG_BYTES, MAX_MARKS, MAX_MARKS_BYTES, HISTORY_PAGE,
  appendEntry, checkInput, mapInput, SHAPE_TAIL, checkLog, checkMarks, emptyLog, addMark, addMarks, mergeMarks, markKey,
  reviewQueue, flaggedRows, historyRows, matchesSearch, searchWords, serializeLog, serializeMarks,
  sha256Hex, projectDigest, sourceLabel, writerName, missingIds,
  MAX_HANDOFF_BYTES, checkHandoffInput, checkHandoff, serializeHandoff, chooseHandoff,
  levelFrom, storedLevel, levelInForce, ownerEntry, paneEntry, alarmEntry, inFixedShape, clockTime,
  drawnLogs, markAllSet, parseMarkAllKey,
  levelOption, commandEntry, parseLevelCommand, isLevelCommand, levelOriginAllowed, commandHolds, LEVEL_REPLIES,
} = d;

const SID = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-000000000000';
const NOW = 1_800_000_000_000;

const input = (over = {}) => ({
  source: 'lead', work: 'issue 411', question: 'Which tier?', options: ['Thorough', 'Standard'],
  pick: 'Thorough', why: 'It is sensitive.', undo: 'Re-propose the tier.', ...over,
});
// A log built through the append, as the tool builds it, one entry a millisecond.
const logOf = (n, over = () => ({})) => {
  let log = emptyLog(null);
  for (let i = 0; i < n; i++) {
    const r = appendEntry(log, input(over(i)), { at: NOW + i, level: 1, read: new Map() });
    assert.ok('value' in r, JSON.stringify(r));
    log = r.value.log;
  }
  return log;
};
const readAll = (log, state = 'read') => new Map(log.entries.map(e => [markKey(SID, e.id, e.at), state]));

// --- claim 2: the mod stamps id, at and level; the lead may not ---------------------

test('claim 2: an append stamps id from next, at from the clock and the level, and next only goes up', () => {
  const r = appendEntry(emptyLog(null), input(), { at: NOW, level: 1, read: new Map() });
  assert.ok('value' in r);
  const { log, entry } = r.value;
  assert.equal(entry.id, '1');
  assert.equal(entry.at, NOW);
  assert.equal(entry.level, 1);
  assert.equal(log.next, 2);
  assert.deepEqual(log.entries, [entry]);
  const again = appendEntry(log, input(), { at: NOW + 5, level: 1, read: new Map() });
  assert.equal(again.value.entry.id, '2');
  assert.equal(again.value.log.next, 3);
});

test('claim 2: an input carrying id, at or level, or a source other than lead or relayed, is refused by name', () => {
  for (const [over, rule] of [
    [{ id: '7' }, /id is stamped by the mod/],
    [{ at: 1 }, /at is stamped by the mod/],
    [{ level: 3 }, /level is stamped by the mod/],
    [{ source: 'owner' }, /source is not lead or relayed/],
    [{ source: 'pane' }, /source is not lead or relayed/],
    [{ source: 'alarm' }, /source is not lead or relayed/],
    [{ source: undefined }, /source is not lead or relayed/],
    [{ colour: 'red' }, /a field the decision log does not use: colour/],
    [{ constructor: 1 }, /a field the decision log does not use: constructor/],
  ]) {
    const r = checkInput({ ...input(), ...over });
    assert.ok('error' in r, JSON.stringify(over));
    assert.match(r.error, rule);
  }
  assert.ok('value' in checkInput(input({ source: 'relayed' })));
});

// --- claim 14: the log fields' text rules ---------------------------------------------

test('claim 14: every field refuses hidden and direction-changing characters and other controls, and keeps a line break', () => {
  const bad = ['a\u{200B}b', 'a\u{202E}b', 'a\u{2066}b', 'a\u{FE0F}b', 'a\u{E0041}b', 'a\u{AD}b', 'a\u{0}b', 'a\u{7}b', 'a\rb', 'a\u{2028}b', 'a\u{85}b'];
  for (const field of ['work', 'question', 'why', 'undo', 'revisit']) {
    for (const t of bad) {
      const r = checkInput(input({ [field]: t }));
      assert.ok('error' in r, `${field} ${JSON.stringify(t)}`);
      assert.match(r.error, new RegExp(`^${field} `));
    }
    // Twice in a row: a check that kept state between calls would pass the second.
    assert.ok('error' in checkInput(input({ [field]: 'x\u{200B}' })));
    assert.ok('error' in checkInput(input({ [field]: 'x\u{200B}' })));
    assert.ok('value' in checkInput(input({ [field]: 'line one\nline two' })), field);
  }
  for (const t of bad) {
    assert.ok('error' in checkInput(input({ options: [t, 'b'], pick: t })), JSON.stringify(t));
    // Issue 459: a lead's flag, which is one line.
    assert.match(checkInput(input({ flag: t })).error ?? '', /^flag /, JSON.stringify(t));
  }
});

// Issue 486, on the owner's word (decision 348, relayed by the lead): the
// fields keep no rule for ids, keys, emails or home paths, and refuse control
// and hidden characters only.
test('issue 486 claim 4: every log field takes an email, a home path, a key shape and a session id, and still refuses a hidden character', () => {
  const kept = ['write to someone@example.org', 'see C:\\Users\\someone\\x', `sk-ant-${'a'.repeat(24)}`, `see ${SID}`];
  for (const field of ['work', 'question', 'why', 'undo', 'revisit', 'flag']) {
    for (const t of kept) assert.ok('value' in checkInput(input({ [field]: t })), `${field} ${t}`);
    assert.match(checkInput(input({ [field]: `${kept[0]}\u{200B}` })).error ?? '', new RegExp(`^${field} holds a hidden`));
  }
  assert.ok('value' in checkInput(input({ options: [kept[2], 'b'], pick: kept[2] })));
});

test('claim 14: options must be distinct after case folding, the pick one of them, or empty for a waiting entry', () => {
  assert.match(checkInput(input({ options: ['Yes', 'yes'], pick: 'Yes' })).error, /options repeat/);
  // Full case folding, not only lower case: ß folds to ss.
  assert.match(checkInput(input({ options: ['STRASSE', 'straße'], pick: 'STRASSE' })).error ?? '', /options repeat/);
  assert.match(checkInput(input({ pick: 'Maybe' })).error, /pick is not one of the options/);
  assert.match(checkInput(input({ pick: '' })).error, /pick is not one of the options/);
  assert.match(checkInput(input({ options: [] })).error, /options/);
  assert.match(checkInput(input({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], pick: 'a' })).error, /options/);
  assert.ok('value' in checkInput(input({ waiting: true, pick: '' })));
  assert.match(checkInput(input({ waiting: true, pick: 'Thorough' })).error, /a waiting entry has no pick/);
  assert.match(checkInput(input({ waiting: true, source: 'relayed', pick: '' })).error, /waiting/);
});

test('claim 14: the lengths S5.2 sets hold', () => {
  const long = n => 'x'.repeat(n);
  assert.ok('error' in checkInput(input({ work: '' })));
  assert.ok('error' in checkInput(input({ work: long(301) })));
  assert.ok('value' in checkInput(input({ work: long(300) })));
  assert.ok('error' in checkInput(input({ question: long(1001) })));
  assert.ok('value' in checkInput(input({ why: long(1000) })));
  assert.ok('value' in checkInput(input({ revisit: '' })));
  assert.ok('error' in checkInput(input({ revisit: long(301) })));
  assert.ok('error' in checkInput(input({ undo: '' })));
});

test('claim 10: answers names a waiting entry in the same log that no entry answered, and only a relayed entry may carry it', () => {
  const asked = appendEntry(emptyLog(null), input({ waiting: true, pick: '' }), { at: NOW, level: 1, read: new Map() }).value.log;
  const answer = input({ source: 'relayed', answers: '1' });
  const ok = appendEntry(asked, answer, { at: NOW + 1, level: 1, read: new Map() });
  assert.ok('value' in ok);
  assert.match(appendEntry(ok.value.log, answer, { at: NOW + 2, level: 1, read: new Map() }).error, /answers a waiting entry already answered/);
  assert.match(appendEntry(asked, input({ source: 'relayed', answers: '9' }), { at: NOW + 1, level: 1, read: new Map() }).error, /answers no waiting entry/);
  assert.match(checkInput(input({ answers: '1' })).error, /only a relayed entry/);
  const plain = logOf(1);
  assert.match(appendEntry(plain, answer, { at: NOW + 1, level: 1, read: new Map() }).error, /answers no waiting entry/);
});

// --- claim 4: the caps and the drop rule ----------------------------------------------

test('claim 4: a full log drops read, unflagged entries oldest first, and ids are never reused', () => {
  const log = logOf(MAX_ENTRIES);
  // Every entry read but the first, which is unread.
  const read = readAll(log);
  read.delete(markKey(SID, '1', NOW));
  read.set(markKey(SID, '2', NOW + 1), 'unflagged');
  const r = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.ok('value' in r);
  const ids = r.value.log.entries.map(e => e.id);
  assert.equal(ids.length, MAX_ENTRIES);
  assert.equal(ids[0], '1');
  assert.ok(!ids.includes('2'), 'the oldest read entry dropped');
  assert.equal(ids.at(-1), String(MAX_ENTRIES + 1));
  assert.equal(r.value.log.next, MAX_ENTRIES + 2);
  // A second append after the drop takes the next id, never one counted from the entries.
  const again = appendEntry(r.value.log, input(), { at: NOW + 1000, level: 1, read: readAll(r.value.log), sid: SID });
  assert.equal(again.value.entry.id, String(MAX_ENTRIES + 2));
  // A log whose next is ahead of its entries keeps counting from next.
  const gapped = { ...logOf(2), next: 7 };
  assert.equal(appendEntry(gapped, input(), { at: NOW, level: 1, read: new Map() }).value.entry.id, '7');
});

test('claim 4: a read Relayed answer never drops while the waiting entry it answers is in the log', () => {
  let log = logOf(1, () => ({ waiting: true, pick: '' }));
  log = appendEntry(log, input({ source: 'relayed', answers: '1' }), { at: NOW + 1, level: 1, read: new Map() }).value.log;
  for (let i = 2; i < MAX_ENTRIES; i++) log = appendEntry(log, input(), { at: NOW + i, level: 1, read: new Map() }).value.log;
  // Only the answer is read: the waiting entry is unread, so nothing may drop.
  const read = new Map([[markKey(SID, '2', NOW + 1), 'read']]);
  const r = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.match(r.error ?? '', /full/);
  // Both read: the waiting entry drops first, then its answer may.
  read.set(markKey(SID, '1', NOW), 'read');
  const both = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.deepEqual(both.value.log.entries.slice(0, 1).map(e => e.id), ['2']);
});

test('claim 4: an unread, flagged or unanswered waiting entry never drops, and refuses with nothing changed when nothing can', () => {
  const log = logOf(MAX_ENTRIES, i => (i % 3 === 0 ? { waiting: true, pick: '' } : {}));
  // Every entry is read, but each is flagged or an unanswered waiting one.
  const read = new Map(log.entries.map(e => [markKey(SID, e.id, e.at), e.waiting ? 'read' : 'flagged']));
  const before = serializeLog(log).value;
  const r = appendEntry(log, input(), { at: NOW + 999, level: 1, read, sid: SID });
  assert.ok('error' in r);
  assert.match(r.error, /the decision log is full/);
  assert.equal(serializeLog(log).value, before);
  // With no read mark at all, nothing drops either.
  assert.ok('error' in appendEntry(log, input(), { at: NOW + 999, level: 1, read: new Map(), sid: SID }));
});

test('claim 4: a read waiting entry drops only once a later entry answers it', () => {
  let log = logOf(MAX_ENTRIES - 1, i => (i === 0 ? { waiting: true, pick: '' } : {}));
  const keepAllButFirst = new Map(log.entries.map(e => [markKey(SID, e.id, e.at), e.id === '1' ? 'read' : 'flagged']));
  log = appendEntry(log, input(), { at: NOW + 900, level: 1, read: new Map() }).value.log;
  keepAllButFirst.set(markKey(SID, String(MAX_ENTRIES), NOW + 900), 'flagged');
  assert.ok('error' in appendEntry(log, input(), { at: NOW + 901, level: 1, read: keepAllButFirst, sid: SID }), 'unanswered: kept');
  // The answer itself is the append: the waiting entry it answers is read, and drops for it.
  const r = appendEntry(log, input({ source: 'relayed', answers: '1' }), { at: NOW + 902, level: 1, read: keepAllButFirst, sid: SID });
  assert.ok('value' in r, JSON.stringify(r.error));
  assert.ok(!r.value.log.entries.some(e => e.id === '1'));
  // The log the drop leaves, an answer whose waiting entry is gone, still passes its own strict check.
  assert.ok('value' in checkLog(serializeLog(r.value.log).value));
});

test('claim 4: Owner, Pane and alarm entries never drop, even as the oldest and read', () => {
  let log = emptyLog(null);
  for (const source of ['owner', 'pane', 'alarm']) log = appendEntry(log, { ...input(), source }, { at: NOW, level: 1, read: new Map(), fixed: true }).value.log;
  for (let i = 0; i < MAX_ENTRIES - 3; i++) log = appendEntry(log, input(), { at: NOW + 1 + i, level: 1, read: new Map() }).value.log;
  const r = appendEntry(log, input(), { at: NOW + 9999, level: 1, read: readAll(log), sid: SID });
  assert.ok('value' in r);
  assert.deepEqual(r.value.log.entries.slice(0, 3).map(e => e.source), ['owner', 'pane', 'alarm']);
  assert.equal(r.value.log.entries[3].id, '5');
});

test('claim 4: Owner, Pane and alarm entries never drop, are written past the entry cap, and never past the byte cap', () => {
  let log = logOf(MAX_ENTRIES);
  for (const source of ['owner', 'pane', 'alarm']) {
    const r = appendEntry(log, { ...input(), source }, { at: NOW + 1000, level: 1, read: new Map(), sid: SID, fixed: true });
    assert.ok('value' in r, source);
    log = r.value.log;
  }
  assert.equal(log.entries.length, MAX_ENTRIES + 3);
  // All read: a lead append drops lead entries only, never the three.
  const r = appendEntry(log, input(), { at: NOW + 2000, level: 1, read: readAll(log), sid: SID });
  assert.ok('value' in r);
  assert.deepEqual(r.value.log.entries.filter(e => ['owner', 'pane', 'alarm'].includes(e.source)).length, 3);
  // A fixed append that would pass the byte cap is refused.
  const wide = '\u{1F600}'.repeat(250);
  let big = emptyLog(null);
  let refused;
  for (let i = 0; i < 2000 && refused === undefined; i++) {
    const a = appendEntry(big, { ...input({ why: wide, question: wide }), source: 'owner' }, { at: NOW + i, level: 1, read: new Map(), sid: SID, fixed: true });
    if ('error' in a) refused = a.error;
    else big = a.value.log;
  }
  assert.match(refused ?? '', /the decision log is full/);
  assert.ok(new TextEncoder().encode(serializeLog(big).value).length <= MAX_LOG_BYTES);
});

test('claim 4 (#497): past the byte cap, a fixed append drops read lead entries, never an Owner, Pane, alarm or unread one', () => {
  const wide = '\u{1F600}'.repeat(900);
  let log = emptyLog(null);
  log = appendEntry(log, { ...input(), source: 'pane' }, { at: NOW, level: 1, read: new Map(), fixed: true }).value.log;
  for (let i = 1; ; i++) {
    const a = appendEntry(log, input({ why: wide, question: wide }), { at: NOW + i, level: 1, read: new Map(), sid: SID });
    if ('error' in a) break;
    log = a.value.log;
  }
  const owner = { ...input({ why: wide, question: wide }), source: 'owner' };
  // Nothing read: refused, as before.
  assert.match(appendEntry(log, owner, { at: NOW + 99999, level: 1, read: new Map(), sid: SID, fixed: true }).error ?? '', /the decision log is full/);
  // All read: the Pane entry stays, and the oldest lead entry drops.
  const r = appendEntry(log, owner, { at: NOW + 99999, level: 1, read: readAll(log), sid: SID, fixed: true });
  assert.ok('value' in r, JSON.stringify(r.error));
  assert.equal(r.value.log.entries[0].source, 'pane');
  assert.equal(r.value.log.entries[1].id, '3');
  assert.equal(r.value.log.entries.at(-1).source, 'owner');
  assert.ok(new TextEncoder().encode(serializeLog(r.value.log).value).length <= MAX_LOG_BYTES);
});

test('claim 4: past the byte cap, read entries drop until the log fits', () => {
  const wide = '\u{1F600}'.repeat(900);
  let log = emptyLog(null);
  let first;
  for (let i = 0; ; i++) {
    const a = appendEntry(log, input({ why: wide, question: wide }), { at: NOW + i, level: 1, read: new Map(), sid: SID });
    if ('error' in a) {
      first = i;
      break;
    }
    log = a.value.log;
  }
  assert.ok(first < MAX_ENTRIES);
  const r = appendEntry(log, input({ why: wide, question: wide }), { at: NOW + 99999, level: 1, read: readAll(log), sid: SID });
  assert.ok('value' in r);
  assert.equal(r.value.log.entries[0].id, '2');
  assert.ok(new TextEncoder().encode(serializeLog(r.value.log).value).length <= MAX_LOG_BYTES);
});

// --- claim 5's strict checks ----------------------------------------------------------

test('claim 5: the strict log check takes only a log of its own kind', () => {
  const good = serializeLog(logOf(3)).value;
  assert.ok('value' in checkLog(good));
  for (const raw of [
    '{}', '[]', 'not json', '{"cards":[],"todos":[]}',
    JSON.stringify({ ...JSON.parse(good), kind: 'marks' }),
    JSON.stringify({ ...JSON.parse(good), v: 2 }),
    JSON.stringify({ ...JSON.parse(good), extra: 1 }),
    JSON.stringify({ ...JSON.parse(good), next: 2 }),
    JSON.stringify({ ...JSON.parse(good), project: 'not-a-digest' }),
    JSON.stringify({ ...JSON.parse(good), entries: [...JSON.parse(good).entries, JSON.parse(good).entries[0]] }),
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], level: 4 }] }),
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], why: 'a\u{200B}b' }] }),
    // An answer naming a later entry, an entry that does not wait, or one already answered.
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], source: 'relayed', answers: '2' }, JSON.parse(good).entries[1]] }),
    JSON.stringify({ ...JSON.parse(good), entries: [JSON.parse(good).entries[0], { ...JSON.parse(good).entries[1], source: 'relayed', answers: '1' }] }),
    JSON.stringify({ ...JSON.parse(good), entries: [{ ...JSON.parse(good).entries[0], waiting: true, pick: '' }, { ...JSON.parse(good).entries[1], source: 'relayed', answers: '1' }, { ...JSON.parse(good).entries[2], source: 'relayed', answers: '1' }] }),
  ]) {
    assert.ok('error' in checkLog(raw), raw.slice(0, 80));
  }
});

test('claim 5: the strict marks check takes only a marks file', () => {
  const mark = { log: SID, id: '1', entryAt: NOW, state: 'read', at: NOW };
  assert.ok('value' in checkMarks(JSON.stringify({ kind: 'marks', v: 1, marks: [mark] })));
  for (const raw of [
    '{}', serializeLog(logOf(1)).value,
    JSON.stringify({ kind: 'marks', v: 1, marks: [{ ...mark, state: 'gone' }] }),
    JSON.stringify({ kind: 'marks', v: 1, marks: [{ ...mark, log: 'x' }] }),
    JSON.stringify({ kind: 'marks', v: 1, marks: [{ ...mark, extra: 1 }] }),
    JSON.stringify({ kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS + 1 }, (_, i) => ({ ...mark, at: i })) }),
  ]) {
    assert.ok('error' in checkMarks(raw), raw.slice(0, 80));
  }
});

// --- claim 7: marks ---------------------------------------------------------------------

test('claim 7: the latest mark by time wins across marks files, a mark over two minutes ahead is ignored, and a mark never applies to another at', () => {
  const m = (state, at, entryAt = NOW) => ({ log: SID, id: '1', entryAt, state, at });
  const states = mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW + 10)] }, { kind: 'marks', v: 1, marks: [m('unflagged', NOW + 20)] }], NOW + 30);
  assert.equal(states.get(markKey(SID, '1', NOW)), 'unflagged');
  // In the other order of files too: the time decides, never the order read.
  const reversed = mergeMarks([{ kind: 'marks', v: 1, marks: [m('unflagged', NOW + 20)] }, { kind: 'marks', v: 1, marks: [m('read', NOW + 10)] }], NOW + 30);
  assert.equal(reversed.get(markKey(SID, '1', NOW)), 'unflagged');
  const ahead = mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW + 120_001)] }], NOW);
  assert.equal(ahead.get(markKey(SID, '1', NOW)), undefined);
  assert.equal(mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW + 120_000)] }], NOW).get(markKey(SID, '1', NOW)), 'read');
  const other = mergeMarks([{ kind: 'marks', v: 1, marks: [m('read', NOW, NOW - 1)] }], NOW);
  assert.equal(other.get(markKey(SID, '1', NOW)), undefined);
});

test('claim 7: a marks file past its cap drops marks for entries in no log read first, then the oldest', () => {
  const known = new Set([markKey(SID, '1', NOW)]);
  const mark = i => ({ log: i === 0 ? SID : OTHER, id: String(i + 1), entryAt: NOW, state: 'read', at: NOW + i });
  // The known entry's mark is the oldest; the count cap bites at 2,000 marks.
  let file = { kind: 'marks', v: 1, marks: [] };
  for (let i = 0; i < MAX_MARKS + 50; i++) file = addMark(file, mark(i), known);
  const kept = file.marks.length;
  assert.equal(kept, MAX_MARKS);
  assert.ok(file.marks.some(x => x.log === SID && x.id === '1'), "the known entry's mark is kept while unknown ones remain");
  assert.ok(!file.marks.some(x => x.log === OTHER && x.id === '2'), 'the oldest unknown mark dropped');
  assert.ok(new TextEncoder().encode(serializeMarks(file).value).length <= MAX_MARKS_BYTES);
  // With every mark known, the oldest drops.
  const all = new Set(file.marks.map(x => markKey(x.log, x.id, x.entryAt)));
  const next = addMark(file, mark(MAX_MARKS + 5), all);
  assert.equal(next.marks.length, kept);
  assert.ok(!next.marks.some(x => x.log === SID && x.id === '1'));
  assert.equal(next.marks.at(-1).at, NOW + MAX_MARKS + 5);
  // The count cap holds on its own too.
  assert.ok('error' in serializeMarks({ kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS + 1 }, (_, i) => ({ ...mark(1), at: i })) }));
});

// --- claim 6: the review queue -----------------------------------------------------------

const logs = () => {
  const a = logOf(3);
  const b = logOf(2, () => ({}));
  b.entries = b.entries.map((e, i) => ({ ...e, at: NOW - 10 + i }));
  return [
    { sid: SID, writer: 'lead-a', log: a },
    { sid: OTHER, writer: 'an ended session', log: b },
  ];
};

test('claim 6: reviewQueue puts the oldest unread entry of the logs it is given first, with n of N; Owner and Pane never show there', () => {
  const ls = logs();
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '9', at: NOW - 100, source: 'owner' }, { ...ls[0].log.entries[0], id: '10', at: NOW - 99, source: 'pane' });
  const q = reviewQueue(ls, new Map(), new Set(), []);
  assert.equal(q.total, 5);
  assert.equal(q.head.sid, OTHER);
  assert.equal(q.head.entry.at, NOW - 10);
  assert.equal(q.n, 1);
  const states = new Map([[markKey(OTHER, '1', NOW - 10), 'read']]);
  const q2 = reviewQueue(ls, states, new Set(), []);
  assert.equal(q2.total, 4);
  assert.equal(q2.head.entry.at, NOW - 9);
});

test('claim 6: Skip shows the next unread without marking, and wraps once every unread was skipped', () => {
  const ls = logs();
  const skipped = new Set([markKey(OTHER, '1', NOW - 10)]);
  const q = reviewQueue(ls, new Map(), skipped, []);
  assert.equal(q.n, 2);
  assert.equal(q.total, 5);
  assert.equal(q.head.entry.at, NOW - 9);
  const all = new Set(reviewQueue(ls, new Map(), new Set(), []).order.map(o => markKey(o.sid, o.entry.id, o.entry.at)));
  assert.equal(reviewQueue(ls, new Map(), all, []).n, 1);
});

test('claim 6: the writer is the session name for that id, or an ended session', () => {
  assert.equal(writerName([{ name: 'lead-a', status: 'idle', sessionId: SID }], SID), 'lead-a');
  assert.equal(writerName([{ name: 'lead-a', status: 'idle', sessionId: SID }], OTHER), 'an ended session');
  assert.equal(writerName([{ name: 'x\u{202E}y', status: 'idle', sessionId: SID }], SID), 'xy');
});

test('claim 10: Lead, Relayed by the writer, and a waiting entry draw as their sources say', () => {
  const e = logOf(1).entries[0];
  assert.equal(sourceLabel({ ...e, source: 'lead' }, 'lead-a'), 'Lead');
  assert.equal(sourceLabel({ ...e, source: 'relayed' }, 'lead-a'), 'Relayed by lead-a');
  assert.equal(sourceLabel({ ...e, source: 'relayed' }, 'an ended session'), 'Relayed by an ended session');
});

// --- the autonomy level (ticket 4) ------------------------------------------------

test('claim 11: a stored level other than the number 1, 2 or 3 reads as 1, and only this session\'s own counts', () => {
  for (const [v, want] of [[1, 1], [2, 2], [3, 3], [0, 1], [4, 1], ['3', 1], [2.5, 1], [null, 1], [undefined, 1], [[3], 1], [{ level: 3 }, 1]]) {
    assert.equal(levelFrom(v), want, String(v));
    assert.equal(storedLevel([{ session: SID, level: v }], SID), want, String(v));
  }
  assert.equal(storedLevel([{ session: OTHER, level: 3 }], SID), 1);
  for (const planted of [undefined, null, 'x', {}, { [SID]: 3 }, [null], [{ session: SID }]]) assert.equal(storedLevel(planted, SID), 1);
});

test('issue 504: the level in force is the last level set, 1 while a Pane entry waits or for a 3 with no press time; the stored copy is never compared', () => {
  assert.equal(levelInForce({ pressed: 2, pressAt: undefined, waiting: false }), 2);
  assert.equal(levelInForce({ pressed: 3, pressAt: NOW, waiting: false }), 3);
  assert.equal(levelInForce({ pressed: 3, pressAt: undefined, waiting: false }), 1);
  assert.equal(levelInForce({ pressed: 2, pressAt: undefined, waiting: true }), 1);
  assert.equal(levelInForce({ pressed: 1, pressAt: undefined, waiting: false }), 1);
});

test('claim 10: the Owner, Pane and alarm entries are built in one fixed shape each, pass the log\'s check, and draw as their sources', () => {
  let log = emptyLog(null);
  for (const raw of [ownerEntry(3), paneEntry('shown'), paneEntry('reload'), alarmEntry(2)]) {
    const r = appendEntry(log, raw, { at: NOW, level: 1, read: new Map(), fixed: true });
    assert.ok('value' in r, JSON.stringify(r));
    log = r.value.log;
  }
  assert.ok('value' in checkLog(JSON.stringify(log)));
  const [owner, shown, reload, alarm] = log.entries;
  assert.deepEqual([owner.question, owner.options, owner.pick, owner.why], ['Autonomy level', ['1 Manual', '2 Auto', '3 Turbo'], '3 Turbo', 'Moved in the pane']);
  assert.deepEqual([shown.pick, shown.why, reload.why], ['1 Manual', 'The pane was shown again', 'The Brigade mod was reloaded']);
  assert.deepEqual([alarm.pick, alarm.why], ['2 Auto', 'Changed, not from a press']);
  for (const e of log.entries) assert.equal(inFixedShape(e), true, e.source);
  assert.equal(sourceLabel(owner, 'lead-a', true), 'Owner');
  assert.equal(sourceLabel(owner, 'lead-a', false), 'Owner (as recorded)');
  assert.equal(sourceLabel(owner, 'lead-a'), 'Owner (as recorded)');
  assert.equal(sourceLabel(shown, 'lead-a'), 'Pane');
  assert.equal(sourceLabel(alarm, 'lead-a'), 'Not from a press');
  // The tool's own entries are never held to these shapes.
  assert.equal(inFixedShape(logOf(1).entries[0]), true);
});

test("C12, Test round 1's q3g: a clock time is kept only as a whole number of milliseconds inside the Date range", () => {
  for (const ok of [0, 1, NOW, 8.64e15, -8.64e15]) assert.equal(clockTime(ok), true, String(ok));
  for (const bad of [8.64e15 + 1, -8.64e15 - 1, Number.MAX_SAFE_INTEGER, 1.5, NaN, Infinity, '5', undefined, null]) assert.equal(clockTime(bad), false, String(bad));
});

test("claim 25: a compaction's Pane entry has its own fixed shape, and each of the three whys reads only as itself", () => {
  const base = (raw) => {
    const r = appendEntry(emptyLog(null), raw, { at: NOW, level: 1, read: new Map(), fixed: true });
    assert.ok('value' in r);
    return r.value.log.entries[0];
  };
  const compacted = base(paneEntry('compact'));
  assert.deepEqual([compacted.source, compacted.pick, compacted.why, compacted.undo], ['pane', '1 Manual', "The lead's context was compacted", 'Move the slider in the pane']);
  assert.ok('value' in checkLog(JSON.stringify({ ...emptyLog(null), next: 2, entries: [compacted] })));
  for (const why of ['The pane was shown again', 'The Brigade mod was reloaded', "The lead's context was compacted"]) {
    assert.equal(inFixedShape({ ...compacted, why }), true, why);
  }
  // Any other why is out of shape, the near misses included.
  for (const why of ['The lead was compacted', "The lead's context was compacted.", 'Moved in the pane', '']) {
    assert.equal(inFixedShape({ ...compacted, why }), false, why);
  }
});

test('claim 10: an Owner, Pane or alarm entry that differs from its fixed shape in any field is out of shape', () => {
  const base = (raw) => {
    const r = appendEntry(emptyLog(null), raw, { at: NOW, level: 1, read: new Map(), fixed: true });
    assert.ok('value' in r);
    return r.value.log.entries[0];
  };
  const owner = base(ownerEntry(2));
  const pane = base(paneEntry('shown'));
  const alarm = base(alarmEntry(3));
  const bent = [
    [owner, { work: 'issue 1' }], [owner, { question: 'Which level?' }], [owner, { options: ['1 Manual', '2 Auto'] }],
    [owner, { options: ['2 Auto', '1 Manual', '3 Turbo'] }], [owner, { pick: 'Yes', options: ['Yes', 'No'] }],
    [owner, { why: 'The lead moved it' }], [owner, { undo: 'Nothing' }], [owner, { revisit: 'Tomorrow' }], [owner, { waiting: true, pick: '' }],
    [pane, { pick: '3 Turbo' }], [pane, { why: 'Moved in the pane' }], [pane, { undo: 'Move the slider back' }],
    [alarm, { why: 'Moved in the pane' }], [alarm, { undo: 'Move the slider back' }],
    [pane, { level: 2 }], [alarm, { level: 3 }],
  ];
  for (const [e, over] of bent) assert.equal(inFixedShape({ ...e, ...over }), false, `${e.source} ${JSON.stringify(over)}`);
});

// --- claim 9: Flagged to revisit and Dismiss ------------------------------------------------

test('claim 9: Flagged holds the entries whose latest mark is flagged, oldest first across the logs, and the search filters it', () => {
  const ls = logs();
  ls[0].log.entries[2].work = 'needle';
  const m = (sid, id, at, state, when) => ({ log: sid, id, entryAt: at, state, at: when });
  const states = mergeMarks([
    { kind: 'marks', v: 1, marks: [m(SID, '3', NOW + 2, 'flagged', NOW + 5), m(OTHER, '2', NOW - 9, 'flagged', NOW + 5), m(SID, '1', NOW, 'flagged', NOW + 5)] },
    // Unflagged later, in another file: no longer flagged.
    { kind: 'marks', v: 1, marks: [m(SID, '1', NOW, 'unflagged', NOW + 6), m(SID, '2', NOW + 1, 'read', NOW + 6)] },
  ], NOW + 10);
  const rows = flaggedRows(ls, states, []);
  assert.deepEqual(rows.map(r => [r.sid, r.entry.id]), [[OTHER, '2'], [SID, '3']]);
  assert.deepEqual(flaggedRows(ls, states, searchWords('NEEDLE')).map(r => [r.sid, r.entry.id]), [[SID, '3']]);
  assert.deepEqual(flaggedRows(ls, new Map(), []), []);
});

test('claim 9: Dismiss adds every picked mark in one file; past the cap old marks drop, never a new one, and the file given is unchanged', () => {
  const mark = i => ({ log: OTHER, id: String(i + 1), entryAt: NOW, state: 'read', at: NOW + i });
  let file = { kind: 'marks', v: 1, marks: [] };
  for (let i = 0; i < MAX_MARKS; i++) file = addMark(file, mark(i), new Set());
  const before = JSON.stringify(file);
  const oldest = file.marks[0].at;
  const picked = [0, 1, 2].map(i => ({ log: SID, id: String(i + 1), entryAt: NOW, state: 'unflagged', at: NOW + 9000 }));
  // Every old mark is for an entry the pane read, so the new marks are the only
  // unknown ones: a cap rule that let a new mark drop would take one first.
  const known = new Set(file.marks.map(x => markKey(x.log, x.id, x.entryAt)));
  const next = addMarks(file, picked, known);
  assert.equal(JSON.stringify(file), before);
  assert.deepEqual(next.marks.slice(-3), picked);
  assert.ok(!next.marks.slice(0, -3).some(x => x.log === SID), 'no new mark dropped');
  assert.ok(!next.marks.some(x => x.at === oldest), 'the oldest old mark dropped');
  const old = next.marks.slice(0, -3);
  assert.deepEqual(old, file.marks.slice(file.marks.length - old.length), 'the old marks kept are the newest, in order');
  assert.ok('value' in serializeMarks(next));
});

// --- claim 8: search ------------------------------------------------------------------------

test('claim 8: the search keeps an entry only when every word typed appears in it, in any case', () => {
  const e = { ...logOf(1).entries[0], work: 'PR 391', why: 'The owner prefers one check' };
  assert.deepEqual(searchWords('  Owner   391 '), ['owner', '391']);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('owner 391')), true);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('owner 392')), false);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('LEAD-A thorough')), true);
  assert.equal(matchesSearch(e, 'lead-a', searchWords('1')), true, 'the id');
  assert.equal(matchesSearch(e, 'lead-a', []), true);
  const ls = logs();
  ls[1].log.entries[0].work = 'needle';
  assert.equal(reviewQueue(ls, new Map(), new Set(), searchWords('needle')).total, 1);
  assert.equal(historyRows(ls, searchWords('needle'), 1).rows.length, 1);
});

// --- claim 19: history ------------------------------------------------------------------------

test('claim 19: History holds every entry newest first, at most 50 a page until Show more', () => {
  const ls = [{ sid: SID, writer: 'lead-a', log: logOf(120) }];
  const one = historyRows(ls, [], 1);
  assert.equal(one.rows.length, HISTORY_PAGE);
  assert.equal(one.total, 120);
  assert.equal(one.more, true);
  assert.equal(one.rows[0].entry.id, '120');
  assert.equal(historyRows(ls, [], 2).rows.length, 100);
  assert.equal(historyRows(ls, [], 3).more, false);
});

// --- the dim line ------------------------------------------------------------------------------

test('the dim line counts the ids missing below next that the cap rule does not explain', () => {
  const log = logOf(5);
  assert.equal(missingIds(log), 0);
  assert.equal(missingIds({ ...log, entries: log.entries.filter(e => e.id !== '3') }), 1);
  const full = logOf(MAX_ENTRIES);
  const r = appendEntry(full, input(), { at: NOW + 999, level: 1, read: readAll(full), sid: SID });
  assert.equal(missingIds(r.value.log), 0);
});

// --- the SHA-256 the project digest takes (S5.1, tested as S6 says) ----------------------------

test('the SHA-256 matches the NIST vectors and Node at the block boundaries, astral text and a hand-off-sized input', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  const node = t => createHash('sha256').update(t, 'utf8').digest('hex');
  for (const n of [0, 55, 56, 63, 64, 65, 119, 120, 32 * 1024]) assert.equal(sha256Hex('a'.repeat(n)), node('a'.repeat(n)), String(n));
  for (const t of ['é', '日本語', '\u{1F600}\u{1F680}', 'C--src-grimoire']) assert.equal(sha256Hex(t), node(t), t);
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let i = 0; i < 50; i++) {
    const t = Array.from({ length: rand() % 300 }, () => String.fromCodePoint(rand() % 0xd7ff)).join('');
    assert.equal(sha256Hex(t), node(t));
  }
});

test('the project digest is the SHA-256 of the transcript folder name, only for the current session, else null', () => {
  const start = { sessionId: SID, transcript: `C:\\cfg\\.claude\\projects\\C--work\\${SID}.jsonl` };
  assert.equal(projectDigest(start, SID), createHash('sha256').update('C--work').digest('hex'));
  assert.equal(projectDigest(start, OTHER), null);
  assert.equal(projectDigest({ sessionId: SID, transcript: 'C:\\nowhere.jsonl' }, SID), null);
  assert.equal(projectDigest({ sessionId: '', transcript: '' }, SID), null);
});

// --- the lead hand-off (ticket 3: claims 12 and 14) --------------------------------------------

const sections = (over = {}) => ({ resume: ['Read issue 413.'], rules: [], sessions: ['build-413 builds.'], cleanup: [], owner: ['q1 waits.'], ...over });
const DIGEST = createHash('sha256').update('C--work').digest('hex');
const OTHER_DIGEST = createHash('sha256').update('C--elsewhere').digest('hex');
const handoff = (at, project = DIGEST, over = {}) => ({ kind: 'handoff', v: 1, at, project, sections: sections(over) });

test('claim 14: every hand-off line refuses hidden and direction-changing characters and a line break', () => {
  assert.deepEqual(checkHandoffInput(sections()).value, sections());
  for (const line of [
    'a\u{202E}b', 'a\u{200F}b', 'a\u{2066}b', 'zero\u{200B}width',
    'two\nlines', 'a\u{7}bell', '', 'x'.repeat(301),
  ]) {
    const r = checkHandoffInput(sections({ rules: ['fine', line] }));
    assert.ok('error' in r, JSON.stringify(line));
    assert.match(r.error, /^rules line 2 /);
  }
  assert.ok('value' in checkHandoffInput(sections({ rules: ['x'.repeat(300)] })));
});

// Issue 486: a hand-off line takes the same text a log field takes.
test('issue 486 claim 4: every hand-off line takes an email, a home path, a key shape and a session id, and still refuses a hidden character', () => {
  for (const section of ['resume', 'rules', 'sessions', 'cleanup', 'owner']) {
    for (const line of ['write to someone@example.org', 'in /home/someone/repo', `sk-ant-${'a'.repeat(24)}`, `see ${SID}`]) {
      assert.ok('value' in checkHandoffInput(sections({ [section]: ['fine', line] })), `${section} ${line}`);
    }
    assert.match(checkHandoffInput(sections({ [section]: ['fine', 'x\u{2066}y'] })).error ?? '', new RegExp(`^${section} line 2 holds a hidden`));
  }
});

test('S5.3: a hand-off input takes exactly the five sections, each a list of at most 20 lines, and nothing the mod stamps', () => {
  assert.ok('value' in checkHandoffInput(sections({ resume: Array.from({ length: 20 }, (_, i) => `Line ${i}`) })));
  assert.match(checkHandoffInput(sections({ resume: Array.from({ length: 21 }, (_, i) => `Line ${i}`) })).error, /^resume is not a list of at most 20 lines$/);
  const { owner, ...four } = sections();
  assert.match(checkHandoffInput(four).error, /^owner is not a list of at most 20 lines$/);
  assert.match(checkHandoffInput({ ...sections(), at: 5 }).error, /^the hand-off has a field it does not use: at$/);
  assert.match(checkHandoffInput({ ...sections(), project: DIGEST }).error, /^the hand-off has a field it does not use: project$/);
  assert.match(checkHandoffInput(sections({ cleanup: 'one line' })).error, /^cleanup is not a list/);
  assert.match(checkHandoffInput(null).error, /^the hand-off is not an object$/);
});

test('claim 5: a hand-off file passes its strict check only in its own shape', () => {
  const good = serializeHandoff(handoff(5));
  assert.deepEqual(checkHandoff(good.value).value, handoff(5));
  assert.ok('value' in checkHandoff(JSON.stringify(handoff(5, null))));
  for (const bad of [
    { ...handoff(5), extra: 1 },
    { ...handoff(5), kind: 'decisions' },
    { ...handoff(5), v: 2 },
    { ...handoff(5), at: -1 },
    { ...handoff(5), project: 'C--work' },
    { ...handoff(5), sections: { ...sections(), more: [] } },
    { ...handoff(5), sections: sections({ owner: ['a\u{200B}b'] }) },
  ]) assert.ok('error' in checkHandoff(JSON.stringify(bad)), JSON.stringify(bad).slice(0, 80));
  assert.ok('error' in checkHandoff('{"cards":[],"todos":[]}'));
  assert.ok('error' in checkHandoff('not json'));
});

test('a hand-off over 32 KiB is refused', () => {
  // Twenty lines of 300 four-byte characters in each section: about 120 KiB.
  const wide = Array.from({ length: 20 }, () => '\u{1F600}'.repeat(300));
  const big = handoff(5, DIGEST, { resume: wide, rules: wide, sessions: wide, cleanup: wide, owner: wide });
  assert.ok('value' in checkHandoffInput(big.sections));
  assert.match(serializeHandoff(big).error, /^the hand-off is over 32 KiB$/);
  assert.equal(MAX_HANDOFF_BYTES, 32 * 1024);
});

test('claim 12: the hand-off chosen is this session\'s own, else the newest by stamped time with the same project digest', () => {
  const own = { sid: SID, handoff: handoff(100) };
  const older = { sid: '22222222-2222-2222-2222-222222222222', handoff: handoff(200) };
  const newer = { sid: '33333333-3333-3333-3333-333333333333', handoff: handoff(300) };
  const elsewhere = { sid: '44444444-4444-4444-4444-444444444444', handoff: handoff(900, OTHER_DIGEST) };
  const ahead = { sid: '55555555-5555-5555-5555-555555555555', handoff: handoff(NOW + 120_001) };
  const undated = { sid: '66666666-6666-6666-6666-666666666666', handoff: handoff(950, null) };
  const others = [older, elsewhere, ahead, newer, undated];
  // The own hand-off wins, however old.
  assert.equal(chooseHandoff(own, others, DIGEST, NOW), own);
  // Without one: the newest by its own time among the same digest, never
  // another digest's, a null one or one dated more than two minutes ahead.
  assert.equal(chooseHandoff(undefined, others, DIGEST, NOW), newer);
  assert.equal(chooseHandoff(undefined, [elsewhere, ahead, undated], DIGEST, NOW), undefined);
  // An own hand-off dated ahead is never chosen either.
  assert.equal(chooseHandoff({ sid: SID, handoff: handoff(NOW + 120_001) }, others, DIGEST, NOW), newer);
  assert.equal(chooseHandoff({ sid: SID, handoff: handoff(NOW + 120_000) }, others, DIGEST, NOW)?.sid, SID);
  // A session with no digest finds no other's.
  assert.equal(chooseHandoff(undefined, others, null, NOW), undefined);
  assert.equal(chooseHandoff(own, others, null, NOW), own);
});

// --- spec 444: one lead's log, Mark all as read, the marks cap order ------------

const mk = (sid, id, at, state, when) => ({ log: sid, id, entryAt: at, state, at: when });
// This session's log (3 plain leads) and another's: two waiting entries (one answered), the answer, a plain lead, a relayed, an alarm and an Owner entry.
const tabLogsFor = () => {
  const own = { sid: SID, writer: 'lead-a', log: logOf(3) };
  let ol = emptyLog(null);
  const add = (raw, at, fixed) => {
    const r = appendEntry(ol, raw, { at, level: 1, read: new Map(), fixed });
    assert.ok('value' in r, JSON.stringify(r));
    ol = r.value.log;
  };
  add(input({ waiting: true, pick: '', work: 'waits' }), NOW - 90);
  add(input({ waiting: true, pick: '', work: 'answered' }), NOW - 89);
  add(input({ source: 'relayed', answers: '2', work: 'the answer' }), NOW - 88);
  add(input({ work: 'plain' }), NOW - 87);
  add(input({ source: 'relayed', work: 'relayed plain' }), NOW - 86);
  add(alarmEntry(3), NOW - 85, true);
  add(ownerEntry(2), NOW - 84, true);
  return [own, { sid: OTHER, writer: 'an ended session', log: ol }];
};
const keyOf = (sid, e) => markKey(sid, e.id, e.at);

// Issue 509 (ADR 0017, S5.2): the tab draws this session's log and nothing from another.
test("issue 509 C5: the tab draws this session's log alone: no entry of another log, of any kind, flag or answer, is drawn or counted, whatever its marks say", () => {
  const ls = tabLogsFor();
  const other = ls[1].log.entries;
  // The other log holds a waiting entry (answered and not), a Relayed entry, a fixed-shape alarm, a plain Lead entry and an Owner entry.
  assert.deepEqual(other.map(e => e.source), ['lead', 'lead', 'relayed', 'lead', 'relayed', 'alarm', 'owner']);
  assert.deepEqual(drawnLogs(ls, SID).map(l => l.sid), [SID]);
  assert.deepEqual(drawnLogs(ls, SID)[0].log.entries.length, 3);
  assert.deepEqual(drawnLogs([ls[1]], SID), [], 'with no log of its own, nothing is drawn');
});

test('spec 444 claim 8: the Mark all as read key matches whole, from 1 to 500', () => {
  const h = 'abcdef0123456789';
  assert.deepEqual(parseMarkAllKey(`dmarkall-3-${h}`), { n: 3, hash: h });
  assert.deepEqual(parseMarkAllKey(`dmarkall-500-${h}`), { n: 500, hash: h });
  for (const bad of [`dmarkall-0-${h}`, `dmarkall-501-${h}`, `dmarkall-03-${h}`, `dmarkall-1000-${h}`, `dmarkall-3-${h}x`, ` dmarkall-3-${h}`, `dmarkall-3-${h.toUpperCase()}`, `dmarkall-3-${h.slice(1)}`, `dmarkall-3-${h}\n`]) {
    assert.equal(parseMarkAllKey(bad), undefined, bad);
  }
});

test('spec 444 claim 10: the marks cap is 256 KiB and a press of 500 fits beside the count cap', () => {
  assert.equal(d.MAX_MARKS_BYTES, 256 * 1024);
  const added = Array.from({ length: 500 }, (_, i) => mk(SID, String(1_000_000_000_000_000 + i), NOW, 'read', NOW + 1));
  const file = { kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS - 500 }, (_, i) => mk(OTHER, String(i + 1), NOW, 'read', NOW + 2)) };
  const known = new Set([...file.marks, ...added].map(m => markKey(m.log, m.id, m.entryAt)));
  const next = addMarks(file, added, known);
  assert.equal(next.marks.length, MAX_MARKS);
  assert.ok('value' in serializeMarks(next));
});

test('spec 444 claim 10: at wide ids the byte cap binds before the count cap, and the order of the drops still holds', () => {
  const wide = (log, i, at) => mk(log, String(1_000_000_000_000_000 + i), NOW, 'unflagged', at);
  const old = Array.from({ length: MAX_MARKS - 500 }, (_, i) => wide(OTHER, i, NOW + i));
  const added = Array.from({ length: 500 }, (_, i) => wide(SID, 10_000 + i, NOW + 5000));
  const file = { kind: 'marks', v: 1, marks: old };
  const known = new Set([...old, ...added].map(m => markKey(m.log, m.id, m.entryAt)));
  assert.ok(Buffer.byteLength(JSON.stringify({ kind: 'marks', v: 1, marks: [...old, ...added] })) > d.MAX_MARKS_BYTES, 'the count alone would not fit');
  const next = addMarks(file, added, known);
  assert.ok(next.marks.length < MAX_MARKS, 'the byte cap dropped marks the count cap would have kept');
  assert.ok('value' in serializeMarks(next));
  assert.deepEqual(next.marks.slice(-500), added, 'none of the new marks drops');
  assert.deepEqual(next.marks.slice(0, 3).map(m => m.id), old.slice(next.marks.length - 500 > 3 ? old.length - (next.marks.length - 500) : 0).slice(0, 3).map(m => m.id), 'the oldest dropped first');
});

test('spec 444 claim 10: past the cap a superseded mark drops before a live one, so no cleared flag comes back', () => {
  const marks = [mk(SID, '1', NOW, 'flagged', NOW + 1), mk(SID, '1', NOW, 'unflagged', NOW + 2), ...Array.from({ length: MAX_MARKS - 2 }, (_, i) => mk(SID, String(i + 2), NOW, 'read', NOW + 3 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const added = [mk(SID, '9999', NOW, 'read', NOW + 5000)];
  const next = addMarks(file, added, known, [], NOW + 6000);
  assert.equal(next.marks.length, MAX_MARKS);
  assert.ok(!next.marks.some(m => m.id === '1' && m.state === 'flagged'), 'the superseded flag dropped first');
  assert.ok(next.marks.some(m => m.id === '1' && m.state === 'unflagged'));
  assert.deepEqual(next.marks.slice(-1), added);
});

test('spec 444 claim 10: a superseded mark drops before a live one that is older than it', () => {
  // A live read mark for entry A is the oldest; B's flag is superseded by B's later unflag. Oldest-first would drop A's.
  const marks = [mk(SID, '1', NOW, 'read', NOW + 1), mk(SID, '2', NOW, 'flagged', NOW + 2), mk(SID, '2', NOW, 'unflagged', NOW + 3), ...Array.from({ length: MAX_MARKS - 3 }, (_, i) => mk(SID, String(i + 3), NOW, 'read', NOW + 10 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const next = addMarks(file, [mk(SID, '9999', NOW, 'read', NOW + 9000)], known, [], NOW + 20000);
  assert.ok(next.marks.some(m => m.id === '1'), 'the older live mark stays');
  assert.ok(!next.marks.some(m => m.id === '2' && m.state === 'flagged'), 'the superseded flag dropped');
});

test('spec 444 claim 10: a newest mark whose older flag sits in another file is kept past step 3, and unknown entries drop first', () => {
  const flagOther = { kind: 'marks', v: 1, marks: [mk(OTHER, '1', NOW, 'flagged', NOW + 1)] };
  const marks = [mk(OTHER, '1', NOW, 'unflagged', NOW + 2), ...Array.from({ length: MAX_MARKS - 1 }, (_, i) => mk(SID, String(i + 1), NOW, 'read', NOW + 10 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const added = [mk(SID, '9000', NOW, 'read', NOW + 9000), mk(SID, '9001', NOW, 'read', NOW + 9000)];
  const next = addMarks(file, added, known, [flagOther], NOW + 20000);
  assert.ok(next.marks.some(m => m.log === OTHER && m.state === 'unflagged'), 'the unflagged mark stays');
  assert.notEqual(mergeMarks([next, flagOther], NOW + 20000).get(markKey(OTHER, '1', NOW)), 'flagged');
  const unknown = addMarks(file, added, new Set([...known].filter(k => !k.startsWith(OTHER))), [flagOther], NOW + 20000);
  assert.ok(!unknown.marks.some(m => m.log === OTHER), 'an unknown entry\'s mark dropped first');
});

test('issue 459 claim 5: past the marks cap, the owner\'s newest mark on a lead-flagged entry is kept past step 3, so the lead\'s flag never comes back', () => {
  for (const state of ['unflagged', 'read']) {
    const marks = [mk(OTHER, '1', NOW, state, NOW + 2), ...Array.from({ length: MAX_MARKS - 1 }, (_, i) => mk(SID, String(i + 1), NOW, 'read', NOW + 10 + i))];
    const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
    const leadFlags = new Set([markKey(OTHER, '1', NOW)]);
    const next = addMarks({ kind: 'marks', v: 1, marks }, [mk(SID, '9000', NOW, 'read', NOW + 9000)], known, [], NOW + 20000, leadFlags);
    assert.ok(next.marks.some(m => m.log === OTHER && m.state === state), `the owner's ${state} mark stays`);
    assert.ok(!next.marks.some(m => m.log === SID && m.id === '1'), 'the oldest plain read drops instead');
  }
});

test('spec 444 claim 10: a mark dated one minute ahead is inside the allowance, so it supersedes and the older flag of its entry drops first', () => {
  const now = NOW + 20000;
  const soon = { kind: 'marks', v: 1, marks: [mk(SID, '1', NOW, 'unflagged', now + 60 * 1000)] };
  const marks = [mk(SID, '1', NOW, 'flagged', NOW + 1), ...Array.from({ length: MAX_MARKS - 1 }, (_, i) => mk(SID, String(i + 2), NOW, 'read', NOW + 10 + i))];
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const next = addMarks({ kind: 'marks', v: 1, marks }, [mk(SID, '9000', NOW, 'read', NOW + 9000)], known, [soon], now);
  assert.ok(!next.marks.some(m => m.id === '1' && m.state === 'flagged'), 'the flag a counted mark supersedes dropped first');
  assert.ok(next.marks.some(m => m.id === '2'), 'the oldest plain read stays');
});

test('spec 444 claim 10: a mark dated over two minutes ahead supersedes nothing, and a live flag drops after the plain reads', () => {
  const future = { kind: 'marks', v: 1, marks: [mk(SID, '1', NOW, 'unflagged', NOW + 10 * 60 * 1000)] };
  const marks = [mk(SID, '1', NOW, 'flagged', NOW + 1), ...Array.from({ length: MAX_MARKS - 1 }, (_, i) => mk(SID, String(i + 2), NOW, 'read', NOW + 10 + i))];
  const file = { kind: 'marks', v: 1, marks };
  const known = new Set(marks.map(m => markKey(m.log, m.id, m.entryAt)));
  const added = [mk(SID, '9000', NOW, 'read', NOW + 9000)];
  const next = addMarks(file, added, known, [future], NOW + 20000);
  assert.ok(next.marks.some(m => m.id === '1' && m.state === 'flagged'), 'the flag stays');
  assert.ok(!next.marks.some(m => m.id === '2'), 'the oldest plain read dropped');
});

// --- the marks cap and a bulk write -----------------------------------------------------------

const { dropsLiveMark } = d;

test('spec 447 claim 8 (Test round 1, q3 A), issue 509: a write that pushes out a mark still its entry\'s newest state is caught; one that drops a mark for no log read is not', () => {
  const known = new Set(Array.from({ length: MAX_MARKS }, (_, i) => markKey(OTHER, String(i + 1), NOW)));
  const live = { kind: 'marks', v: 1, marks: Array.from({ length: MAX_MARKS }, (_, i) => mk(OTHER, String(i + 1), NOW, 'read', NOW + i)) };
  const added = [mk(SID, '1', NOW, 'read', NOW + 5000)];
  const marked = new Set([markKey(SID, '1', NOW)]);
  const after = addMarks(live, added, known, [], NOW + 5000);
  assert.equal(after.marks.length, MAX_MARKS, 'the oldest live read mark dropped');
  assert.equal(dropsLiveMark(live, after, [], known, marked, NOW + 5000), true);
  // The same marks for entries in no log read drop first and change nothing the pane reads.
  const after2 = addMarks(live, added, new Set(), [], NOW + 5000);
  assert.equal(dropsLiveMark(live, after2, [], new Set(), marked, NOW + 5000), false);
  // A dropped mark that a newer mark in another file supersedes changes no state either.
  const elsewhere = { kind: 'marks', v: 1, marks: [mk(OTHER, '1', NOW, 'read', NOW + 9000)] };
  const after3 = addMarks(live, added, known, [elsewhere], NOW + 9000);
  assert.equal(dropsLiveMark(live, after3, [elsewhere], known, marked, NOW + 9000), false);
  // The entries the write marks are its own business.
  assert.equal(dropsLiveMark(undefined, { kind: 'marks', v: 1, marks: added }, [], marked, marked, NOW + 5000), false);
});

// --- spec 448: a lead's own answered pair on one card -------------------------------------------
//
// Each test names the acceptance claim of spec 448 (S8) it backs.

const { reviewCards, parsePairKey } = d;
// This session's log: a plain Lead entry, a waiting entry W, a Relayed entry A
// that answers W, and a later plain entry; and another log's own pair.
const pairLogs = () => {
  let own = emptyLog(null);
  const add = (raw, at) => {
    own = appendEntry(own, raw, { at, level: 1, read: new Map() }).value.log;
  };
  add(input({ work: 'plain first' }), NOW + 1);
  add(input({ waiting: true, pick: '', work: 'mine waits' }), NOW + 2);
  add(input({ source: 'relayed', answers: '2', work: 'my answer' }), NOW + 3);
  add(input({ work: 'plain later' }), NOW + 4);
  const other = tabLogsFor()[1];
  return [{ sid: SID, writer: 'lead-a', log: own }, other];
};

test('spec 448 claims 1 and 5: an own unread waiting entry and its answer are one card at the waiting entry\'s place, counted once', () => {
  const ls = pairLogs();
  const v = drawnLogs(ls, SID);
  const q = reviewCards(v, SID, new Map(), new Set(), []);
  const own = q.cards.filter(c => c.row.sid === SID);
  assert.deepEqual(own.map(c => [c.row.entry.work, c.answer?.entry.work]), [['plain first', undefined], ['mine waits', 'my answer'], ['plain later', undefined]]);
  // The answer has no card of its own, and To review's count counts the pair once.
  assert.ok(!q.cards.some(c => c.row.sid === SID && c.row.entry.work === 'my answer'));
  const entries = reviewQueue(v, new Map(), new Set(), []).total;
  assert.equal(q.total, entries - 1);
  // The shown rows hold every entry, both of the pair included, oldest first.
  assert.deepEqual(q.shown, reviewQueue(v, new Map(), new Set(), []).order);
  // The card takes the waiting entry's place, not the answer's: with the answer dated after the later plain entry, the pair still comes first.
  const late = structuredClone(ls);
  late[0].log.entries[2].at = NOW + 10;
  const lateCards = reviewCards(drawnLogs(late, SID), SID, new Map(), new Set(), []).cards.filter(c => c.row.sid === SID);
  assert.deepEqual(lateCards.map(c => c.row.entry.work), ['plain first', 'mine waits', 'plain later']);
  assert.equal(lateCards[1].answer?.entry.work, 'my answer');
});

test('spec 448 claim 3: when only one of the pair is unread it draws alone', () => {
  const ls = pairLogs();
  const [, w, a] = ls[0].log.entries;
  const v = drawnLogs(ls, SID);
  for (const [read, alone] of [[w, a], [a, w]]) {
    for (const state of ['read', 'flagged']) {
      const states = new Map([[keyOf(SID, read), state]]);
      const own = reviewCards(v, SID, states, new Set(), []).cards.filter(c => c.row.sid === SID);
      assert.deepEqual(own.map(c => [c.row.entry.id, c.answer]), [['1', undefined], [alone.id, undefined], ['4', undefined]], `${read.work} ${state}`);
    }
  }
});

test('spec 448 claim 4: a search matching only the answer draws the pair, and one matching neither hides it', () => {
  const ls = pairLogs();
  const v = drawnLogs(ls, SID);
  const only = reviewCards(v, SID, new Map(), new Set(), searchWords('my answer'));
  assert.deepEqual(only.cards.map(c => [c.row.entry.work, c.answer?.entry.work]), [['mine waits', 'my answer']]);
  assert.deepEqual(only.shown.map(r => r.entry.work), ['mine waits', 'my answer'], 'both count as shown');
  assert.deepEqual(reviewCards(v, SID, new Map(), new Set(), searchWords('mine waits')).shown.map(r => r.entry.work), ['mine waits', 'my answer']);
  assert.deepEqual(reviewCards(v, SID, new Map(), new Set(), searchWords('plain later')).cards.map(c => c.row.entry.work), ['plain later']);
});

test('spec 448 claim 2: a pair counts as skipped when its waiting entry is, and the queue wraps by card', () => {
  const ls = [pairLogs()[0]];
  const [, w] = ls[0].log.entries;
  const first = keyOf(SID, ls[0].log.entries[0]);
  const q = reviewCards(ls, SID, new Map(), new Set([first, keyOf(SID, w)]), []);
  assert.equal(q.head.entry.work, 'plain later');
  assert.equal(q.answer, undefined);
  assert.deepEqual([q.n, q.total], [3, 3]);
  const head = reviewCards(ls, SID, new Map(), new Set([first]), []);
  assert.deepEqual([head.head.entry.work, head.answer?.entry.work, head.n], ['mine waits', 'my answer', 2]);
  // Every card skipped: the first again.
  const all = new Set([0, 1, 3].map(i => keyOf(SID, ls[0].log.entries[i])));
  assert.equal(reviewCards(ls, SID, new Map(), all, []).n, 1);
});

test('spec 448 claim 3: a pair key matches whole, naming both entries by id and time', () => {
  assert.deepEqual(parsePairKey('dnext-2-100-3-110'), { verb: 'dnext', id: '2', at: 100, answerId: '3', answerAt: 110 });
  assert.deepEqual(parsePairKey('dflag-2-0-3-1'), { verb: 'dflag', id: '2', at: 0, answerId: '3', answerAt: 1 });
  assert.deepEqual(parsePairKey('dskip-9999999999999999-9999999999999999-1-1')?.verb, 'dskip');
  for (const bad of ['dnext-2-100', 'dnext-0-100-3-110', 'dnext-2-100-03-110', 'dnext-2-100-3-110-4', ' dnext-2-100-3-110', 'dnext-2-100-3-110\n', 'dread-2-100-3-110', 'dnext-2-100-3-', 'dnext-2-100-3-12345678901234567', 'dmarkall-2-100-3-110']) {
    assert.equal(parsePairKey(bad), undefined, bad);
  }
});

test('issue 466, issue 509: Mark all as read takes everything under To review, of every kind of this session\'s log, with a hash that moves when the set does', () => {
  const ls = tabLogsFor();
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '4', at: NOW + 10, waiting: true, pick: '', work: 'mine waits' });
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '5', at: NOW + 11, source: 'relayed', answers: '4', waiting: false });
  ls[0].log.entries.push({ ...ls[0].log.entries[0], id: '6', at: NOW + 12, source: 'alarm' });
  const v = drawnLogs(ls, SID);
  const cards = d.reviewCards(v, SID, new Map(), new Set(), []);
  const set = markAllSet(cards.cards);
  assert.deepEqual(set.rows, cards.shown);
  // #496: it counts what leaves To review: a card, a pair as one.
  assert.equal(set.n, cards.cards.length);
  assert.ok(set.n < set.rows.length, 'a pair is drawn');
  assert.equal(set.total, set.n);
  for (const kind of ['lead', 'relayed', 'alarm']) assert.ok(set.rows.some(r => r.entry.source === kind), kind);
  assert.ok(set.rows.some(r => r.entry.waiting), 'a waiting entry');
  assert.equal(set.hash, createHash('sha256').update(set.rows.map(r => keyOf(r.sid, r.entry)).sort().join('\n')).digest('hex').slice(0, 16));
  assert.notEqual(markAllSet(cards.cards.slice(1)).hash, set.hash);
  assert.deepEqual(markAllSet([]), { rows: [], n: 0, total: 0, hash: '' });
  // Past 500 entries it takes the first 500, so its key stays in range, and counts the rest as staying.
  const many = Array.from({ length: 501 }, (_, i) => ({ sid: SID, writer: 'w', entry: { ...ls[0].log.entries[0], id: String(i + 1), at: NOW + i } }));
  const big = markAllSet(many.map(row => ({ row, answer: undefined })));
  assert.deepEqual(big.rows, many.slice(0, 500));
  assert.deepEqual([big.n, big.total], [500, 501]);
  // A pair that would straddle the cap is left whole for the next press, and nothing after it is taken.
  const pair = { row: many[499], answer: many[500] };
  const straddle = markAllSet([...many.slice(0, 499).map(row => ({ row, answer: undefined })), pair, { row: { ...many[0], entry: { ...many[0].entry, id: '900' } }, answer: undefined }]);
  assert.deepEqual([straddle.rows.length, straddle.n, straddle.total], [499, 499, 501]);
});

// Issue 486, read from brigade/register.tsx's text: the scan's test file held
// the only check that each written tool's own catch answers a fresh copy of
// its fixed refusal, and those refusals stay (spec S4); the two decision
// tools' descriptions bar error text only (claim 5).
test('issue 486 claims 3 and 5: each written tool\'s catch answers a fresh copy of its refusal, and the two decision tools bar only error text', () => {
  const src = readFileSync(new URL('../brigade/register.tsx', import.meta.url), 'utf8');
  for (const own of ['ROSTER_CAUGHT', 'LOG_CAUGHT', 'HANDOFF_CAUGHT']) assert.ok(src.includes(`}).catch(() => ({ ...${own} }))`), own);
  const descriptions = src.match(/ Plain text only, with no [^."]*\./g) ?? [];
  assert.deepEqual(descriptions, [' Plain text only, with no error text.', ' Plain text only, with no error text.']);
});

// Issue 509 (the owner's words, 2026-11-05 and 2026-11-07): Mark all as read
// does them all. It replaces issue 486's claim 5b, which left this session's
// unanswered waiting entries under To review.
test('issue 509: Mark all as read takes an own unanswered waiting entry too', () => {
  const ls = pairLogs();
  const mine = { ...ls[0].log.entries[1], id: '5', at: NOW + 5, work: 'mine still waits' };
  ls[0].log.entries.push(mine);
  const v = drawnLogs(ls, SID);
  const cards = d.reviewCards(v, SID, new Map(), new Set(), []);
  const set = markAllSet(cards.cards);
  assert.ok(cards.shown.some(r => r.entry === mine), 'it is under To review');
  assert.ok(set.rows.some(r => r.entry === mine), 'Mark all as read takes it');
  assert.ok(set.rows.some(r => r.sid === SID && r.entry.work === 'mine waits'), 'an answered own waiting entry is taken');
  // #496: the count is in cards, a pair as one; every card is taken.
  assert.ok(cards.cards.length < cards.shown.length, 'a pair is drawn');
  assert.deepEqual(set.rows, cards.shown);
  assert.deepEqual([set.n, set.total], [cards.cards.length, cards.cards.length]);
  assert.equal(set.hash, createHash('sha256').update(set.rows.map(r => keyOf(r.sid, r.entry)).sort().join('\n')).digest('hex').slice(0, 16));
  const after = new Map(set.rows.map(r => [keyOf(r.sid, r.entry), 'read']));
  const left = d.reviewCards(drawnLogs(ls, SID), SID, after, new Set(), []);
  assert.equal(left.total, 0);
  assert.deepEqual(markAllSet(left.cards), { rows: [], n: 0, total: 0, hash: '' });
});

// --- issue 459: the lead flags its own unsure decisions ------------------------------
//
// A `flag` on log_decision is a one-line reason. A flagged Lead entry reads as
// flagged until the owner marks it, so it sits in Flagged to revisit and never
// in To review, where Mark all as read takes from; the owner's latest mark wins.

test('issue 459 claim 1: a flag is one line of 1 to 300 characters on a Lead entry that does not wait, kept only when sent', () => {
  assert.equal(checkInput(input({ flag: 'Unsure: the tier may be too low.' })).value?.flag, 'Unsure: the tier may be too low.');
  for (const none of [input(), input({ flag: '' })]) {
    const c = checkInput(none);
    assert.ok('value' in c, JSON.stringify(c));
    assert.equal(Object.hasOwn(c.value, 'flag'), false, 'no flag key when none was sent');
  }
  assert.ok('value' in checkInput(input({ flag: 'x'.repeat(300) })));
  const refused = [
    [input({ flag: 'x'.repeat(301) }), /^flag is over 300 characters$/],
    [input({ flag: 'two\nlines' }), /^flag holds a line break$/],
    [input({ flag: '   ' }), /^flag is empty$/],
    [input({ flag: 7 }), /^flag is not text$/],
    [input({ source: 'relayed', flag: 'Unsure.' }), /^flag: only a Lead entry that does not wait may carry one$/],
    [input({ waiting: true, pick: '', flag: 'Unsure.' }), /^flag: only a Lead entry that does not wait may carry one$/],
  ];
  for (const [v, re] of refused) assert.match(checkInput(v).error ?? '', re, JSON.stringify(v.flag));
  const r = appendEntry(emptyLog(null), input({ flag: 'Unsure.' }), { at: NOW, level: 3, read: new Map() });
  assert.equal(r.value.entry.flag, 'Unsure.');
  assert.equal(r.value.entry.waiting, false, 'a flag holds nothing: the entry does not wait');
  const plain = appendEntry(emptyLog(null), input(), { at: NOW, level: 3, read: new Map() });
  assert.equal(JSON.stringify(plain.value.log).includes('"flag"'), false, 'an unflagged entry is stored as before');
});

test('issue 459 claim 2: the strict log check takes an entry with or without a flag, and refuses a flag the tool would refuse', () => {
  const log = logOf(2, i => (i === 1 ? { flag: 'Unsure.' } : {}));
  const back = checkLog(JSON.stringify(log));
  assert.ok('value' in back, JSON.stringify(back));
  assert.deepEqual(back.value, log);
  for (const bent of [{ flag: '' }, { flag: 'a\nb' }, { source: 'relayed' }, { waiting: true, pick: '' }]) {
    const b = structuredClone(log);
    Object.assign(b.entries[1], bent);
    assert.ok('error' in checkLog(JSON.stringify(b)), JSON.stringify(bent));
  }
});

test('issue 459 claim 3: this lead\'s flagged entry sits in Flagged and never in To review until the owner marks it; another log\'s flag is not drawn', () => {
  const add = (log, over, at) => appendEntry(log, input(over), { at, level: 3, read: new Map() }).value.log;
  const own = add(add(emptyLog(null), { work: 'plain' }, NOW), { work: 'mine flagged', flag: 'Unsure.' }, NOW + 1);
  const other = add(add(emptyLog(null), { source: 'relayed', work: 'claim' }, NOW - 5), { work: 'theirs flagged', flag: 'Unsure too.' }, NOW - 4);
  const ls = [{ sid: SID, writer: 'lead-a', log: own }, { sid: OTHER, writer: 'an ended session', log: other }];
  const view = marks => {
    const states = d.withLeadFlags(marks, ls, SID);
    const v = drawnLogs(ls, SID);
    const cards = d.reviewCards(v, SID, states, new Set(), []);
    return {
      review: cards.shown.map(r => r.entry.work).sort(),
      flagged: flaggedRows(v, states, []).map(r => r.entry.work),
    };
  };
  // To review's shown rows are all Mark all as read can take: no flagged entry is there.
  assert.deepEqual(view(new Map()), { review: ['plain'], flagged: ['mine flagged'] });
  // The search reads the reason.
  assert.deepEqual(flaggedRows(drawnLogs(ls, SID), d.withLeadFlags(new Map(), ls, SID), searchWords('Unsure')).map(r => r.entry.work), ['mine flagged']);
  // The owner's latest mark wins: Unflag or Dismiss takes it out, and a later Flag keeps it in.
  const k = markKey(SID, own.entries[1].id, own.entries[1].at);
  assert.deepEqual(view(new Map([[k, 'unflagged']])).flagged, []);
  assert.deepEqual(view(new Map([[k, 'read']])).flagged, []);
  assert.deepEqual(view(new Map([[k, 'flagged']])).flagged, ['mine flagged']);
  assert.equal(view(new Map([[k, 'unflagged']])).review.includes('mine flagged'), false, 'an unflagged entry is read');
  // The owner's own flag on another log's entry draws nothing.
  const t = markKey(OTHER, other.entries[1].id, other.entries[1].at);
  assert.deepEqual(view(new Map([[t, 'flagged']])).flagged, ['mine flagged']);
  // The states given are not changed.
  const marks = new Map();
  d.withLeadFlags(marks, ls, SID);
  assert.equal(marks.size, 0);
});

// --- issue 464, spec v5: the level command, the command 3 and the rename ------------------
// Each test names the claim of spec v5 (S7) it backs at this seam; the same
// claims are driven through the engine in brigade/set-roster.test.ts.

const fixedOf = (raw) => {
  const r = appendEntry(emptyLog(null), raw, { at: NOW, level: 1, read: new Map(), fixed: true });
  assert.ok('value' in r, JSON.stringify(r));
  return r.value.log.entries[0];
};

test('C3: the grammar takes level 1, level 2 and level 3 with a goal, and refuses everything else with a fixed line', () => {
  assert.deepEqual(parseLevelCommand('level 1'), { level: 1 });
  assert.deepEqual(parseLevelCommand('  level   2  '), { level: 2 });
  assert.deepEqual(parseLevelCommand('Level 3 grimoire#464 build'), { level: 3, goal: 'grimoire#464 build' });
  // The goal is cleaned as oneLine cleans: controls become spaces, hidden characters go, runs of space fold.
  assert.deepEqual(parseLevelCommand('level 3 issue\u{0}464\n on\u{200B}e   repo'), { level: 3, goal: 'issue 464 one repo' });
  // Not a level command: today's /brigade path.
  for (const args of ['', '   ', 'open', 'levels 3', 'levelx', 'go level 3']) {
    assert.equal(parseLevelCommand(args), undefined, args);
    assert.equal(isLevelCommand(args), false, args);
  }
  for (const args of ['level', ' LEVEL 3 x', 'level 9']) assert.equal(isLevelCommand(args), true, args);
  for (const bad of [undefined, null, 3, ['level 3']]) assert.equal(isLevelCommand(bad), false, String(bad));
  for (const args of ['level', 'level 4', 'level 0', 'level three', 'level 1 now', 'level 2 issue 464', 'level -1', 'level 3x goal']) {
    assert.deepEqual(parseLevelCommand(args), { refused: LEVEL_REPLIES.usage }, args);
  }
  for (const args of ['level 3', 'level 3    ', 'level 3 \u{200B}\u{200C}', 'level 3 \u{1}\u{2}']) {
    assert.deepEqual(parseLevelCommand(args), { refused: LEVEL_REPLIES.needsGoal }, JSON.stringify(args));
  }
  // 300 characters after cleaning hold; 301 refuse, and the refusal holds none of the value.
  const g300 = 'g'.repeat(300);
  assert.deepEqual(parseLevelCommand(`level 3 ${g300}`), { level: 3, goal: g300 });
  assert.deepEqual(parseLevelCommand(`level 3 ${g300}h`), { refused: LEVEL_REPLIES.goalLong });
  // Astral characters count as one each, as oneLine counts them.
  assert.deepEqual(parseLevelCommand(`level 3 ${'\u{1F600}'.repeat(300)}`), { level: 3, goal: '\u{1F600}'.repeat(300) });
  assert.equal(LEVEL_REPLIES.goalLong, 'Not set: a goal holds at most 300 characters');
  assert.equal(LEVEL_REPLIES.needsGoal, 'Not set: a 3 needs a goal: /brigade level 3 <the goal, by repository and issue>');
  assert.equal(LEVEL_REPLIES.usage, 'Not set: type /brigade level 1, /brigade level 2 or /brigade level 3 <goal>');
});

test("C2: the gate takes only a run the engine stamps as the owner's Enter or a Remote Control message", () => {
  assert.equal(levelOriginAllowed({ kind: 'composer' }), true);
  assert.equal(levelOriginAllowed({ kind: 'bridge' }), true);
  for (const kind of ['plugin', 'sdk', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'unclassified', 'Composer', '']) {
    assert.equal(levelOriginAllowed({ kind, name: 'other' }), false, kind);
  }
  for (const bad of [undefined, null, 'composer', {}, [], { kind: ['composer'] }]) assert.equal(levelOriginAllowed(bad), false, JSON.stringify(bad));
  assert.equal(LEVEL_REPLIES.notTyped, 'Not set: /brigade level counts only when the owner types it at the prompt or sends it from the phone.');
});

test('S4.1 (C4, C5, C7, C8): a 3 counts as set by the command only while its time is the press time, the level in force is 3 and no raise is in flight', () => {
  const commanded = { at: NOW, goal: 'issue 464' };
  assert.equal(commandHolds({ commanded, pressAt: NOW, level: 3, raising: false }), true);
  assert.equal(commandHolds({ commanded: undefined, pressAt: NOW, level: 3, raising: false }), false);
  assert.equal(commandHolds({ commanded, pressAt: NOW + 1, level: 3, raising: false }), false);
  assert.equal(commandHolds({ commanded, pressAt: undefined, level: 3, raising: false }), false);
  assert.equal(commandHolds({ commanded, pressAt: NOW, level: 2, raising: false }), false);
  assert.equal(commandHolds({ commanded, pressAt: NOW, level: 1, raising: false }), false);
  assert.equal(commandHolds({ commanded, pressAt: NOW, level: 3, raising: true }), false);
});

test("C1, C15: the command's Owner entry has its own fixed shape, holds no goal, and draws as Owner only when this pane wrote it", () => {
  const e = fixedOf(commandEntry(3));
  assert.deepEqual([e.source, e.question, e.options, e.pick, e.why, e.undo, e.revisit, e.answers], [
    'owner', 'Autonomy level', ['1 Manual', '2 Auto', '3 Turbo'], '3 Turbo', "Set by the owner's command", 'Type /brigade level 1, or move the slider', '', '',
  ]);
  for (const l of [1, 2, 3]) assert.equal(inFixedShape(fixedOf(commandEntry(l))), true, String(l));
  assert.ok('value' in checkLog(JSON.stringify({ ...emptyLog(null), next: 2, entries: [e] })));
  assert.equal(sourceLabel(e, 'lead-a', true), 'Owner');
  assert.equal(sourceLabel(e, 'lead-a'), 'Owner (as recorded)');
  // Out of shape in any one field, and never with the slider's undo beside the command's why.
  for (const over of [{ undo: 'Move the slider back' }, { why: 'Moved in the pane' }, { work: 'issue 464' }, { pick: '3 Full throttle' }]) {
    assert.equal(inFixedShape({ ...e, ...over }), false, JSON.stringify(over));
  }
});

test('C15a, #496: level 3 is named Turbo, and logs written before either rename stay in their fixed shape, as whole old shapes only', () => {
  assert.equal(levelOption(3), '3 Turbo');
  // Turbo mode, from 0.99.0 to 0.112.0: every fixed entry, the command's included.
  const MODE = ['1 Manual', '2 Auto', '3 Turbo mode'];
  for (const e of [ownerEntry(3), commandEntry(3), alarmEntry(3)]) assert.equal(inFixedShape({ ...fixedOf(e), options: MODE, pick: '3 Turbo mode' }), true, e.why);
  assert.equal(inFixedShape({ ...fixedOf(paneEntry('reload')), options: MODE }), true);
  assert.equal(inFixedShape({ ...fixedOf(ownerEntry(3)), pick: '3 Turbo mode' }), false);
  assert.equal(inFixedShape({ ...fixedOf(ownerEntry(3)), options: MODE }), false);
  const OLD = ['1 Manual', '2 Auto', '3 Full throttle'];
  const owner = fixedOf(ownerEntry(3));
  const pane = fixedOf(paneEntry('compact'));
  const alarm = fixedOf(alarmEntry(3));
  const command = fixedOf(commandEntry(3));
  // Whole old shapes, as builds before the rename wrote them.
  assert.equal(inFixedShape({ ...owner, options: OLD, pick: '3 Full throttle' }), true);
  assert.equal(inFixedShape({ ...owner, options: OLD, pick: '2 Auto' }), true);
  assert.equal(inFixedShape({ ...pane, options: OLD }), true);
  assert.equal(inFixedShape({ ...alarm, options: OLD, pick: '3 Full throttle' }), true);
  // Mixed shapes, and a command entry with the old name, which no build wrote, are out of shape.
  assert.equal(inFixedShape({ ...owner, options: OLD }), false);
  assert.equal(inFixedShape({ ...owner, pick: '3 Full throttle' }), false);
  assert.equal(inFixedShape({ ...alarm, options: OLD }), false);
  assert.equal(inFixedShape({ ...command, options: OLD, pick: '3 Full throttle' }), false);
  assert.equal(inFixedShape({ ...owner, options: ['1 Manual', '2 Auto', '3 Full throttle', '3 Turbo mode'] }), false);
});

// --- 618 C2, C3: the ask type and stop on log_decision, judged by checkAsk alone ---------

const FORM =
  "Fix the entry's ask, stop or question and log it again: ask is question, review or notify, notify never waits, stop is one of the head-chef skill's kinds and only on a wait, and at level 3 a wait needs both and a one-line question. The step stays held until it is logged; if you can't log it, say so in chat.";
const NO_STOP =
  "At level 3 a wait needs one stop from the head-chef skill's list. At level 3 only blocked, owner-hands, owner-words, never-lifted and outside-goal fit a wait. A call that fits none of them is yours: log it with source lead and your pick, flag it, act, and tell the owner what you took.";
const waits = (over = {}) => input({ waiting: true, pick: '', ...over });

test('618 C2: the two fixed answers are exported whole, and neither names level 1 or echoes an input', () => {
  assert.equal(d.ASK_FORM, FORM);
  assert.equal(d.ASK_NO_STOP, NO_STOP);
  for (const a of [FORM, NO_STOP]) assert.doesNotMatch(a, /level 1/);
});

test('618 C5: STOP_KINDS lists the thirteen kinds S4 names, in its order', () => {
  assert.deepEqual([...d.STOP_KINDS], [
    'owner-file-keeps', 'owner-words', 'carried', 'blocked', 'owner-hands', 'install', 'private-post',
    'leaves-machine', 'sensitive-route', 'merge', 'threat-model', 'never-lifted', 'outside-goal',
  ]);
});

test('618 C2: checkInput lets ask and stop through without judging them, and the entry it returns holds neither', () => {
  for (const over of [{ ask: 'question', stop: 'merge' }, { ask: 'x', stop: 'x' }, { ask: 5 }, { stop: null }]) {
    const c = checkInput(waits(over));
    assert.ok('value' in c, JSON.stringify(c));
    assert.equal(Object.hasOwn(c.value, 'ask') || Object.hasOwn(c.value, 'stop'), false);
  }
});

const ASK_ROWS = [
  // [label, input, level, answer]
  ['ask not a listed value, level 1', waits({ ask: 'x' }), 1, FORM],
  ['ask not text, level 3', waits({ ask: 5, stop: 'merge' }), 3, FORM],
  ['stop not a listed value, level 3', waits({ ask: 'question', stop: 'x' }), 3, FORM],
  ['stop not text, level 2', waits({ ask: 'question', stop: 7 }), 2, FORM],
  ['stop null, level 3', waits({ ask: 'question', stop: null }), 3, FORM],
  ['notify that waits, level 1', waits({ ask: 'notify' }), 1, FORM],
  ['notify that waits, level 3', waits({ ask: 'notify', stop: 'merge' }), 3, FORM],
  ['stop on an entry that does not wait, level 1', input({ stop: 'merge' }), 1, FORM],
  ['stop on an entry that does not wait, level 3', input({ ask: 'notify', stop: 'merge' }), 3, FORM],
  ['question on an entry that does not wait', input({ ask: 'question' }), 3, FORM],
  ['review on an entry that does not wait', input({ ask: 'review' }), 2, FORM],
  ['level 3 wait, question with a line break', waits({ ask: 'question', stop: 'merge', question: 'A?\nB?' }), 3, FORM],
  ['level 3 wait, ask missing, stop given', waits({ stop: 'merge' }), 3, FORM],
  ['level 3 wait, neither ask nor stop', waits(), 3, FORM],
  ['level 3 wait, ask given, stop missing', waits({ ask: 'question' }), 3, NO_STOP],
  ['level 3 wait, review given, stop missing', waits({ ask: 'review' }), 3, NO_STOP],
  ['level 1 wait with neither', waits(), 1, undefined],
  ['level 2 wait with neither', waits(), 2, undefined],
  ['level 1 wait with a line break and no ask', waits({ question: 'A?\nB?' }), 1, undefined],
  ['level 2 wait with a valid ask and stop', waits({ ask: 'review', stop: 'carried' }), 2, undefined],
  ['level 3 wait, question and a listed stop', waits({ ask: 'question', stop: 'owner-file-keeps' }), 3, undefined],
  ['level 3 wait, review and a listed stop', waits({ ask: 'review', stop: 'outside-goal' }), 3, undefined],
  ['a non-waiting entry with neither, level 3', input(), 3, undefined],
  ['a notify that does not wait, level 3', input({ ask: 'notify' }), 3, undefined],
];

for (const [label, entry, level, answer] of ASK_ROWS) {
  test(`618 C2: checkAsk, ${label}`, () => {
    assert.equal(d.checkAsk(entry, level), answer);
  });
}

test('618 C3: a stored log holding ask or stop fails the strict check, and an old level-3 waiting entry still loads and takes an append', () => {
  const entry = { id: '1', at: NOW, level: 3, source: 'lead', waiting: true, work: 'issue 1', question: 'Which?', options: ['A', 'B'], pick: '', why: 'Because.', undo: 'Undo.', revisit: '', answers: '' };
  const text = over => JSON.stringify({ kind: 'decisions', v: 1, next: 2, project: null, entries: [{ ...entry, ...over }] });
  for (const over of [{ ask: 'question' }, { stop: 'merge' }]) assert.ok('error' in checkLog(text(over)), JSON.stringify(over));
  const old = checkLog(text({}));
  assert.ok('value' in old);
  const r = appendEntry(old.value, input(), { at: NOW + 1, level: 3, read: new Map() });
  assert.ok('value' in r);
  assert.deepEqual(r.value.log.entries.map(e => e.id), ['1', '2']);
});

// --- issue 630: log_decision records what the lead sends -----------------------------
// mapInput maps the call before checkInput judges it, so the entry written is always valid;
// only a field over its limit, or more than six options, is left for checkInput to refuse.

const mapped = over => checkInput(mapInput({ ...input(), ...over }));
const lng = n => 'x'.repeat(n);

test('630 C6: a source in any case, an unknown source, a stamped or unused field and a field in another case all land', () => {
  assert.equal(mapped({ source: 'Lead' }).value.source, 'lead');
  assert.equal(mapped({ source: ' RELAYED ' }).value.source, 'relayed');
  for (const s of ['owner', 'pane', 'alarm', undefined, 7]) assert.equal(mapped({ source: s }).value.source, 'lead', String(s));
  const r = mapped({ id: '7', at: 1, level: 3, decision: 'x', colour: 'red' });
  assert.ok('value' in r);
  assert.deepEqual(Object.keys(r.value).sort(), Object.keys(checkInput(input()).value).sort());
  const cased = input();
  delete cased.pick;
  delete cased.why;
  cased.Pick = 'Thorough';
  cased.WHY = 'because';
  const c = checkInput(mapInput(cased));
  assert.equal(c.value.pick, 'Thorough');
  assert.equal(c.value.why, 'because');
  assert.equal(mapInput({ ...input(), ASK: 'question' }).ask, 'question');
  assert.equal(mapInput(null).source, 'lead');
});

test('630 C6: missing text becomes "not given"; control and hidden characters go; options merge; a pick outside the options joins them', () => {
  const bare = checkInput(mapInput({}));
  assert.ok('value' in bare, JSON.stringify(bare));
  assert.equal(bare.value.why, 'not given');
  assert.equal(bare.value.pick, 'not given');
  assert.deepEqual(bare.value.options, ['not given']);
  assert.equal(mapped({ why: 'a\u{7}b\u{200B}c' }).value.why, 'a bc');
  assert.equal(mapped({ why: 'line one\nline two' }).value.why, 'line one\nline two');
  assert.deepEqual(mapped({ options: ['Yes', 'yes', 'No'], pick: 'YES' }).value.options, ['Yes', 'No']);
  assert.equal(mapped({ options: ['Yes', 'yes', 'No'], pick: 'YES' }).value.pick, 'Yes');
  assert.deepEqual(mapped({ pick: 'Maybe' }).value.options, ['Thorough', 'Standard', 'Maybe']);
  assert.equal(mapped({ pick: '' }).value.pick, 'Thorough');
  assert.deepEqual(mapped({ options: 'Solo', pick: undefined }).value.options, ['Solo']);
});

test('630 C6: the couplings hold by mapping: a waiting entry is a lead entry with an empty pick; answers and flag only where they may be', () => {
  const w = mapped({ waiting: true, source: 'relayed', pick: 'Thorough', answers: '3', flag: 'unsure' });
  assert.equal(w.value.waiting, true);
  assert.equal(w.value.source, 'lead');
  assert.equal(w.value.pick, '');
  assert.equal(w.value.answers, '');
  assert.equal(w.value.flag, undefined);
  assert.equal(mapped({ answers: '5' }).value.answers, '', 'a lead entry answers none');
  assert.equal(mapped({ source: 'relayed', answers: '5' }).value.answers, '5');
  assert.equal(mapped({ source: 'relayed', answers: 'abc' }).value.answers, '');
  assert.equal(mapped({ source: 'relayed', flag: 'x' }).value.flag, undefined);
  assert.equal(mapped({ flag: 'two\nlines' }).value.flag, 'two lines');
});

test('630 C6b: a field over its limit, or more than six options, is the only thing refused, and the shape tail never says act at level 1', () => {
  assert.match(mapped({ work: lng(301) }).error, /^work is over 300 characters/);
  assert.match(mapped({ question: lng(1001) }).error, /^question is over 1000 characters/);
  assert.match(mapped({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], pick: 'a' }).error, /^options is not a list of 1 to 6 items/);
  assert.equal(mapped({ work: lng(300) }).error, undefined);
  assert.equal(
    SHAPE_TAIL,
    "The decision log is unchanged; shorten it and log it again. The step stays held until it is logged; if you can't log it, say so in chat.",
  );
  assert.doesNotMatch(SHAPE_TAIL, /level 1/);
  assert.doesNotMatch(mapped({ work: lng(301) }).error, new RegExp(lng(20)), 'no value is echoed');
});

test('630 C6: a wait sent as "true", "yes" or 1 is a wait, and a long options list is read in bounded time', () => {
  for (const w of ['true', 'TRUE', 'yes', ' 1 ', 1]) assert.equal(mapInput({ ...input(), waiting: w }).waiting, true, String(w));
  for (const w of [false, 'false', 'no', 0, undefined]) assert.equal(mapInput({ ...input(), waiting: w }).waiting, false, String(w));
  const t = Date.now();
  const r = mapped({ options: Array.from({ length: 200000 }, (_, i) => `o${i}`), pick: 'o0' });
  assert.match(r.error, /^options is not a list of 1 to 6 items/);
  assert.ok(Date.now() - t < 2000);
});

test('630 C6b: no option is dropped unread: 100 copies of one option then six more are seven distinct options, refused; plain duplicates still merge', () => {
  const opts = [...Array.from({ length: 100 }, () => 'A'), 'B', 'C', 'D', 'E', 'F', 'G'];
  assert.match(mapped({ options: opts, pick: 'A' }).error, /^options is not a list of 1 to 6 items/);
  assert.deepEqual(mapped({ options: [...Array.from({ length: 100 }, () => 'A'), 'B'], pick: 'A' }).value.options, ['A', 'B']);
});
