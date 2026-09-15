// One table of artifact type to renderer, driven through the two root scripts'
// own command lines. The registry is a data table and needs no seam of its own;
// it is exercised through both of the existing ones.
//
// Before it existed, each script hard-coded one glob and one renderer path, so
// a second skill's artifact was validated by nothing and published by nothing,
// and neither script said so. That is the failure these tests hold shut.
//
// Each test copies the parts of the tree the script reads into a temporary
// directory and breaks exactly one thing. The copy is not decoration: each
// script finds the repository root from its own file location, so it cannot be
// pointed at a fixture any other way.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, exampleBox, exampleFlightpath, run } from './helpers.mjs';
import { ARTIFACTS, rowFor, pageNameFor } from '../scripts/lib/registry.mjs';

const work = mkdtempSync(join(tmpdir(), 'grimoire-registry-'));
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;

/** Everything both root scripts read: the scripts, the skills, the manifests. */
function tree() {
  const dir = join(work, `case-${n++}`);
  mkdirSync(dir);
  for (const part of ['scripts', 'skills', '.claude-plugin']) {
    cpSync(join(root, part), join(dir, part), { recursive: true });
  }
  for (const part of ['.gitignore', '.skillspector-baseline.yaml']) {
    cpSync(join(root, part), join(dir, part));
  }
  return dir;
}

const checkIn = dir => join(dir, 'scripts', 'check.mjs');
const buildIn = dir => join(dir, 'scripts', 'build-pages.mjs');
const site = (dir, name) => join(dir, 'site', name);

function writeArtifact(dir, relPath, source, patch) {
  const p = join(dir, relPath);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(source, 'utf8')), ...patch }));
  return p;
}

/* -- the table itself ------------------------------------------------------ */

test('the registry has a row for every skill that ships artifacts', () => {
  // A skill with no row is reported rather than skipped. A gate that quietly
  // does nothing reads as a gate that passed.
  const skills = readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  for (const s of skills) {
    assert.ok(
      ARTIFACTS.some(a => a.renderer.startsWith(`skills/${s}/`)),
      `skills/${s}/ has no registry row`,
    );
  }
});

test('every row names a renderer that is on disk', () => {
  for (const a of ARTIFACTS) assert.ok(existsSync(join(root, ...a.renderer.split('/'))), a.renderer);
});

test('a page name carries the whole repository-relative path, minus the suffix', () => {
  assert.equal(pageNameFor('docs/decisions/x.box.json', rowFor('x.box.json')), 'docs-decisions-x.html');
  assert.equal(
    pageNameFor('skills/groundtrack/examples/y.flightpath.json', rowFor('y.flightpath.json')),
    'skills-groundtrack-examples-y.html',
  );
});

test('a file no row claims is not an artifact', () => {
  assert.equal(rowFor('skills/eagle-eye/box.schema.json'), null);
  assert.equal(rowFor('.claude-plugin/plugin.json'), null);
});

/* -- the check ------------------------------------------------------------- */

test('the check validates a flightpath file, and fails on a broken one', () => {
  const dir = tree();
  const clean = run(checkIn(dir), [], { cwd: dir });
  assert.equal(clean.code, 0, `${clean.stdout}\n${clean.stderr}`);
  assert.match(clean.stdout, /ok\s+skills\/groundtrack\/examples\/greet\.flightpath\.json/);

  // Break exactly one thing: a move that ran a step of another op.
  const prog = JSON.parse(readFileSync(join(dir, 'skills', 'groundtrack', 'examples', 'greet.flightpath.json'), 'utf8'));
  prog.graphs[0].presets[0].trace.steps[0].k = 'var';
  writeFileSync(join(dir, 'skills', 'groundtrack', 'examples', 'greet.flightpath.json'), JSON.stringify(prog));

  const broken = run(checkIn(dir), [], { cwd: dir });
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /greet\.flightpath\.json failed --check/);
  assert.match(broken.stderr, /a "var" move ran step 0, which is a "comment"/);
});

test('the check fails an old-shape flightpath file', () => {
  // A file states one change and lists its graphs. A stale one-graph file has
  // to fail the root check, not only the renderer's own — otherwise it reaches
  // the site build and publishes half of what it means.
  const dir = tree();
  const p = join(dir, 'skills', 'groundtrack', 'examples', 'greet.flightpath.json');
  const prog = JSON.parse(readFileSync(p, 'utf8'));
  prog.entry = prog.graphs[0].entry;
  prog.presets = prog.graphs[0].presets;
  delete prog.graphs;
  writeFileSync(p, JSON.stringify(prog));

  const r = run(checkIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /greet\.flightpath\.json failed --check/);
  assert.match(r.stderr, /this is the old one-graph shape/);
});

