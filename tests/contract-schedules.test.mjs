// A contract with a `## schedules` part holds the text of each section of its
// skill's SKILL.md and references word for word, and the built files are
// copied from it. This test is the drift check (#604 S7). It reads every
// contract in skills/ that has the part, so head-chef only at first, and fails
// when a schedule and its home differ, when a home names a file outside the
// grammar, when a section has no schedule or two, when a schedule hides a
// heading, a comment or a link-reference line, when a schedule names a clause
// the body does not hold, when the frontmatter's description or compatibility
// differs from the body's clause, or when a schedule that carried text
// Proposed or pending at its last confirmed version is marked Confirmed.
// The same file proves the counter: a fixture passes, and one fault of each
// kind fails with its message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const lf = text => text.replace(/\r\n/g, '\n');
// Compared with line ends normalised and blank lines trimmed at both ends.
const trimmed = text => lf(text).replace(/^\n+/, '').replace(/\n+$/, '');

// A line opening or closing a code fence, as CommonMark reads one.
function fenceOf(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  return m && !(m[1][0] === '`' && m[2].includes('`')) ? { ch: m[1][0], len: m[1].length, rest: m[2] } : null;
}

// Each heading of a file outside a code fence: its level, its text and its
// line. A section runs from a heading of level 1 or 2 to the next one. The
// frontmatter is not read, and `before` holds the text above the first
// heading, which belongs to no section.
function headingsOf(text) {
  const lines = lf(text).split('\n');
  const heads = [];
  let fence = null;
  let from = 0;
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) from = close + 1;
  }
  lines.forEach((line, i) => {
    if (i < from) return;
    const f = fenceOf(line);
    if (fence) {
      if (f && f.ch === fence.ch && f.len >= fence.len && f.rest.trim() === '') fence = null;
      return;
    }
    if (f) { fence = f; return; }
    const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t#]*$/.exec(line);
    if (h) heads.push({ level: h[1].length, heading: (h[2] ?? '').trim(), line: i + 1 });
  });
  const top = heads.filter(h => h.level <= 2);
  top.forEach((h, k) => {
    const end = top[k + 1] ? top[k + 1].line - 1 : lines.length;
    h.text = trimmed(lines.slice(h.line, end).join('\n'));
  });
  const before = trimmed(lines.slice(from, heads.length ? heads[0].line - 1 : lines.length).join('\n'));
  return { sections: top, deep: heads.filter(h => h.level > 2), before };
}

