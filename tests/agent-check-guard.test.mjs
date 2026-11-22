// Tests of scripts/agent-check-guard.mjs, the PreToolUse hook that makes an
// agent run `athanor run check` before `node scripts/check.mjs` on the host
// (issue 377). The seam is decide(): the hook input in, a refusal or null
// out. Further tests spawn the script as Claude Code does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../scripts/agent-check-guard.mjs';

const present = async () => true;
const missing = async () => false;
const ask = (command, { tool = 'Bash', athanorPresent = present } = {}) =>
  decide({ tool_name: tool, tool_input: { command }, cwd: '/work' }, { athanorPresent });

// Every form the issue names, plus the ones lens review added. Each is a real
// way to start the host check, and a miss passes falsely.
const FORMS = [
  'node scripts/check.mjs',
  'node ./scripts/check.mjs',
  'node scripts\\check.mjs',
  'node .\\scripts\\check.mjs',
  'node "scripts/check.mjs"',
  "node './scripts/check.mjs'",
  'node "scripts\\check.mjs"',
  'node /work/repo/scripts/check.mjs',
  'node C:\\work\\repo\\scripts\\check.mjs',
  'node.exe scripts/check.mjs',
  '"node" scripts/check.mjs',
  'cd repo && node scripts/check.mjs',
  'cd repo; node scripts/check.mjs',
  'git status\nnode scripts/check.mjs',
  'node scripts/check.mjs | tee out.txt',
  '& node scripts/check.mjs',
  'FOO=1 node scripts/check.mjs',
  'timeout 600 node scripts/check.mjs',
  'node --disable-warning=X scripts/check.mjs',
  'sleep 1 & node scripts/check.mjs',
  '(node scripts/check.mjs)',
  'env FOO=1 node scripts/check.mjs',
  'time node scripts/check.mjs',
  'call node scripts/check.mjs',
  'node scripts/check.mjs 2>&1',
  'node scripts/check.mjs 2>&1 | tail -5',
  'node scripts/check.mjs &> out.txt',
  '$out = node scripts/check.mjs',
  'if ($true) { node scripts/check.mjs }',
  'Measure-Command { node scripts/check.mjs }',
];

// The direct host test run (issue GRIM-48): `node --test` over the repo's tests,
// bare or behind a wrapper. It runs the whole suite on the host, which is the
// memory the check's container exists to hold.
// One case per command form; the wrappers and shells the older tests cover are
// not repeated here.
const TEST_FORMS = [
  'node --test',
  'node --test tests/x.test.mjs',
  'node --test --test-name-pattern=foo tests/x.test.mjs',
  'node --test-reporter=spec --test tests/x.test.mjs',
  'mise x -- node --test tests/x.test.mjs',
  'mise exec -- node --test tests/x.test.mjs',
  'mise x node@22 -- node --test tests/x.test.mjs',
  'npx node --test tests/x.test.mjs',
  'npx -y node --test tests/x.test.mjs',
];

for (const form of TEST_FORMS) {
  test(`${JSON.stringify(form)} is refused while athanor is present, with the check's refusal`, async () => {
    const out = await ask(form);
    assert.ok(out, 'expected a refusal');
    assert.equal(out.reason, (await ask('node scripts/check.mjs')).reason);
  });
}

test('a host test run is refused in PowerShell too', async () => {
  assert.ok(await ask('& node --test tests/x.test.mjs', { tool: 'PowerShell' }));
});

test('the flag with a reason lets a host test run through, and an empty one does not', async () => {
  assert.equal(await ask('node --test tests/x.test.mjs --host-fallback=docker-down'), null);
  assert.equal(await ask('mise x -- node --test tests/ --host-fallback="exit 137 from athanor"'), null);
  assert.ok(await ask('node --test tests/x.test.mjs --host-fallback='));
});

