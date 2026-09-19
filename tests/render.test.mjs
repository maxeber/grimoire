// The renderer, at the seam a reader and an agent actually use: the command
// line. `scripts/check.mjs` already proves a box file renders without
// throwing. It cannot prove the page is right, and it cannot prove a crafted
// box file fails to inject script. These tests do both.
//
// Every valid-path test reads the box file the skill already ships. Nothing
// here commits a fixture: check.mjs and build-pages.mjs both walk the whole
// tree for *.box.json, so a fixture on disk would either fail the check or be
// published to the public site. Boxes that must be malformed are written to a
// temporary directory and deleted.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderer, exampleBox, run } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-render-'));
after(() => rmSync(work, { recursive: true, force: true }));

// The smallest box the validator accepts. Two rows, one chosen option in each,
// one edge, two presets of which one changes an option.
function box(patch = {}) {
  return {
    title: 'A box',
    problem: 'A box needs one statement of what it decides. This one decides nothing; it exists so a test has a valid box to break.',
    dims: [
      {
        id: 'one',
        name: 'Row one',
        opts: [
          { id: 'a1', label: 'Option A1', short: 'A1', chosen: true, src: 'test' },
          { id: 'a2', label: 'Option A2', short: 'A2', strawman: true },
        ],
      },
      {
        id: 'two',
        name: 'Row two',
        opts: [
          { id: 'b1', label: 'Option B1', short: 'B1', chosen: true, src: 'test' },
          { id: 'b2', label: 'Option B2', short: 'B2', strawman: true },
        ],
      },
    ],
    rel: {
      a1: { why: 'The first option, because something', rel: [['b2', 'conf', 'A1 rules B2 out']] },
      a2: { why: 'The strawman for row one' },
      b1: { why: 'The first option of row two' },
      b2: { why: 'The strawman for row two' },
    },
    presets: [
      { title: 'Baseline', text: 'The chosen set.', steps: [{ label: 'Look' }] },
      { title: 'Stress', text: 'One change.', steps: [{ label: 'Change row one', set: { one: 'a2' } }] },
    ],
    ...patch,
  };
}