// A line a setext underline can turn into a heading: text that is not a quote,
// a table row, a fence, a heading or an underline, not a list item (`-`, `*` or
// `+` then a space) and not a thematic break. A line led by `**` or `*` with no
// space after it is text.
function isParagraphLine(line) {
  return /^ {0,3}[^\s>|`~#=]/.test(line)
    && !/^ {0,3}[-*+](?:[ \t]|$)/.test(line)
    && !/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line);
}

// What a schedule's text may not hold (S3): a heading line as CommonMark
// reads one (ATX, or a setext underline under a line of text), any line
// holding `<!` or `<?`, and a link-reference definition line, also behind a
// quote or list-item prefix. Returns a short reason, or null.
function textFault(text) {
  const lines = lf(text).split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('<!') || line.includes('<?')) return `line ${i + 1} holds "<!" or "<?"`;
    const f = fenceOf(line);
    if (fence) {
      if (f && f.ch === fence.ch && f.len >= fence.len && f.rest.trim() === '') fence = null;
      continue;
    }
    if (f) { fence = f; continue; }
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) return `line ${i + 1} is a heading`;
    if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(line) && i > 0 && isParagraphLine(lines[i - 1]) &&!/^ {0,3}\[[^\]]+\]:/.test(lines[i - 1])) return `line ${i + 1} underlines a line of text as a heading`;
    if (/^ {0,3}(?:(?:>|[-*+]|\d+[.)])[ \t]+)*\[[^\]]+\]:/.test(line)) return `line ${i + 1} is a link-reference definition`;
  }
  return null;
}

// The grammar of a home (S3): SKILL.md or references/<file>.md, <file> being 1
// to 40 of a-z, 0-9 and -. A file named for the contract or its change log in
// any letter case, and a Windows device name, are refused too.
function homeFault(home) {
  const m = /^references\/([a-z0-9-]{1,40})\.md$/.exec(home);
  if (home !== 'SKILL.md' && !m) {
    const base = home.replace(/^references\//i, '').replace(/\.md$/i, '').toLowerCase();
    if (base === 'contract' || base === 'contract-changelog' || base === 'contract.changelog') return 'names the contract or its change log';
    return 'is outside the grammar SKILL.md or references/<file>.md';
  }
  if (m && /^(contract|contract-changelog|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(m[1])) return m[1].startsWith('contract') ? 'names the contract or its change log' : 'is a Windows device name';
  return null;
}

// The schedules of a contract, in order: title, home, name, the labels it
// carries out, its mark and its text.
function schedulesOf(contract) {
  const at = contract.indexOf('\n## schedules\n');
  if (at < 0) return null;
  const body = contract.slice(0, at + 1);
  const lines = contract.slice(at + 1).split('\n').slice(1);
  const out = [];
  let fence = null;
  let cur = null;
  for (const line of lines) {
    const f = fenceOf(line);
    if (fence) {
      if (f && f.ch === fence.ch && f.len >= fence.len && f.rest.trim() === '') fence = null;
    } else if (f) fence = f;
    else if (/^### /.test(line)) { cur = { title: line.slice(4), lines: [] }; out.push(cur); continue; }
    else if (/^## /.test(line)) break;
    if (cur) cur.lines.push(line);
  }
  const schedules = out.map(s => {
    const colon = s.title.indexOf(': ');
    const home = colon < 0 ? s.title : s.title.slice(0, colon);
    const name = colon < 0 ? '' : s.title.slice(colon + 2);
    let i = 0;
    while (i < s.lines.length && s.lines[i] === '') i++;
    const para = [];
    while (i < s.lines.length && s.lines[i] !== '') para.push(s.lines[i++]);
    const head = para.join(' ');
    const carries = /Carries out: ("[^"]+"(?:, "[^"]+")*)\./.exec(head);
    const mark = /(\*Proposed\*|\*\*Confirmed\*\*|\*\*Decided\*\*)/.exec(head.replace(/^Home: .*?\.(?: Carries out: .*?\.)?(?= \*)/, ''));
    return {
      title: s.title,
      home,
      name,
      homeLine: /^Home: `([^`]*)`, the section "(.*?)"\./.exec(head),
      carries: carries ? [...carries[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : [],
      mark: mark ? mark[1].replace(/\*/g, '') : null,
      text: trimmed(s.lines.slice(i).join('\n')),
    };
  });
  return { body, schedules };
}

// The marks the contract template defines. A mark in bold is no clause label.
const MARKS = ['Proposed', 'Confirmed', 'Decided'];

// The bold labels a body holds, trailing punctuation inside the bold dropped.
function labelsOf(body) {
  const labels = [];
  for (const m of body.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
    const label = m[1].replace(/[.:;]+$/, '').trim();
    if (!MARKS.includes(label)) labels.push(label);
  }
  return labels;
}

// The clause that follows a label in the body, as a block quote joined into
// one line.
function quotedAfter(body, label) {
  const lines = body.split('\n');
  const at = lines.findIndex(l => l.startsWith(`**${label}**`));
  if (at < 0) return null;
  let i = at + 1;
  while (i < lines.length && !lines[i].startsWith('>')) { if (lines[i].startsWith('**') || lines[i].startsWith('#')) return null; i++; }
  const quote = [];
  while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
  return quote.join(' ').replace(/\s+/g, ' ').trim();
}

// The frontmatter's description and compatibility lines of a SKILL.md.
function frontmatterOf(skill) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(lf(skill));
  const get = key => {
    const line = (m ? m[1] : '').split('\n').find(l => l.startsWith(`${key}:`));
    if (line === undefined) return null;
    const v = line.slice(key.length + 1).trim();
    return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(["\\])/g, '$1') : v;
  };
  return { description: get('description'), compatibility: get('compatibility') };
}

// The files of a skill that hold sections: SKILL.md and each file in
// references/ but the contract and its change log.
function homeFilesOf(skillDir) {
  const files = ['SKILL.md'];
  const dir = join(skillDir, 'references');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      const low = f.toLowerCase();
      if (!low.endsWith('.md') || low === 'contract.md' || low === 'contract.changelog.md' || low === 'contract-changelog.md') continue;
      files.push(`references/${f}`);
    }
  }
  return files;
}

/** Every fault of one contract against its skill's files, each as "check N: ...".
 *  `pending` lists the schedule titles whose text was Proposed or pending at the last confirmed version. */
function faultsOf(contractPath, skillDir, pending) {
  const found = schedulesOf(lf(readFileSync(contractPath, 'utf8')));
  if (!found) return [];
  const { body, schedules } = found;
  const out = [];
  const homes = new Map();
  const homeOf = rel => {
    if (!homes.has(rel)) {
      const file = join(skillDir, rel);
      homes.set(rel, existsSync(file) ? headingsOf(readFileSync(file, 'utf8')) : null);
    }
    return homes.get(rel);
  };
  const labels = new Set(labelsOf(body));
  for (const s of schedules) {
    const bad = homeFault(s.home);
    if (bad) { out.push(`check 2: schedule "${s.title}": its home ${bad}`); continue; }
    const file = homeOf(s.home);
    if (!file) { out.push(`check 2: schedule "${s.title}": its home file is not there`); continue; }
    if (s.homeLine && (s.homeLine[1] !== s.home || s.homeLine[2] !== s.name)) out.push(`check 2: schedule "${s.title}": its Home line names another home or section`);
    const same = file.sections.filter(h => h.heading === s.name);
    if (same.length === 0) out.push(`check 2: schedule "${s.title}": ${s.home} holds no section of that name`);
    else if (same.length > 1) out.push(`check 2: schedule "${s.title}": ${s.home} holds that heading ${same.length} times`);
    else if (same[0].text !== s.text) out.push(`check 1: schedule "${s.title}" differs from its home section`);
    const fault = textFault(s.text);
    if (fault) out.push(`check 4: schedule "${s.title}": its text ${fault}`);
    if (s.carries.length === 0) out.push(`check 5: schedule "${s.title}" names no clause it carries out`);
    for (const c of s.carries) if (!labels.has(c)) out.push(`check 5: schedule "${s.title}" carries out "${c}", which the body does not hold`);
  }
  for (const rel of homeFilesOf(skillDir)) {
    const file = homeOf(rel);
    if (!file) continue;
    if (file.before !== '') out.push(`check 3: ${rel} holds text before its first heading`);
    for (const d of file.deep) out.push(`check 4: ${rel} line ${d.line} holds a level-${d.level} heading`);
    for (const h of file.sections) {
      const n = schedules.filter(s => s.home === rel && s.name === h.heading).length;
      if (n === 0) out.push(`check 3: ${rel}: the section "${h.heading}" has no schedule`);
      else if (n > 1) out.push(`check 3: ${rel}: the section "${h.heading}" has ${n} schedules`);
    }
  }
  const skill = existsSync(join(skillDir, 'SKILL.md')) ? readFileSync(join(skillDir, 'SKILL.md'), 'utf8') : null;
  if (skill !== null) {
    const fm = frontmatterOf(skill);
    const want = { description: quotedAfter(body, 'Description for the built file'), compatibility: quotedAfter(body, 'Needs') };
    for (const key of ['description', 'compatibility']) {
      if (want[key] === null) out.push(`check 6: the body holds no ${key} clause`);
      else if (fm[key] !== want[key]) out.push(`check 6: SKILL.md's ${key} differs from the body's clause`);
    }
  }
  for (const title of pending) {
    const s = schedules.find(x => x.title === title);
    if (!s) out.push(`check 7: "${title}" is listed as Proposed or pending at 1.36.1 and is not in the contract`);
    else if (s.mark !== 'Proposed') out.push(`check 7: schedule "${title}" carried text that was Proposed or pending at 1.36.1 and is marked ${s.mark ?? 'with no mark'}`);
  }
  return out;
}

// Check 7's list for head-chef, from the clause map's 1.36.1 mark column (the
// weakest mark over each schedule's text, "pending" where the threat model's
// open issues or docs/security/brigade.md list the clause as pending the
// owner's word). A schedule here is Proposed until the owner confirms it
// alone. A later amendment that confirms one on the owner's own answer removes
// it from this list in the same commit, and the commit message quotes that
// answer.
const HEAD_CHEF_PENDING = [
  'SKILL.md: head-chef',
  'SKILL.md: How you write to the owner',
  'SKILL.md: What a good report looks like',
  'SKILL.md: Starting a session',
  'SKILL.md: Sending and idle notices',
  'SKILL.md: Between the owner and the sessions',
  'SKILL.md: Autonomy levels',
  'SKILL.md: The decision log',
  'SKILL.md: Asking the owner',
  'SKILL.md: Cleanup',
  'SKILL.md: Who decides',
  'SKILL.md: Stop and ask',
  'SKILL.md: Tools',
  'SKILL.md: The start prompt',
  "SKILL.md: Actions that need the owner's yes",
  'SKILL.md: The Brigade pane',
  'SKILL.md: Rules',
  'SKILL.md: Additional resources',
  'references/starting.md: Starting a session',
  'references/starting.md: When the model changes',
  'references/starting.md: When a start is refused',
  'references/cleanup.md: Cleanup',
  'references/cleanup.md: Which sessions',
  'references/cleanup.md: The steps',
  'references/cleanup.md: Undoing a wrong card',
  'references/cleanup.md: Removing a stopped session for good',
  'references/cleanup.md: What never happens',
  'references/starting.md: Names',
  'references/posting.md: Posting',
  'references/desktop.md: Starting a Desktop session',
  'references/roster.md: The roster',
  'references/roster.md: The call',
  'references/roster.md: When to call it',
  'references/roster.md: The answers',
];

// ---------------------------------------------------------------------------
// The contracts in the tree.
const contractsIn = () => {
  const out = [];
  const skills = join(root, 'skills');
  for (const name of readdirSync(skills, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
    for (const rel of ['CONTRACT.md', 'references/CONTRACT.md']) {
      const file = join(skills, name, rel);
      if (existsSync(file) && lf(readFileSync(file, 'utf8')).includes('\n## schedules\n')) out.push({ name, file, dir: join(skills, name) });
    }
  }
  return out;
};

test('head-chef has a schedules part: 37 schedules, one for each section of SKILL.md and its five references', () => {
  const chef = contractsIn().find(c => c.name === 'head-chef');
  assert.ok(chef, 'the head-chef contract holds a schedules part');
  const found = schedulesOf(lf(readFileSync(chef.file, 'utf8')));
  assert.equal(found.schedules.length, 37);
  assert.match(readFileSync(chef.file, 'utf8'), /^Version: 2\.\d+\.\d+$/m, 'the contract is 2.x');
  // Every schedule listed as Proposed or pending at 1.36.1 is one of them and is Proposed; every
  // other schedule is Confirmed. The count is exact, so a shortened list fails here.
  for (const title of HEAD_CHEF_PENDING) assert.ok(found.schedules.some(s => s.title === title), title);
  assert.equal(HEAD_CHEF_PENDING.length, 34, 'the pending list holds 34 titles');
  assert.equal(new Set(HEAD_CHEF_PENDING).size, 34, 'no title is listed twice');
  for (const s of found.schedules) {
    assert.equal(s.mark, HEAD_CHEF_PENDING.includes(s.title) ? 'Proposed' : 'Confirmed', `${s.title}: its mark follows the list`);
  }
  assert.equal(found.schedules.filter(s => s.mark === 'Confirmed').length, 3, 'three schedules are Confirmed');
});

test('every contract with a schedules part matches its homes (checks 1 to 7)', () => {
  for (const c of contractsIn()) {
    const pending = c.name === 'head-chef' ? HEAD_CHEF_PENDING : [];
    assert.deepEqual(faultsOf(c.file, c.dir, pending), [], `${c.name}: the schedules and their homes`);
  }
});

// ---------------------------------------------------------------------------
// The counter: a small contract and its homes pass, and one fault of each kind
// fails with its message.
const FIXTURE = {
  'SKILL.md': `---
name: demo
description: "Does the demo thing. Use for the demo."
compatibility: Needs a demo.
---

# demo

You do the demo.

## Words

- **Demo:** a demo.

## Rules

- Do it.
`,
  'references/extra.md': `# Extra

Read this before the demo.

\`\`\`text
## not a heading, in a fence
\`\`\`

## More

Some more.
`,
  'references/CONTRACT.md': `# Contract: demo

Version: 1.0.0
Kind: skill
Level: Quick

## purpose

**Description for the built file** (**Confirmed**):

> Does the demo thing. Use for the demo.

## roles

**Do the demo.** It does the demo. *Proposed*: new.

**Keep the rules.** It keeps the rules. *Proposed*: new.

## tools

**Needs** (**Decided**):

> Needs a demo.

## schedules

- SKILL.md: demo. Home: \`SKILL.md\`.

### SKILL.md: demo

Home: \`SKILL.md\`, the section "demo". Carries out: "Do the demo".
*Proposed*: pending at 1.0.0 in "x".

You do the demo.

### SKILL.md: Words

Home: \`SKILL.md\`, the section "Words". Carries out: "Do the demo".
**Confirmed**

- **Demo:** a demo.

### SKILL.md: Rules

Home: \`SKILL.md\`, the section "Rules". Carries out: "Keep the rules".
*Proposed*: pending at 1.0.0 in "y".

- Do it.

### references/extra.md: Extra

Home: \`references/extra.md\`, the section "Extra". Carries out: "Do the demo".
*Proposed*: pending at 1.0.0 in "z".

Read this before the demo.

\`\`\`text
## not a heading, in a fence
\`\`\`

### references/extra.md: More

Home: \`references/extra.md\`, the section "More". Carries out: "Keep the rules".
**Confirmed**

Some more.
`,
};
const PENDING = ['SKILL.md: demo', 'SKILL.md: Rules', 'references/extra.md: Extra'];

function fixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'contract-schedules-'));
  const files = { ...FIXTURE };
  if (mutate) mutate(files);
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}
const run = (mutate, pending = PENDING) => {
  const dir = fixture(mutate);
  try { return faultsOf(join(dir, 'references/CONTRACT.md'), dir, pending); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const edit = (file, from, to) => files => {
  assert.ok(files[file].includes(from), `the fixture holds "${from}"`);
  files[file] = files[file].replace(from, to);
};

test('the fixture contract and its homes pass', () => {
  assert.deepEqual(run(), []);
  // Line ends and trailing blank lines do not count (check 1).
  assert.deepEqual(run(files => { files['SKILL.md'] = files['SKILL.md'].replace(/\n/g, '\r\n') + '\r\n\r\n'; }), []);
});

test('the counter fails each fault, with its message', () => {
  const rows = [
    ['check 1: a schedule differs from its home', edit('SKILL.md', 'You do the demo.', 'You do the demo twice.'), /^check 1: schedule "SKILL\.md: demo" differs from its home section$/],
    ['check 2: a home outside the grammar', edit('references/CONTRACT.md', '### references/extra.md: More', '### references/Extra File.md: More'), /^check 2: schedule "references\/Extra File\.md: More": its home is outside the grammar/],
    ['check 2: the contract as a home, in another letter case', edit('references/CONTRACT.md', '### references/extra.md: More', '### references/Contract.md: More'), /^check 2: .*Contract\.md: More": its home names the contract or its change log$/],
    ['check 2: a Windows device name as a home', edit('references/CONTRACT.md', '### references/extra.md: More', '### references/nul.md: More'), /^check 2: .*nul\.md: More": its home is a Windows device name$/],
    ['check 2: a section the home does not hold', edit('references/CONTRACT.md', '### SKILL.md: Rules', '### SKILL.md: Rule'), /^check 2: schedule "SKILL\.md: Rule": SKILL\.md holds no section of that name$/],
    ['check 3: a section with no schedule', edit('SKILL.md', '## Rules', '## Rules\n\n- Do it.\n\n## Extra rules\n\n- More.\n\n## Last'), /^check 3: SKILL\.md: the section "Extra rules" has no schedule$/],
    ['check 3: a section with two schedules', files => { files['references/CONTRACT.md'] = files['references/CONTRACT.md'].replace('### references/extra.md: More', '### SKILL.md: Rules\n\nHome: `SKILL.md`, the section "Rules". Carries out: "Keep the rules".\n*Proposed*: x.\n\n- Do it.\n\n### references/extra.md: More'); }, /^check 3: SKILL\.md: the section "Rules" has 2 schedules$/],
    ['check 4: a level-3 heading in a home', edit('SKILL.md', 'You do the demo.', 'You do the demo.\n\n### Deeper'), /^check 4: SKILL\.md line \d+ holds a level-3 heading$/],
    ['check 4: a heading line in a schedule', files => { files['SKILL.md'] = files['SKILL.md'].replace('- Do it.', '- Do it.\n\n#### Hidden'); files['references/CONTRACT.md'] = files['references/CONTRACT.md'].replace('- Do it.', '- Do it.\n\n#### Hidden'); }, /^check 4: schedule "SKILL\.md: Rules": its text line \d+ is a heading$/],
    ['check 4: a setext underline in a schedule', files => { for (const f of ['SKILL.md', 'references/CONTRACT.md']) files[f] = files[f].replace('- Do it.', 'A line\n---'); }, /^check 4: schedule "SKILL\.md: Rules": its text line \d+ underlines a line of text as a heading$/],
    ['check 4: a comment in a schedule', files => { for (const f of ['SKILL.md', 'references/CONTRACT.md']) files[f] = files[f].replace('- Do it.', '- Do it. <!-- hidden -->'); }, /^check 4: schedule "SKILL\.md: Rules": its text line \d+ holds "<!" or "<\?"$/],
    ['check 4: a link-reference line in a schedule', files => { for (const f of ['SKILL.md', 'references/CONTRACT.md']) files[f] = files[f].replace('- Do it.', '> [x]: https://example.com'); }, /^check 4: schedule "SKILL\.md: Rules": its text line \d+ is a link-reference definition$/],
    ['check 3: text before a home file\'s first heading', edit('SKILL.md', '---\n\n# demo', '---\n\nA stray rule.\n\n# demo'), /^check 3: SKILL\.md holds text before its first heading$/],
    ['check 3: text before the first heading of a reference', edit('references/extra.md', '# Extra\n', 'A stray rule.\n\n# Extra\n'), /^check 3: references\/extra\.md holds text before its first heading$/],
    ['check 4: a setext underline under a line led by **', files => { for (const f of ['SKILL.md', 'references/CONTRACT.md']) files[f] = files[f].replace('- Do it.', '**Bold line**\n---'); }, /^check 4: schedule "SKILL\.md: Rules": its text line \d+ underlines a line of text as a heading$/],
    ['check 4: a setext underline under a line led by *', files => { for (const f of ['SKILL.md', 'references/CONTRACT.md']) files[f] = files[f].replace('- Do it.', '*Italic line*\n==='); }, /^check 4: schedule "SKILL\.md: Rules": its text line \d+ underlines a line of text as a heading$/],
    ['check 4: a link-reference definition whose target is on the next line', files => { for (const f of ['SKILL.md', 'references/CONTRACT.md']) files[f] = files[f].replace('- Do it.', '[x]:\nhttps://example.com'); }, /^check 4: schedule "SKILL\.md: Rules": its text line \d+ is a link-reference definition$/],
    ['check 2: a Home line that names another section', edit('references/CONTRACT.md', 'the section "Rules". Carries out', 'the section "Words". Carries out'), /^check 2: schedule "SKILL\.md: Rules": its Home line names another home or section$/],
    ['check 2: a home file that is not there', files => { files['references/extra.md'] = null; }, /^check 2: schedule "references\/extra\.md: Extra": its home file is not there$/],
    ['check 2: a heading the home holds twice', edit('SKILL.md', '## Rules\n\n- Do it.\n', '## Rules\n\n- Do it.\n\n## Rules\n\n- Again.\n'), /^check 2: schedule "SKILL\.md: Rules": SKILL\.md holds that heading 2 times$/],
    ['check 6: a body with no Needs clause', edit('references/CONTRACT.md', '**Needs** (**Decided**):', '**Wants** (**Decided**):'), /^check 6: the body holds no compatibility clause$/],
    ['check 6: a body with no description clause', edit('references/CONTRACT.md', '**Description for the built file**', '**Summary for the built file**'), /^check 6: the body holds no description clause$/],
    ['check 5: a mark word is not a label', edit('references/CONTRACT.md', 'Carries out: "Keep the rules".\n*Proposed*: pending at 1.0.0 in "y".', 'Carries out: "Confirmed".\n*Proposed*: pending at 1.0.0 in "y".'), /^check 5: schedule "SKILL\.md: Rules" carries out "Confirmed", which the body does not hold$/],
    ['check 5: a label the body does not hold', edit('references/CONTRACT.md', 'Carries out: "Keep the rules".\n*Proposed*: pending at 1.0.0 in "y".', 'Carries out: "Keep the rulez".\n*Proposed*: pending at 1.0.0 in "y".'), /^check 5: schedule "SKILL\.md: Rules" carries out "Keep the rulez", which the body does not hold$/],
    ['check 5: a schedule that names no clause', edit('references/CONTRACT.md', ' Carries out: "Keep the rules".\n*Proposed*: pending at 1.0.0 in "y".', '\n*Proposed*: pending at 1.0.0 in "y".'), /^check 5: schedule "SKILL\.md: Rules" names no clause it carries out$/],
    ['check 6: a description that differs', edit('SKILL.md', 'Does the demo thing.', 'Does a demo thing.'), /^check 6: SKILL\.md's description differs from the body's clause$/],
    ['check 6: a compatibility line that differs', edit('SKILL.md', 'Needs a demo.', 'Needs two demos.'), /^check 6: SKILL\.md's compatibility differs from the body's clause$/],
    ['check 7: a pending schedule marked Confirmed', edit('references/CONTRACT.md', '*Proposed*: pending at 1.0.0 in "z".', '**Confirmed**'), /^check 7: schedule "references\/extra\.md: Extra" carried text that was Proposed or pending at 1\.36\.1 and is marked Confirmed$/],
  ];
  const missed = [];
  for (const [name, mutate, message] of rows) {
    const found = run(mutate);
    if (!found.some(f => message.test(f))) missed.push(`${name}: wanted ${message}, got ${JSON.stringify(found)}`);
  }
  assert.deepEqual(missed, [], 'every row fails with its message');
});

test('the counter reads a heading inside a code fence as text, and a pending title it cannot find as a fault', () => {
  assert.equal(textFault('```text\n# not a heading\n---\n```'), null);
  assert.match(textFault('# a heading') ?? '', /is a heading/);
  assert.match(run(null, [...PENDING, 'SKILL.md: Nowhere'])[0], /^check 7: "SKILL\.md: Nowhere" is listed as Proposed or pending at 1\.36\.1 and is not in the contract$/);
});