for (const tool of ['Bash', 'PowerShell']) {
  for (const form of FORMS) {
    test(`${tool}: ${JSON.stringify(form)} is refused while athanor is present`, async () => {
      const out = await ask(form, { tool });
      assert.ok(out, 'expected a refusal');
      assert.match(out.reason, /athanor run check/);
      for (const code of ['124', '125', '137']) assert.match(out.reason, new RegExp(code));
    });
  }
}

test('a line continuation joins the two lines, in the shell that has it', async () => {
  assert.ok(await ask('node \\\nscripts/check.mjs'));
  assert.ok(await ask('node `\nscripts/check.mjs', { tool: 'PowerShell' }));
});

test('PowerShell does not escape a quote with a backslash, so a path ending in one closes its quote', async () => {
  assert.ok(await ask('Set-Location "C:\\x\\"; node scripts/check.mjs', { tool: 'PowerShell' }));
});

test('every form passes while athanor is missing', async () => {
  for (const form of FORMS) assert.equal(await ask(form, { athanorPresent: missing }), null, form);
});

test('the flag with a reason lets the host check through, with athanor present', async () => {
  assert.equal(await ask('node scripts/check.mjs --host-fallback=docker-down'), null);
  assert.equal(await ask('node scripts/check.mjs 2>&1 --host-fallback=docker-down'), null);
  assert.equal(await ask('node scripts/check.mjs --host-fallback="exit 137 from athanor"'), null);
});

test('an empty flag reason is no flag', async () => {
  assert.ok(await ask('node scripts/check.mjs --host-fallback='));
  assert.ok(await ask('node scripts/check.mjs --host-fallback=""'));
});

test('the flag on another segment does not cover the check', async () => {
  assert.ok(await ask('echo --host-fallback=x; node scripts/check.mjs'));
});

test('the probe runs only for a host check', async () => {
  let probes = 0;
  const athanorPresent = async () => { probes++; return true; };
  await ask('ls -la', { athanorPresent });
  await ask('git commit -m "node scripts/check.mjs"', { athanorPresent });
  assert.equal(probes, 0);
  await ask('node scripts/check.mjs', { athanorPresent });
  assert.equal(probes, 1);
});

test('commands that are not the host check pass untouched', async () => {
  const passes = [
    'athanor run check',
    'athanor run check --untracked',
    'athanor run fast',
    'node scripts/build-pages.mjs',
    'node scripts/check.mjs.bak',
    'node scripts/build-pages.mjs --test',
    'node --version',
    'mise x -- node scripts/build-pages.mjs',
    'npx prettier --test tests/x.test.mjs',
    'echo node --test tests/',
    'git commit -m "run node --test tests/ on the host"',
    'ls tests/x.test.mjs',
    'node other/check.mjs',
    'node myscripts/check.mjs',
    'node xscripts\\check.mjs',
    'echo scripts/check.mjs.bak',
    'echo node scripts/check.mjs',
    'ls scripts/check.mjs',
    'cat scripts/check.mjs',
    'git commit -m "Run node scripts/check.mjs on the host"',
    "git commit -m 'node scripts/check.mjs'",
    'gh pr create --title t --body "run node scripts/check.mjs first"',
    'git commit -m "say \\"hi\\" then node scripts/check.mjs"',
    "git commit -F - <<'EOF'\nnode scripts/check.mjs\nEOF",
    "gh issue comment 1 --body @'\nnode scripts/check.mjs\n'@",
    '',
  ];
  for (const command of passes) assert.equal(await ask(command), null, JSON.stringify(command));
});

test('a tool other than the two shells, and input that is not a command, pass', async () => {
  assert.equal(await ask('node scripts/check.mjs', { tool: 'Read' }), null);
  assert.equal(await decide({ tool_name: 'Bash', tool_input: {} }, { athanorPresent: present }), null);
  assert.equal(await decide({ tool_name: 'Bash', tool_input: { command: 7 } }, { athanorPresent: present }), null);
  assert.equal(await decide(null, { athanorPresent: present }), null);
  assert.equal(await decide('node scripts/check.mjs', { athanorPresent: present }), null);
});