function write(name, value) {
  const p = join(work, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

test('--check leads with the brief, then names the chosen verdict', () => {
  // The brief leads because the findings are about something. This is also the
  // only surface a test can reach: the page writes the export, and no test at
  // this command line can read a browser.
  const r = run(renderer, [exampleBox, '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^problem: This box designs the eagle-eye skill/);
  assert.match(r.stdout, /^who: The author of the skill/m);
  assert.match(r.stdout, /^when: Before the skill shipped/m);
  assert.match(r.stdout, /^verdict: as chosen/m);
  assert.match(r.stderr, /^ok: /m);
});

test('--check writes no page', () => {
  const page = exampleBox.replace(/\.box\.json$/, '.html');
  const before = existsSync(page);
  run(renderer, [exampleBox, '--check']);
  assert.equal(existsSync(page), before);
});

test('--sel reads a configuration back and reports the conflict it creates', () => {
  // This is the round trip the skill is built on: the page writes a restore
  // code, and the renderer reads the same code back to the same verdict.
  const r = run(renderer, [exampleBox, '--sel', 'eagle-eye: build-prompt']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^verdict: does not hold \(1 change/m);
  assert.match(r.stdout, /conflict: Who drives it: Round-tripped vs How it is built: Prompt-only/);
});

test('--sel with no change returns the chosen verdict, not a changed one', () => {
  const r = run(renderer, [exampleBox, '--sel', 'eagle-eye: none']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^verdict: as chosen/m);
});

test('the evidence finding names the rows whose active edges are all argued', () => {
  // The count alone says the verdict is unevidenced and never says where to
  // The count alone says the verdict is unevidenced and never says where to
  // measure. These are the addresses: a row whose selected cell touches active
  // edges, and every one of them is argued.
  // The helper's only edge rules out an option nobody selected, which closes
  // that option rather than making the edge active. Point it at the chosen
  // cell instead.
  const b = box();
  b.rel.a1.rel = [['b1', 'req', 'A1 needs B1']];
  const r = run(renderer, [write('argued-rows.box.json', b), '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /evidence for the verdict: .*The active edges at Row one, Row two are all argued./);
});

test('the evidence finding counts the rows instead of naming them when the list is long', () => {
  // The shipped example is the case this rule exists for. Almost every edge in
  // it is argued, so naming every row with one is an instruction to open ten
  // rows, which nobody follows. One sentence with a count is the report that
  // can be read.
  const r = run(renderer, [exampleBox, '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /evidence for the verdict: .*The active edges at 7 of 13 rows are all argued./);
  assert.equal(r.stdout.includes('Measure those rows first'), false);
});

test('the evidence finding names no row when every active edge carries evidence', () => {
  const b = box();
  b.rel.a1.rel = [['b1', 'req', 'A1 needs B1', 'sourced', 'the box schema']];
  const r = run(renderer, [write('sourced-rows.box.json', b), '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /evidence for the verdict: Every active edge carries evidence/);
  assert.equal(r.stdout.includes('are all argued'), false);
});

test('the evidence finding names no row that carries one evidenced edge', () => {
  // A row is named only when every active edge at it is argued. One sourced
  // edge on the same cell leaves the row out, even though the box still has an
  // argued edge to report.
  const b = box();
  b.rel.a1.rel = [['b1', 'req', 'A1 needs B1', 'sourced', 'the box schema']];
  b.rel.b1.rel = [['a1', 'req', 'B1 needs A1']];
  const r = run(renderer, [write('mixed-rows.box.json', b), '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /evidence for the verdict: 1 of 2 active edges is argued/);
  assert.equal(r.stdout.includes('are all argued'), false);
});

test('the renderer no longer prints the finding under its term of art', () => {
  // The tag is one string in the analysis module, and the page, the exported
  // Markdown and this command all print whatever it says. `cogency` stays in
  // the reference document and reaches no reader here.
  const r = run(renderer, [exampleBox, '--check']);
  assert.equal(r.stdout.includes('cogency'), false);
});

test('--sel refuses an option id that is not in the box', () => {
  const r = run(renderer, [exampleBox, '--sel', 'eagle-eye: no-such-option']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /no-such-option/);
});

// ---- chains ----
// The chain finding reads the join between two edges, over the whole box. A
// chain needs three rows: an edge out of row one, an edge out of row two, and
// the far option in row three. Each test writes the edges it needs and reads
// the finding back off the command line.
function chainBox(rel) {
  const row = (id, name, p) => ({ id, name, opts: [
    { id: `${p}1`, label: `Option ${p}1`, short: `${p.toUpperCase()}1`, chosen: true, src: 'test' },
    { id: `${p}2`, label: `Option ${p}2`, short: `${p.toUpperCase()}2`, strawman: true },
  ] });
  return {
    title: 'A chain box',
    problem: 'A box needs one statement of what it decides. This one decides nothing; it carries the edges a chain test needs.',
    dims: [row('one', 'Row one', 'a'), row('two', 'Row two', 'b'), row('three', 'Row three', 'c')],
    rel: Object.fromEntries(Object.entries(rel).map(([id, edges]) => [id, { why: `The reason for ${id}`, rel: edges }])),
    presets: [
      { title: 'Baseline', text: 'The chosen set.', steps: [{ label: 'Look' }] },
      { title: 'Stress', text: 'One change.', steps: [{ label: 'Change row one', set: { one: 'a2' } }] },
    ],
  };
}

const checkChain = (name, rel) => run(renderer, [write(name, chainBox(rel)), '--check']).stdout;

test('two req edges derive a requires relation, and the finding names the path', () => {
  const out = checkChain('chain-req.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['c1', 'req', 'B1 needs C1']],
  });
  assert.match(out, /chain: Row one: A1 requires Row three: C1, through Row two: B1\./);
  assert.match(out, /The box does not state it/);
  assert.match(out, /weakest edge on the path is argued/);
});

test('a req edge closed by a conf edge derives a rules out relation', () => {
  const out = checkChain('chain-conf.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['c1', 'conf', 'B1 rules C1 out']],
  });
  assert.match(out, /chain: Row one: A1 rules out Row three: C1, through Row two: B1\./);
});

test('a conf edge starts no chain', () => {
  // The rule the whole finding turns on: a conf removes the target from the
  // set, so the target's own edges never fire and compose with nothing.
  const out = checkChain('chain-conf-first.box.json', {
    a1: [['b1', 'conf', 'A1 rules B1 out']],
    b1: [['c1', 'req', 'B1 needs C1']],
  });
  assert.equal(/chain:/.test(out), false, out);
});

test('two options that require each other are one cycle, reported once', () => {
  const out = checkChain('chain-cycle.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['a1', 'req', 'B1 needs A1']],
  });
  assert.match(out, /cycle: Row one: A1 and Row two: B1 require each other/);
  assert.equal((out.match(/cycle:/g) || []).length, 1, out);
  assert.equal(/chain:/.test(out), false, out);
});

test('a loop of three options reports one cycle and no chain', () => {
  // Going round the loop derives a relation between two of its options. That
  // relation is the loop said again, so only the cycle is reported — the same
  // answer a two-option loop gives, where the walk never gets far enough to
  // derive anything.
  const out = checkChain('chain-three-loop.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['c1', 'req', 'B1 needs C1']],
    c1: [['a1', 'req', 'C1 needs A1']],
  });
  assert.match(out, /cycle: Row one: A1, Row two: B1 and Row three: C1 require each other/);
  assert.equal(/chain:/.test(out), false, out);
});

test('a derived relation between two options of one row is not reported', () => {
  // A2 is the other option of A1's row. Choosing one option in a row already
  // excludes its siblings, so the pair derives nothing worth saying.
  const out = checkChain('chain-same-row.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['a2', 'req', 'B1 needs A2']],
  });
  assert.equal(/chain:/.test(out), false, out);
});

test('an edge back onto the path derives nothing, so no option is its own step', () => {
  // A1 requires B1, B1 requires C1, and C1 rules B1 out. The conf edge closes back
  // onto an option the path already holds, so the only relation it could derive
  // names B1 as a step on the way to B1. The box contradicts itself, which is a
  // finding this one does not make.
  const out = checkChain('chain-back-edge.box.json', {
    a1: [['b1', 'req', 'A1 needs B1']],
    b1: [['c1', 'req', 'B1 needs C1']],
    c1: [['b1', 'conf', 'C1 rules B1 out']],
  });
  assert.match(out, /chain: Row one: A1 requires Row three: C1, through Row two: B1\./);
  assert.equal(/rules out Row two: B1/.test(out), false, out);
});

test('a derived relation the box already states is reported as stated', () => {
  const out = checkChain('chain-stated.box.json', {
    a1: [['b1', 'req', 'A1 needs B1'], ['c1', 'req', 'A1 needs C1 as well']],
    b1: [['c1', 'req', 'B1 needs C1']],
  });
  assert.match(out, /The box states this relation/);
});

// The example's one chain ran through "Opt-in predict requires Skill +
// renderer". The #96 audit moved that edge to suspected as insufficient: it
// also rules out the full command-line tool, and nothing in the box says why.
// No req-first join is left, so the example reports no chain. The synthetic
// boxes above still drive every chain rule.
test('the shipped example box reports no chain and no cycle', () => {
  const out = run(renderer, [exampleBox, '--check']).stdout;
  assert.equal(/chain:/.test(out), false, out);
  assert.equal(/cycle:/.test(out), false, out);
});

test('--out writes the page with the box and the module inside it', () => {
  const out = join(work, 'page.html');
  const r = run(renderer, [exampleBox, '--out', out]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, new RegExp(`wrote .*${'page.html'.replace('.', '\\.')}`));
  const html = readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/i);
  // The three substitutions the renderer makes: title, box data, module.
  assert.match(html, /<title>[^<]*eagle-eye<\/title>/);
  assert.match(html, /const BOX = \{/);
  assert.match(html, /const EagleEye = \(\(\) => \{/);
});

test('a default render writes a page the repository already ignores', () => {
  // With no --out the page landed beside the box as <name>.html, and
  // .gitignore covers site/ but not that. Every default render left an
  // untracked file in the working tree — four in the maintainer's checkout at
  // the time. .gitignore already carries *.local.*, so the default name lands
  // inside a rule the repository has rather than one it has to grow.
  const p = write('defaulted.box.json', box());
  const r = run(renderer, [p]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(join(work, 'defaulted.html')), false, 'the untracked name must not come back');
  assert.equal(existsSync(join(work, 'defaulted.local.html')), true);
  assert.match(r.stderr, /wrote .*defaulted\.local\.html/);
});

test('the page loads no code from anywhere else', () => {
  // "Self-contained" is the claim README and SECURITY.md make, and it is now
  // true without an asterisk. This test used to pin the external reference
  // count at exactly ONE and name it — a Google Fonts stylesheet the page fell
  // back from when it failed. The faces are vendored and inlined instead, so
  // the count is zero and this test is what keeps a convenience link from
  // creeping back.
  //
  // Widened to match tests/groundtrack-render.test.mjs, which was already the
  // stricter of the pair. The old version looked only at src and href on a
  // script, link or img element; a CSS @import, a url(), a fetch or a socket
  // would each have been a way out that it stayed green for.
  const out = join(work, 'external.html');
  run(renderer, [exampleBox, '--out', out]);
  const html = readFileSync(out, 'utf8');
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /\bsrc\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /\bhref\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
  assert.equal(/<script[^>]+src=/i.test(html), false, 'no script is loaded from a URL');
  // The faces are here instead, inlined: two subsets for each of three weights,
  // each under the unicode-range IBM declares for it. The brace matters — the
  // vendored design-system bundle's header explains in prose that a stylesheet
  // cannot embed a binary, so a bare /@font-face/ would count that sentence.
  assert.equal((html.match(/@font-face\{/g) || []).length, 6);
  assert.equal((html.match(/src:url\(data:font\/woff2;base64,/g) || []).length, 6);
  assert.equal((html.match(/unicode-range:/g) || []).length, 6);
});

test('the page carries no leftover module.exports line', () => {
  // render.mjs strips it with a regex anchored to the end of the file. If a
  // line is ever added after it, the strip misses and the page throws on load.
  const out = join(work, 'stripped.html');
  run(renderer, [exampleBox, '--out', out]);
  assert.equal(readFileSync(out, 'utf8').includes('module.exports = EagleEye'), false);
});

test('a box whose text closes the script block cannot close it', () => {
  // The threat SECURITY.md names: a .box.json you did not write becomes an
  // HTML page you open. The box JSON is written inside a <script> block, and
  // the first "</script>" in that block ends it — whatever the quotes say.
  const payload = '</script><script>window.__pwned = 1;</script>';
  const clean = join(work, 'clean.html');
  run(renderer, [write('clean.box.json', box()), '--out', clean]);

  const b = box();
  b.rel.a1.why = `A reason containing ${payload} in the middle`;
  const out = join(work, 'injected.html');
  const r = run(renderer, [write('injected.box.json', b), '--out', out]);
  assert.equal(r.code, 0);
  const html = readFileSync(out, 'utf8');

  // The payload is in the page, so this test cannot pass by the text being
  // dropped. It is there with the slash escaped, which no parser reads as a
  // closing tag.
  assert.ok(html.includes('window.__pwned'), 'the payload should reach the page, escaped');
  assert.ok(html.includes('<\\/script>'), 'the closing tag should be written with an escaped slash');

  // Only "</script>" ends a script block. The payload's opening tag sits
  // inside a JavaScript string and does nothing, so the count that matters is
  // the closing one: the injected page must close exactly as many blocks as
  // the same box closes without the payload.
  const closes = s => (readFileSync(s, 'utf8').match(/<\/script\s*>/gi) || []).length;
  assert.equal(closes(out), closes(clean), 'the payload closed no script block');
});

test('box text cannot splice the template through a replacement pattern', () => {
  // The same threat by a route the escape above cannot see. render.mjs composes
  // the page with String.prototype.replace, and a *string* replacement is
  // interpreted: `$&` is the match, "$`" is everything before it and `$'` is
  // everything after. So a box carrying one of those inserts a slab of the
  // template into the page — including the template's own real "</script>",
  // which never passed through the box and so was never escaped.
  //
  // The test above plants "</script>" and stays green whichever way this is
  // written, because it only ever asks about text that came from the box. This
  // one asks whether the *template* can be made to arrive somewhere it should
  // not, which is the question that was not being asked.
  const clean = join(work, 'pattern-clean.html');
  run(renderer, [write('pattern-clean.box.json', box()), '--out', clean]);

  for (const pattern of ["$'", '$`', '$&', '$$']) {
    const b = box();
    b.title = `A box ${pattern} titled`;
    b.rel.a1.why = `A reason containing ${pattern} in the middle`;

    const out = join(work, 'pattern.html');
    const r = run(renderer, [write('pattern.box.json', b), '--out', out]);
    assert.equal(r.code, 0, `${pattern} should still render`);
    const html = readFileSync(out, 'utf8');

    // One page, not one and a fragment of another. A spliced template shows up
    // as a second copy of the document's own tail.
    const count = (re) => (html.match(re) || []).length;
    assert.equal(count(/<\/html\s*>/gi), 1, `${pattern} duplicated the document`);
    assert.equal(
      count(/<\/script\s*>/gi),
      (readFileSync(clean, 'utf8').match(/<\/script\s*>/gi) || []).length,
      `${pattern} changed how many script blocks the page closes`,
    );

    // And the pattern reaches the page as itself, so this cannot pass by the
    // text being stripped on the way in.
    assert.ok(html.includes(pattern), `${pattern} should reach the page literally`);
  }
});

test('a finding cannot carry markup out of a row name, an option name or an edge reason', () => {
  // The same threat one layer in. A finding is built as an HTML string and the
  // page writes it with innerHTML, so every piece of box text inside one is
  // markup unless the finding escapes it first.
  //
  // The seam is the command line, where each finding prints through `strip`.
  // `strip` deletes a real tag and leaves an escaped one alone, so an
  // unescaped payload arrives with its tags gone and an escaped payload
  // arrives whole. The assertions below fail on a renderer that does not
  // escape, rather than passing on one.
  const b = box();
  b.dims[0].name = 'Row <i>one-pwn</i>';
  b.dims[1].name = 'Row <i>two-pwn</i>';
  b.dims[0].opts[1].short = 'A2 <i>opt-pwn</i>';
  b.dims[1].opts[1].short = 'B2 <i>straw-pwn</i>';
  // A third row with no edges either way, which is the only way to fire "row with no edges".
  b.dims.push({
    id: 'three',
    name: 'Row <i>free-pwn</i>',
    opts: [
      { id: 'c1', label: 'Option C1', short: 'C1', chosen: true, src: 'test' },
      { id: 'c2', label: 'Option C2', short: 'C2', strawman: true },
    ],
  });
  b.rel.a2 = { why: 'The strawman for row one', rel: [['b1', 'conf', 'A2 <i>why-pwn</i> rules B1 out']] };
  b.rel.c1 = { why: 'The first option of row three' };
  b.rel.c2 = { why: 'The strawman for row three' };

  const r = run(renderer, [write('finding-markup.box.json', b), '--sel', 'eagle-eye: a2']);
  assert.equal(r.code, 0);

  // One payload per interpolation the findings make: the two row names and the
  // reason in "weakest edge", the option name in "most connected", the
  // edge-free row name in "row with no edges", and the strawman's name in
  // "strawman not rejected".
  for (const payload of ['one-pwn', 'two-pwn', 'why-pwn', 'opt-pwn', 'free-pwn', 'straw-pwn']) {
    assert.ok(
      r.stdout.includes(`&lt;i>${payload}&lt;/i>`),
      `${payload} should reach the finding escaped, not as a tag:\n${r.stdout}`,
    );
  }
});

test('a title cannot carry markup into the head', () => {
  // The title is the one piece of box text the renderer writes outside a
  // script block, so it gets its own guard: < > and & are removed, not
  // escaped. Nothing else in the page interpolates box text into markup.
  const b = box({ title: 'Break <img src=x onerror=alert(1)> out' });
  const out = join(work, 'title.html');
  run(renderer, [write('title.box.json', b), '--out', out]);
  const head = readFileSync(out, 'utf8').split('</head>')[0];
  assert.equal(/<img/i.test(head), false);
  assert.match(head, /<title>Break img src=x onerror=alert\(1\) out — eagle-eye<\/title>/);
});

test('a box with two chosen options in one row is refused, and no page is written', () => {
  const b = box();
  b.dims[0].opts[1].chosen = true;
  const src = write('two-chosen.box.json', b);
  const r = run(renderer, [src]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /exactly one option must be chosen \(found 2\)/);
  assert.equal(existsSync(src.replace(/\.box\.json$/, '.html')), false);
});

test('an edge to an option that does not exist is refused', () => {
  const b = box();
  b.rel.a1.rel = [['ghost', 'conf', 'points at nothing']];
  const r = run(renderer, [write('ghost-edge.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /target "ghost" is not an option/);
});

test('a measured edge that names no source is refused', () => {
  // The tier system is the skill's honesty claim. An edge may say it was
  // measured only if it says what was measured.
  const b = box();
  b.rel.a1.rel = [['b2', 'conf', 'A1 rules B2 out', 'measured']];
  const r = run(renderer, [write('unsourced.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /a measured edge must name its src/);
});

test('an option with no short name is refused, because an id is not a name', () => {
  const b = box();
  delete b.dims[0].opts[0].short;
  const r = run(renderer, [write('no-short.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /short: required/);
});

test('a box whose presets never change an option is refused', () => {
  const b = box();
  b.presets = [
    { title: 'One', text: 'A walk.', steps: [{ label: 'Look' }] },
    { title: 'Two', text: 'Another walk.', steps: [{ label: 'Look again' }] },
  ];
  const r = run(renderer, [write('flat-presets.box.json', b)]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /At least one must carry a "set" step/);
});

test('a box with no problem statement is refused, and no page is written', () => {
  // The failure this field exists for: a reader opens a kept box weeks later
  // and finds rows, a grid, and no sentence saying what is being decided. A
  // row's own `problem` explains one decision; nothing explained the set.
  const b = box();
  delete b.problem;
  const src = write('no-problem.box.json', b);
  const r = run(renderer, [src]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^error: problem: required/m);
  assert.equal(existsSync(src.replace(/\.box\.json$/, '.html')), false);
});

test('the refusal names the field, says what to write and why, and says where to read more', () => {
  // An author must be able to fix this without opening render.mjs. The why is
  // the part a message usually drops: it says what the reader loses without
  // the field, not only that the field is absent.
  const b = box();
  delete b.problem;
  const r = run(renderer, [write('no-problem-message.box.json', b)]);
  assert.match(r.stderr, /say what this box decides/);
  assert.match(r.stderr, /sees row names and a grid, and no question/);
  assert.match(r.stderr, /the people it affects/);
  assert.match(r.stderr, /the date it must be settled/);
  assert.match(r.stderr, /SKILL\.md, "The brief"/);
});

test('a problem statement of whitespace is refused, as the schema says', () => {
  // The schema states minLength 1 and the pattern \S. The renderer trims. The
  // two must agree, or the documented shape is not the enforced one.
  const r = run(renderer, [write('blank-problem.box.json', box({ problem: ' \n\t ' }))]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^error: problem: required/m);
});

test('a box with a problem and no who and no when renders', () => {
  // Who and when are optional. The brief is not a form.
  const out = join(work, 'brief-only.html');
  const r = run(renderer, [write('brief-only.box.json', box()), '--out', out]);
  assert.equal(r.code, 0);
  assert.equal(existsSync(out), true);
});

test('who and when are accepted, and a blank one is refused rather than ignored', () => {
  const ok = run(renderer, [
    write('who-when.box.json', box({ who: 'The two maintainers.', when: 'Not known.' })),
    '--check',
  ]);
  assert.equal(ok.code, 0);

  for (const field of ['who', 'when']) {
    const r = run(renderer, [write(`blank-${field}.box.json`, box({ [field]: '  ' })), '--check']);
    assert.equal(r.code, 1, `a blank ${field} should be refused`);
    assert.match(r.stderr, new RegExp(`^error: ${field}: `, 'm'));
  }
});

test('a row with no problem statement still warns, and the box renders', () => {
  // The row-level field keeps the treatment it had. Only the box-level one is
  // refused, and the two messages name different places.
  const b = box();
  b.dims[0].problem = undefined;
  const r = run(renderer, [write('row-no-problem.box.json', b), '--check']);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /^warning: dims\[0\] "Row one": no problem/m);
});

test('the findings name who and when only when the box carries them', () => {
  // The brief is not a form. A box with a problem and nothing else prints one
  // brief line, and no empty labels.
  const plain = run(renderer, [write('brief-plain.box.json', box()), '--check']);
  assert.equal(plain.code, 0);
  assert.match(plain.stdout, /^problem: A box needs one statement/);
  assert.equal(/^who:/m.test(plain.stdout), false);
  assert.equal(/^when:/m.test(plain.stdout), false);

  const full = run(renderer, [
    write('brief-full.box.json', box({ who: 'The two maintainers.', when: 'Not known.' })),
    '--check',
  ]);
  assert.match(full.stdout, /^who: The two maintainers\.$/m);
  assert.match(full.stdout, /^when: Not known\.$/m);
});

test('a preset may carry a reframe sentence, and a blank one is refused', () => {
  // `text` says what the configuration shows. `reframe` says what the problem
  // becomes there. They are two sentences, so they are two fields.
  const b = box();
  b.presets[1].reframe = 'The problem becomes a question about row one alone.';
  const ok = run(renderer, [write('reframe.box.json', b), '--check']);
  assert.equal(ok.code, 0);

  const blank = box();
  blank.presets[1].reframe = '   ';
  const r = run(renderer, [write('blank-reframe.box.json', blank), '--check']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^error: presets\[1\]\.reframe: must be a non-empty string/m);
});

test('a box whose presets carry no reframe renders unchanged', () => {
  // The field is optional, so every box that rendered before this one still
  // renders. The shipped example is the box a reader opens first.
  const out = join(work, 'no-reframe.html');
  const r = run(renderer, [write('no-reframe.box.json', box()), '--out', out]);
  assert.equal(r.code, 0);
  assert.equal(existsSync(out), true);
});

test('unreadable JSON exits 2, not 1', () => {
  // 2 is "I could not read the file", 1 is "I read it and it is wrong". A
  // caller that cannot tell those apart reports a typo as a broken box.
  const p = join(work, 'broken.box.json');
  writeFileSync(p, '{ not json');
  const r = run(renderer, [p]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cannot read/);
});

test('no box path at all exits 2 with the usage line', () => {
  const r = run(renderer, []);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: node render\.mjs/);
});

test('a --sel whose value is another flag exits 2, not a stack trace', () => {
  // The first guard tested only for --sel last on the line. `--sel --check`
  // handed findings() the string "--check" as a restore code, which threw an
  // uncaught "unknown option" and printed a stack trace — the same failure the
  // guard was written to remove, one argument shape over.
  const r = run(renderer, [exampleBox, '--sel', '--check']);
  assert.equal(r.code, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /usage: node render\.mjs/);
  assert.equal(/unknown option|at Object|at Module/.test(r.stderr), false, 'a usage error is not a crash');
});

test('a --sel that does carry a restore code still works', () => {
  // The guard reads a following flag as a missing value. A restore code never
  // begins with --, so this is the case that must not regress.
  const r = run(renderer, [write('sel-ok.box.json', box()), '--sel', 'eagle-eye: a2']);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /verdict:/);
});

test('a repeated argument value does not move the box path', () => {
  // The box-path finder looked each candidate's index up by value, which
  // returns the first occurrence and not the position under examination. When
  // a value repeats, the guard read the wrong neighbour. Brute-forced over
  // every argv combination up to length 5: 304 parse differently from a
  // positional implementation, and 48 of those select the wrong file.
  //
  // This is the reported case, `--out p p q`, with --check so that nothing is
  // written: p is the box, and the broken parse read q.
  const p = write('repeated-p.box.json', box({ title: 'The named box' }));
  const q = write('repeated-q.box.json', box({ title: 'The other box' }));
  const r = run(renderer, ['--out', p, p, q, '--check']);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^ok: The named box /m);
  assert.equal(/The other box/.test(r.stderr), false, 'the tool must not read a file the user did not name');
});

test('a --sel with no value exits 2 with the usage line, not a stack trace', () => {
  // The flag reader returns the boolean true when a flag is last and carries
  // no value. --out guarded against that and --sel did not, so a bare trailing
  // --sel reached the findings function, which calls a string method on a
  // boolean: "TypeError: code.replace is not a function", where the usage line
  // belongs. 2 is the code a missing box path already produces.
  const r = run(renderer, [exampleBox, '--sel']);
  assert.equal(r.code, 2, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /usage: node render\.mjs/);
  assert.equal(/TypeError/.test(r.stderr), false, 'a usage error is not a crash');
});
