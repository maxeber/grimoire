#!/usr/bin/env node
// eagle-eye renderer. Zero dependencies. Box file in, one self-contained HTML page out.
//
//   node render.mjs <box.json> [--out <page.html>] [--check] [--sel <restore code>]
//
//   --check   validate and print the findings for the chosen set; write nothing
//   --sel     print the findings for a configuration ("eagle-eye: opt-id, opt-id"), write nothing
//
// Validation is hand-rolled (no ajv): the checks below ARE the schema. box.schema.json documents the same shape.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const EagleEye = require(resolve(here, 'lib/eagle-eye.js'));

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? true) : undefined; };
// Each argument is judged at its own index. This looked the index up with
// args.indexOf(a), which finds the first occurrence by value rather than the
// position being examined, so a repeated value made the guard read the wrong
// neighbour. Brute-forced over every argv combination up to length 5: 304
// parse differently from a positional implementation, and 48 of those select
// the wrong file — `--out p p q` read q when the box the user named was p.
const boxPath = args.find((a, i) => !a.startsWith('--') && !['--out', '--sel'].includes(args[i - 1]));
const usage = () => { console.error('usage: node render.mjs <box.json> [--out page.html] [--check] [--sel "eagle-eye: ids"]'); process.exit(2); };
if (!boxPath) usage();
// A flag that takes a value has two ways to arrive without one: last on the
// line, where `flag` returns the boolean true, or followed by another flag.
// --out already tested for the first; --sel tested for neither.
//
// A bare trailing --sel reached findings() and called a string method on a
// boolean: "TypeError: code.replace is not a function". `--sel --check` was
// worse — findings() read "--check" as a restore code and threw an uncaught
// "unknown option" with a stack trace. Both belong at the usage line.
//
// A restore code never begins with --, so treating a following flag as a
// missing value costs nothing. Every occurrence is checked, not the first.
// Checked here, with the other argument errors, so it does not depend on the
// box being readable — and it exits 2, the code a missing box path produces.
const missingValue = n => args.some((a, i) => a === n && (args[i + 1] === undefined || args[i + 1].startsWith('--')));
if (missingValue('--sel') || missingValue('--out')) usage();
// A second --sel is refused, as the audit refuses it. `flag` reads the first and the audit's loop
// read the last, so a line with two named a different set in each script.
if (args.filter(a => a === '--sel').length > 1) usage();

const TIERS = new Set(['measured', 'sourced', 'argued']);
const KINDS = new Set(['conf', 'req']);
const ID = /^[a-z0-9][a-z0-9-]*$/;