test('an unclosed quote is tokenised to its end and a probe that throws passes', async () => {
  assert.ok(await ask('node scripts/check.mjs "unclosed'));
  const athanorPresent = async () => { throw new Error('boom'); };
  assert.equal(await ask('node scripts/check.mjs', { athanorPresent }), null);
});

test('the refusal is fixed text: nothing from the command is echoed', async () => {
  const out = await ask('node scripts/check.mjs SECRET_TOKEN_abc123');
  assert.ok(out);
  assert.doesNotMatch(out.reason, /SECRET_TOKEN_abc123/);
  assert.equal(out.reason, (await ask('node scripts/check.mjs')).reason);
});

test('the refusal names the fallback flag and the local-engine rule', async () => {
  const { reason } = await ask('node scripts/check.mjs');
  assert.match(reason, /--host-fallback=<reason>/);
  assert.match(reason, /local/i);
  assert.match(reason, /Docker engine/);
  assert.match(reason, /uncommitted/);
  assert.match(reason, /own words/);
});

// The presence probe and the script as Claude Code runs it. A fake `athanor`
// goes on a temporary PATH the way tests/practice-fake.mjs puts a fake claude
// there: a .cmd on Windows, which is what an npm install leaves, and a script
// elsewhere. The fake never starts the real tool.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after } from 'node:test';
import { probeAthanor } from '../scripts/agent-check-guard.mjs';
import { root } from './helpers.mjs';

const guard = join(root, 'scripts', 'agent-check-guard.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'grimoire-guard-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;
const folder = () => {
  const dir = join(scratch, `case-${made++}`);
  mkdirSync(dir);
  return dir;
};

// What each fake athanor does when it runs. `ok` prints a version, `dangling`
// is mise's message for a shim that points nowhere, `hang` records its own
// process id and then never returns.
const BODIES = {
  ok: "console.log('0.1.0');",
  dangling: "console.error('mise ERROR athanor is not a valid shim.'); process.exit(1);",
  noversion: "console.log('this is not athanor');",
  hang: "import('node:fs').then(fs => fs.writeFileSync(new URL('./pid.txt', import.meta.url), String(process.pid))); setInterval(() => {}, 1000);",
};

// A folder holding a fake athanor, and the PATH value that finds it.
function fake(kind) {
  const dir = folder();
  writeFileSync(join(dir, 'fake.mjs'), BODIES[kind]);
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'athanor.cmd'), `@"${process.execPath}" "%~dp0fake.mjs" %*\r\n`);
  } else {
    writeFileSync(join(dir, 'athanor'), `#!/bin/sh\nexec "${process.execPath}" "${dir}/fake.mjs" "$@"\n`);
    chmodSync(join(dir, 'athanor'), 0o755);
  }
  return dir;
}

// A stand-in that writes a marker file where it runs, as a planted file would.
function planted(dir) {
  const marker = join(dir, 'marker.txt');
  if (process.platform === 'win32') writeFileSync(join(dir, 'athanor.cmd'), `@echo planted> "${marker}"\r\n`);
  else {
    writeFileSync(join(dir, 'athanor'), `#!/bin/sh\necho planted > "${marker}"\n`);
    chmodSync(join(dir, 'athanor'), 0o755);
  }
  return marker;
}

// The machine's own NoDefaultCurrentDirectoryInExePath is taken out, so the
// probe stands on what it sets itself and a machine that sets it hides nothing.
const envWith = path => {
  const env = { ...process.env, PATH: path };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[k];
  return env;
};

test('the probe finds a working athanor', async () => {
  assert.equal(await probeAthanor({ env: envWith(fake('ok')) }), true);
});

test('a dangling shim counts as athanor missing', async () => {
  assert.equal(await probeAthanor({ env: envWith(fake('dangling')) }), false);
});

test('a program that exits 0 without printing a version is not athanor', async () => {
  assert.equal(await probeAthanor({ env: envWith(fake('noversion')) }), false);
});