function newSkill(dir, name, withExamples) {
  mkdirSync(join(dir, 'skills', name), { recursive: true });
  writeFileSync(
    join(dir, 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A skill added by a test.\n---\n\n# ${name}\n`,
  );
  if (withExamples) {
    mkdirSync(join(dir, 'skills', name, 'examples'), { recursive: true });
    writeFileSync(join(dir, 'skills', name, 'examples', 'README.md'), '# An example\n\nSomething this skill produces.\n');
  }
}

test('the check reports a skill that ships examples and has no row', () => {
  const dir = tree();
  newSkill(dir, 'newcomer', true);
  const r = run(checkIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /skills\/newcomer\/ ships examples\/ and has no row in scripts\/lib\/registry\.mjs/);
});

test('a skill that produces nothing needs no row', () => {
  // A prose-only skill has no renderer for a row to name. Failing it would be
  // an instruction a contributor could follow and still go red.
  const dir = tree();
  newSkill(dir, 'proseonly', false);
  const r = run(checkIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
});

test('the registry rule matches what CONTRIBUTING tells a contributor to do', () => {
  // The two went out of step once: the prose asked for a row from a skill that
  // produces an artifact, and the check asked every skill for one.
  const contributing = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');
  assert.match(contributing, /If it ships an `examples\/` directory/);
});

test('the fixed-path rule covers the new skill, including its non-markdown files', () => {
  const dir = tree();
  const target = join(dir, 'skills', 'groundtrack', 'scripts', 'groundtrack.js');
  writeFileSync(target, `// ~/.claude/skills/groundtrack\n${readFileSync(target, 'utf8')}`);
  const r = run(checkIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /skills\/groundtrack\/scripts\/groundtrack\.js:1 holds a fixed path/);
});

/* -- the site build -------------------------------------------------------- */

test('the site build renders a flightpath page, and the index links it', () => {
  const dir = tree();
  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  const name = 'skills-groundtrack-examples-greet.html';
  const page = readFileSync(site(dir, name), 'utf8');
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /"id":"example-greet"/);
  const index = readFileSync(site(dir, 'index.html'), 'utf8');
  assert.ok(index.includes(`href="./${name}"`), `the index must link ${name}`);
  assert.match(index, /skills\/groundtrack\/examples\/greet\.flightpath\.json/);
  // The index says which kind each page is, now that there is more than one.
  assert.match(index, /class="kind">flightpath</);
  assert.match(index, /class="kind">box</);
});

test('two artifacts of different types sharing a basename both publish', () => {
  // This is the case path keying exists to fix, not to refuse. A test that
  // asserted a refusal here would pin the bug rather than the fix.
  const dir = tree();
  writeArtifact(dir, 'docs/decisions/same.box.json', exampleBox, { title: 'The box one' });
  writeArtifact(dir, 'skills/groundtrack/examples/same.flightpath.json', exampleFlightpath, {
    id: 'same-one',
    title: 'The flightpath one',
  });

  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(readFileSync(site(dir, 'docs-decisions-same.html'), 'utf8'), /<title>[^<]*The box one/);
  assert.match(
    readFileSync(site(dir, 'skills-groundtrack-examples-same.html'), 'utf8'),
    /<title>[^<]*The flightpath one/,
  );
});

test('two paths that flatten to one page name refuse, before anything is rendered', () => {
  const dir = tree();
  writeArtifact(dir, 'grid/one.flightpath.json', exampleFlightpath, { id: 'grid-a', title: 'A' });
  writeArtifact(dir, 'grid-one.flightpath.json', exampleFlightpath, { id: 'grid-b', title: 'B' });

  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /both render to site\/grid-one\.html/);
  assert.ok(!existsSync(join(dir, 'site')), 'the refusal came before anything was written');
});

test('two page names differing only in case refuse, because the filesystem folds case', () => {
  // Two distinct names and one file on the machine this site is built from, so
  // the second page silently replaced the first. The two sources are distinct
  // files on every filesystem; it is the names they flatten to that collide.
  const dir = tree();
  writeArtifact(dir, 'grid/two.flightpath.json', exampleFlightpath, { id: 'lower', title: 'lower' });
  writeArtifact(dir, 'Grid-two.flightpath.json', exampleFlightpath, { id: 'upper', title: 'upper' });

  const r = run(buildIn(dir), [], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /both render to site\/[gG]rid-two\.html/);
});