function validate(box) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  if (!box || typeof box !== 'object') return { errors: ['box is not an object'], warnings };
  if (typeof box.title !== 'string' || !box.title.trim()) err('title: required, non-empty string');
  // The brief. `problem` is the only place the box says what the whole set is for. A row's own
  // `problem` explains one decision; nothing explained the set, so a reader who opens the page
  // after a context switch found row names and a grid. Refused, not warned: the row-level warning
  // is the proof that a warning leaves a field unwritten. `who` and `when` are optional, and each
  // is one plain sentence — no people model, no dates parsed. A blank one is refused rather than
  // ignored, so the schema's "non-empty string" is what this code enforces.
  if (typeof box.problem !== 'string' || !box.problem.trim())
    err(
      'problem: required, non-empty string — say what this box decides, in plain words, for a reader who does not know the domain. Without it a reader who returns later sees row names and a grid, and no question. Add "who" for the people it affects and "when" for the date it must be settled. Both are optional, and "not known" is a valid when. See SKILL.md, "The brief".',
    );
  ['who', 'when'].forEach(f => {
    if (box[f] !== undefined && (typeof box[f] !== 'string' || !box[f].trim()))
      err(`${f}: must be a non-empty string — leave the field out rather than write a blank one`);
  });
  if (!Array.isArray(box.dims) || !box.dims.length) err('dims: required, non-empty array');
  if (!box.rel || typeof box.rel !== 'object') err('rel: required object keyed by option id');
  if (errors.length) return { errors, warnings };

  const dimIds = new Set(), optIds = new Map();
  box.dims.forEach((d, i) => {
    const at = `dims[${i}]`;
    if (!ID.test(d.id || '')) err(`${at}.id: must match ${ID}`);
    if (dimIds.has(d.id)) err(`${at}.id "${d.id}": duplicate`); dimIds.add(d.id);
    if (typeof d.name !== 'string' || !d.name.trim()) err(`${at}.name: required`);
    // A row name is a handle, not an explanation: "Reachable by whom" tells a newcomer nothing.
    // `problem` is the only part of a row no derivation can supply, so its absence is warned, loudly.
    if (d.problem !== undefined && (typeof d.problem !== 'string' || !d.problem.trim())) err(`${at}.problem: must be a non-empty string`);
    else if (!d.problem) warn(`${at} "${d.name}": no problem — say in plain words what this row decides, for a reader outside the domain.`);
    else if (d.problem.split(/\s+/).length < 25) warn(`${at} "${d.name}": problem is ${d.problem.split(/\s+/).length} words. Two to five sentences give a newcomer the stakes.`);
    if (!Array.isArray(d.opts) || d.opts.length < 2) err(`${at}.opts: at least two options`);
    else {
      const chosen = d.opts.filter(o => o.chosen);
      if (chosen.length !== 1) err(`${at} "${d.name}": exactly one option must be chosen (found ${chosen.length})`);
      d.opts.forEach((o, j) => {
        const oat = `${at}.opts[${j}]`;
        if (!ID.test(o.id || '')) err(`${oat}.id: must match ${ID}`);
        if (optIds.has(o.id)) err(`${oat}.id "${o.id}": duplicate`); optIds.set(o.id, d.id);
        if (typeof o.label !== 'string' || !o.label.trim()) err(`${oat}.label: required`);
        // `short` is the name the agent says in chat. Without it the only handle is the id, and an
        // id names nothing to a reader — the failure that produced this check. Refused, not warned:
        // a warning leaves the name optional, and the missing name is invisible until somebody is lost.
        if (typeof o.short !== 'string' || !o.short.trim()) err(`${oat} "${o.id}": short: required. This is the name spoken in chat; an id is not a name. See SKILL.md, "Names in chat".`);
        else if (o.short.length > 28) warn(`${oat}.short "${o.short}": longer than 28 chars; the sheet cell will wrap`);
        // A chosen strawman is not an error. The "strawman not rejected" finding says:
        // give the reason to reject it, or pick it. Picking it is the documented outcome
        // and the most interesting one — the weak option survived the whole grid.
        // The flag records coverage (none / opposite / later / by hand), never quality,
        // so it must stay set after the author picks the option. This was an error until
        // a real decision hit it and could not be written down. Warn instead.
        if (o.strawman && o.chosen) warn(`${oat} "${o.id}": a strawman is the chosen option — say in its notes why it survived`);
        if (!o.strawman && !o.src) warn(`${oat} "${o.id}": no src — where was this option proposed?`);
      });
      if (!d.opts.some(o => o.strawman)) warn(`${at} "${d.name}": no strawman. Did you ask: none / opposite / later / by hand?`);
    }
  });

  let edgeCount = 0, argued = 0;
  Object.entries(box.rel).forEach(([id, r]) => {
    if (!optIds.has(id)) { err(`rel["${id}"]: no such option`); return; }
    if (typeof r.why !== 'string' || !r.why.trim()) err(`rel["${id}"].why: required — what this option is and why it was on the table`);
    if (r.notes && !Array.isArray(r.notes)) err(`rel["${id}"].notes: must be an array of strings`);
    (r.rel || []).forEach((e, k) => {
      const at = `rel["${id}"].rel[${k}]`;
      if (!Array.isArray(e) || e.length < 3) { err(`${at}: must be [targetId, "conf"|"req", why, tier?, src?]`); return; }
      const [to, kind, why, tier = 'argued', src] = e;
      if (!optIds.has(to)) err(`${at}: target "${to}" is not an option`);
      else if (optIds.get(to) === optIds.get(id)) err(`${at}: target "${to}" is in the same row — a swap, not an edge`);
      if (!KINDS.has(kind)) err(`${at}: kind "${kind}" must be conf or req`);
      if (typeof why !== 'string' || !why.trim()) err(`${at}: why is required — an edge without a reason colours the grid on nothing`);
      else if (why.split(/\s+/).length > 25) warn(`${at}: why is ${why.split(/\s+/).length} words; STE asks for 20`);
      if (!TIERS.has(tier)) err(`${at}: tier "${tier}" must be measured, sourced or argued`);
      if (tier !== 'argued' && !src) err(`${at}: a ${tier} edge must name its src (what was measured, which document)`);
      edgeCount++; if (tier === 'argued') argued++;
    });
  });
  optIds.forEach((dimId, id) => { if (!box.rel[id]) warn(`option "${id}": no rel entry — no why, no edges`); });
  if (box.suspected && !Array.isArray(box.suspected)) err('suspected: must be an array of strings');

  // Presets are required. A box nobody can walk is a grid nobody reads: the reader opens the page,
  // sees the chosen set, and has no idea which other configuration is worth looking at. At least one
  // preset must *change* an option, so the reader meets a second configuration rather than one tour
  // of the baseline. See SKILL.md, "Presets".
  if (!Array.isArray(box.presets)) err('presets: required — at least two, and at least one must change an option (see SKILL.md, "Presets")');
  else {
    if (box.presets.length < 2) err(`presets: at least two required (found ${box.presets.length}). Suggested set: a baseline walk, then a stress preset — the break test, the strawman run, the cheap route or the strict route. See SKILL.md, "Presets".`);
    box.presets.forEach((p, i) => {
      if (!p.title) err(`presets[${i}].title: required`);
      if (!Array.isArray(p.steps) || !p.steps.length) err(`presets[${i}].steps: required`);
      else p.steps.forEach((s, j) => {
        if (!s.label) err(`presets[${i}].steps[${j}].label: required`);
        if (s.set) Object.entries(s.set).forEach(([d, o]) => { if (!dimIds.has(d)) err(`presets[${i}].steps[${j}].set: no dim "${d}"`); else if (optIds.get(o) !== d) err(`presets[${i}].steps[${j}].set: "${o}" is not an option of "${d}"`); });
        if (s.open && !dimIds.has(s.open)) err(`presets[${i}].steps[${j}].open: no dim "${s.open}"`);
      });
      if (!p.text) warn(`presets[${i}] "${p.title}": no text — say in one sentence what this configuration shows.`);
      // `reframe` is optional and says what the problem becomes under this configuration. `text` says
      // what the configuration shows, which is a different sentence. A blank one is refused rather
      // than ignored, so the schema's "non-empty string" is what this code enforces.
      if (p.reframe !== undefined && (typeof p.reframe !== 'string' || !p.reframe.trim()))
        err(`presets[${i}].reframe: must be a non-empty string — say what the problem becomes here, or leave the field out`);
    });
    if (!box.presets.some(p => (p.steps || []).some(s => s.set && Object.keys(s.set).length)))
      err('presets: every preset only walks the chosen set. At least one must carry a "set" step, so the reader meets a configuration that is not the baseline.');
  }
  return { errors, warnings, stats: { dims: box.dims.length, opts: optIds.size, edges: edgeCount, argued, strawmen: box.dims.reduce((n, d) => n + d.opts.filter(o => o.strawman).length, 0) } };
}