test('no athanor on PATH counts as missing', async () => {
  assert.equal(await probeAthanor({ env: envWith(folder()) }), false);
});

test('a hang ends at the limit, and the child and its tree are gone', async () => {
  const dir = fake('hang');
  const started = Date.now();
  assert.equal(await probeAthanor({ env: envWith(dir), limitMs: 1500 }), false);
  assert.ok(Date.now() - started < 10000, 'the probe returned at its limit');
  const pidFile = join(dir, 'pid.txt');
  assert.ok(existsSync(pidFile), 'the fake started');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 100 && alive(); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(alive(), false, 'the hung child is gone');
});

// The probe's fixed folder and its switch against the current-folder lookup
// back each other up, so this test fails only when both are gone; the claim is
// that a planted file never runs, and either one keeps it true.
test('a file planted in the working folder is never run', async () => {
  const dir = folder();
  const marker = planted(dir);
  const before = process.cwd();
  process.chdir(dir);
  try {
    // With a working athanor later on PATH, the probe still finds that one.
    assert.equal(await probeAthanor({ env: envWith(fake('ok')) }), true);
    assert.equal(existsSync(marker), false, 'the planted file ran with athanor on PATH');
    // With none on PATH, the planted one is not found, so athanor is missing.
    assert.equal(await probeAthanor({ env: envWith(folder()) }), false);
    assert.equal(existsSync(marker), false, 'the planted file ran with no athanor on PATH');
  } finally {
    process.chdir(before);
  }
});

test('outside Windows a PATH with an empty or relative entry runs nothing and counts as missing', async () => {
  const dir = fake('ok');
  const stand = folder();
  const marker = planted(stand);
  for (const path of ['', `${dir}${delimiter}`, `${delimiter}${dir}`, `${dir}${delimiter}bin`, `${dir}${delimiter}.`, `${stand}${delimiter}bin`]) {
    assert.equal(await probeAthanor({ env: { PATH: path }, platform: 'linux' }), false, JSON.stringify(path));
  }
  assert.equal(existsSync(marker), false, 'a stand-in on an absolute entry beside a relative one ran');
});

// The script as the hook runs it.
const hook = (input, path) => spawnSync(process.execPath, [guard], {
  input: typeof input === 'string' ? input : JSON.stringify(input),
  env: envWith(path),
  encoding: 'utf8',
});
const call = (command, tool = 'Bash') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd: scratch });

test('the script prints the documented refusal and exits 0', () => {
  for (const tool of ['Bash', 'PowerShell']) {
    const r = hook(call('node scripts/check.mjs', tool), fake('ok'));
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /athanor run check/);
  }
});

test('every pass is silent: exit 0, nothing on either stream', () => {
  const working = fake('ok');
  const cases = [
    [call('node scripts/check.mjs --host-fallback=docker-down'), working],
    [call('ls -la'), working],
    [call('athanor run check'), working],
    [call('node scripts/check.mjs'), folder()],
    [call('node scripts/check.mjs'), fake('dangling')],
    [{ tool_name: 'Read', tool_input: { file_path: 'x' } }, working],
    ['{"tool_name": "Bash", "tool_input": {"command": "SECRET_TOKEN_abc123', working],
    ['not json at all SECRET_TOKEN_abc123', working],
    ['', working],
    ['null', working],
  ];
  for (const [input, path] of cases) {
    const r = hook(input, path);
    assert.equal(r.status, 0, JSON.stringify(input));
    assert.equal(r.stdout, '', JSON.stringify(input));
    assert.equal(r.stderr, '', JSON.stringify(input));
  }
});

test('the script holds no explicit decision other than the refusal', () => {
  // An explicit allow from a hook skips the owner's permission prompt, so the
  // script holds no such word, nor the other answers a hook can give.
  const source = readFileSync(guard, 'utf8');
  for (const word of ['allow', 'ask', 'updatedInput', 'additionalContext']) {
    assert.doesNotMatch(source, new RegExp(`['"\`]${word}['"\`]`), word);
  }
});
