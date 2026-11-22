// The setup check (docs/spec/incantation.md, S5.6; W10; T18). Node built-ins only.
//
//   node guard.mjs   prints `ok`, or the first failure and the README step that fixes it
//
// It runs before the listener at each start. It never prints an address, a
// path or a setting's value: every line it prints is one of LINES.

import { connect } from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveRecorder } from './capture/ffmpeg.mjs';
import { isEngine, loadEngine } from './engines/index.mjs';
import { readSettings, secureState } from './lib.mjs';
import { checkRuntime, platformKey } from './runtime/install.mjs';

const CONNECT_MS = 500;
const DEADLINE_MS = 2000;

export const LINES = {
  node: 'guard: Node 24 or later is needed. See README step 1.',
  settings: 'guard: the settings are missing or out of range. Run /incantation install.',
  engine: 'guard: the speech engine in the settings is not one Incantation knows. Run /incantation install.',
  state: 'guard: the ~/.grimoire/incantation folder is not private or not a plain folder. Run /incantation install.',
  health: 'guard: Voicebox is not answering on this machine. Start it: README step 1.',
  runtime: 'guard: the speech runtime is not installed, or a file of it is missing or the wrong size. Run /incantation install.',
  reach: 'guard: Voicebox answers on an address other than this machine. See README step 2.',
  recorder: 'guard: ffmpeg is not where setup found it, or is not trusted. Run /incantation install.',
  late: 'guard: the check took too long. See README step 1.',
};

class Fail extends Error {
  constructor(key) {
    super(key);
    this.line = LINES[key];
  }
}
const fail = key => {
  throw new Fail(key);
};

function tcpOpen(host, port) {
  return new Promise(resolve => {
    const s = connect({ host, port, timeout: CONNECT_MS });
    const done = ok => {
      s.destroy();
      resolve(ok);
    };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

const externalAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter(a => a && !a.internal)
    .map(a => a.address);

async function check(o) {
  const platform = o.platform ?? process.platform;
  const major = Number(String(o.nodeVersion ?? process.versions.node).split('.')[0]);
  if (!(major >= 24)) fail('node');
  let settings;
  try {
    settings = readSettings(o.home, { platform });
  } catch (e) {
    return fail(e.message === 'state' ? 'state' : 'settings');
  }
  if (!isEngine(settings.engine)) fail('engine');
  try {
    secureState(o.home, { platform, create: false });
  } catch {
    fail('state');
  }
  let engine;
  try {
    engine = o.engine ?? (await loadEngine(settings.engine, settings));
  } catch {
    return fail('engine');
  }
  // An installed part with a missing or short file is a fault for either engine
  // (sizes only; `setup.mjs runtime verify` re-hashes). The sherpa engine also
  // needs the whole core.
  const runtime = (o.checkRuntime ?? checkRuntime)(o.home, platformKey(platform, o.arch ?? process.arch));
  if (runtime.damaged.length) fail('runtime');
  if (!(await engine.health())) fail(engine.name === 'sherpa' ? 'runtime' : 'health');
  // The port is Voicebox's: the sherpa engine opens none.
  if (engine.name !== 'sherpa') {
    const reached = await Promise.all((o.addresses ?? externalAddresses)().map(a => (o.tcpOpen ?? tcpOpen)(a, settings.port)));
    if (reached.some(Boolean)) fail('reach');
  }
  const recorder = resolveRecorder({ platform, pathValue: o.pathValue, startDir: o.startDir, fs: o.fs });
  if (!recorder || recorder !== settings.recorder) fail('recorder');
  return 'ok';
}

// The one line the guard prints. Every error, a parse error included, becomes a fixed line.
export async function runGuard(options = {}) {
  let timer;
  const late = new Promise(resolve => {
    timer = setTimeout(() => resolve(LINES.late), DEADLINE_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([check(options), late]);
  } catch (e) {
    return e instanceof Fail ? e.line : LINES.settings;
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let line;
  try {
    line = await runGuard({ home: homedir(), projectDir: process.cwd(), pathValue: process.env.PATH ?? process.env.Path, startDir: process.cwd() });
  } catch {
    line = LINES.settings;
  }
  process.stdout.write(`${line}\n`, () => process.exit(line === 'ok' ? 0 : 1));
}