function findings(box, code) {
  const { optById } = EagleEye.index(box);
  // The parser is the library's, so the audit reads the same code the same way. An unknown id is a
  // usage error, exit 2, as it is in the audit. It was an uncaught throw: exit 1 and a stack trace.
  let parsed;
  try { parsed = EagleEye.parseSel(box, code); } catch (e) { console.error(`--sel: ${e.message}`); process.exit(2); }
  const { sel, touched } = parsed;
  const r = EagleEye.analyse(box, sel, touched), strip = s => { let p, o = String(s); do { p = o; o = o.replace(/<[^>]+>/g, ''); } while (o !== p); return o; };
  // The brief leads, because the findings are about something. An agent reads this output and says
  // it in chat, and a reader who meets "conflict: Coach layer vs Depth control" without the problem
  // learns which two rows exclude each other, and never what turns on it. `who` and `when` print when
  // the box carries them. This is also the only surface a test can reach: the page writes the
  // export, and no test at this command line can read a browser.
  const L = [`problem: ${box.problem}`];
  if (box.who) L.push(`who: ${box.who}`);
  if (box.when) L.push(`when: ${box.when}`);
  L.push(`verdict: ${r.verdict}` + (r.overrides.length ? ` (${r.overrides.length} change${r.overrides.length === 1 ? '' : 's'}; active edges ${r.basis.map(([t, n]) => `${n} ${t}`).join(', ')})` : ''));
  r.conflicts.forEach(e => L.push(`  conflict: ${optById[e.from].dim.name}: ${optById[e.from].short || optById[e.from].label} vs ${optById[e.to].dim.name}: ${optById[e.to].short || optById[e.to].label} — ${e.why} [${e.tier}]`));
  r.unmet.forEach(e => L.push(`  not met: ${optById[e.from].dim.name} requires ${optById[e.to].dim.name}: ${optById[e.to].short || optById[e.to].label} — ${e.why} [${e.tier}]`));
  // "row not opened" measures a reader clicking rows on the page. The command line has no such act:
  // `touched` here only ever holds the rows --sel changed, so the finding fires on every configuration
  // and tells you to do a thing this surface cannot do. Drop it here; the page still reports it.
  r.moves.filter(m => m.kind !== 'row not opened').forEach(m => L.push(`  ${m.kind}: ${strip(m.text)}`));
  return L.join('\n');
}

// ---- main ----
let box;
try { box = JSON.parse(readFileSync(boxPath, 'utf8')); } catch (e) { console.error(`cannot read ${boxPath}: ${e.message}`); process.exit(2); }
const { errors, warnings, stats } = validate(box);
warnings.forEach(w => console.error(`warning: ${w}`));
if (errors.length) { errors.forEach(e => console.error(`error: ${e}`)); process.exit(1); }
console.error(`ok: ${box.title} — ${stats.dims} decisions, ${stats.opts} options, ${stats.edges} edges (${stats.argued} argued), ${stats.strawmen} strawmen`);

if (flag('--check') || flag('--sel') !== undefined) {
  console.log(findings(box, flag('--sel')));
  process.exit(0);
}

const template = readFileSync(resolve(here, 'lib/template.html'), 'utf8');
const module = readFileSync(resolve(here, 'lib/eagle-eye.js'), 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');

// The Aviation design system, vendored whole. One file, no imports: tokens,
// both themes, the dark layer, the av-* vocabulary and the av-tool-* report
// chrome. It is inlined rather than linked for the same reason the faces below
// are — a rendered page is one file and must stand on its own. See
// assets/FONTS.md, and do not edit the bundle in place.
const aviation = readFileSync(resolve(here, 'assets/aviation.bundle.css'), 'utf8');

// The faces, IBM's own subsets, inlined as data URIs so the page makes no
// network request at all. The table and the rule are in lib/faces.js, which
// scripts/build-pages.mjs reads as well — see the comment there for why the
// unicode-range is not optional and why there is only one copy of it.
const { FACES, faceRule } = require(resolve(here, 'lib/faces.js'));
const faces = FACES.map(([weight, file, range]) =>
  faceRule(weight, range, readFileSync(resolve(here, 'assets', file)).toString('base64')),
).join('\n');

// JSON inside <script>: escape "</" so a why containing "</script>" cannot close the block
const data = JSON.stringify(box).replace(/<\//g, '<\\/');
// Function replacements, and this is load-bearing rather than style. A *string*
// replacement is interpreted: `$&`, `` $` `` and `$'` stand for the match and
// the text on either side of it. So box text carrying one of those splices a
// slab of the template into the middle of the page — including the template's
// own real "</script>", which is precisely what the escape on the line above
// cannot help with, because that tag never passed through the box. A function
// replacement is inserted literally and has no patterns at all.
const html = template
  .replace('/*TITLE*/', () => box.title.replace(/[<>&]/g, ''))
  .replace('/*AVIATION*/', () => aviation)
  .replace('/*FONTS*/', () => faces)
  .replace('/*DATA*/', () => data)
  .replace('/*MODULE*/', () => module);
// The default page is named .local.html, not .html. A default render writes
// beside the box file, and a box file that lives in a repository left an
// untracked page there every time — four in the maintainer's working tree when
// this was found. .gitignore already carries *.local.*, so the default name
// sits inside a rule the repository has rather than one it has to grow, and
// the rule reads as what it is: this file was generated, do not commit it.
// An explicit --out is untouched, and is what the site build passes.
const out = flag('--out') && flag('--out') !== true ? resolve(flag('--out')) : resolve(dirname(resolve(boxPath)), basename(boxPath).replace(/\.box\.json$|\.json$/, '') + '.local.html');
writeFileSync(out, html);
console.error(`wrote ${out}`);
console.log(findings(box));
