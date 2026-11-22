// Setup (docs/spec/incantation.md, S5.5). The person runs it in their own
// terminal, never a session: device and profile names go to that terminal
// only, and it is the one writer of ~/.grimoire/incantation/settings.json.
//
//   node setup.mjs devices                              the stamp and each microphone, by index
//   node setup.mjs profiles                             Voicebox's profiles, by id
//   node setup.mjs choose <index> <stamp> <profile id>  checks all three, pins ffmpeg, writes the settings
//   node setup.mjs runtime plan | install | verify     the speech runtime (docs/spec/0001, S5.9)

import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { findUv, installRuntime, planRuntime, verifyRuntime } from './runtime/install.mjs';
import { listDevices, listingLines, resolveRecorder, stampOf } from './capture/ffmpeg.mjs';
import { loadEngine } from './engines/index.mjs';
import { SETTINGS_DEFAULTS, SETTINGS_KEYS, cleanText, deviceDigest, ensureKey, runDir, secureState, settingsPath, writePrivate } from './lib.mjs';

export const LINES = {
  usage: 'usage: setup.mjs devices | profiles | choose <index> <stamp> <profile id> | runtime plan | install | verify',
  recorder: 'setup: ffmpeg was not found in a trusted folder on PATH. See README step 1.',
  devices: 'setup: ffmpeg listed no microphone. See README step 4.',
  stale: 'setup: the microphone list changed since you listed it. Run setup.mjs devices again.',
  index: 'setup: there is no microphone with that index.',
  voicebox: 'setup: Voicebox is not answering on this machine. Start it: README step 1.',
  profile: 'setup: Voicebox has no profile with that id. Run setup.mjs profiles.',
  state: 'setup: the ~/.grimoire/incantation folder is not private or not a plain folder. See README step 3.',
  failed: 'setup: could not save the settings.',
  saved: 'setup: saved. Run /incantation in a session.',
};

// A fresh `choose` writes this engine (S13.10). Settings with no engine key read
// as voicebox, as they always did: SETTINGS_DEFAULTS.engine is that reading.
export const FRESH_ENGINE = 'sherpa';

// uv, run by the installer: no shell, no window, a named environment and the
// runtime folder as its working folder, all handed in. Its own words are not
// printed: they carry paths.
const runUv = (file, args, { cwd, env }) =>
  new Promise(resolve =>
    execFile(file, args, { cwd, env, shell: false, windowsHide: true, timeout: 40 * 60_000, maxBuffer: 10_000_000, encoding: 'utf8' }, (error, stdout) =>
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout ?? '' }),
    ),
  );

// `setup.mjs runtime plan | install | verify` (S5.9). plan and verify print
// their lines at once; install prints a line per file and per part through
// `o.log` as it goes (it runs as a background command) and returns none of its
// own then.
async function runtimeCommand(args, o, platform) {
  const arch = o.arch ?? process.arch;
  if (args.length !== 1 || !['plan', 'install', 'verify'].includes(args[0])) return { lines: [LINES.usage], code: 2 };
  if (args[0] === 'verify') return verifyRuntime({ home: o.home, platform, arch });
  const find = () => findUv({ platform, pathValue: o.pathValue, startDir: o.startDir, fs: o.fs });
  if (args[0] === 'plan') return { lines: planRuntime({ home: o.home, platform, arch, uv: find() }).lines, code: 0 };
  const done = await installRuntime({ home: o.home, platform, arch, pathValue: o.pathValue, startDir: o.startDir, fs: o.fs, env: o.env ?? process.env, runUv: o.runUv ?? runUv, transport: o.transport, free: o.free, log: o.log });
  return { lines: o.log ? [] : done.lines, code: done.code };
}

const runListing = cwd => (file, args) =>
  new Promise(resolve =>
    execFile(file, args, { cwd, shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && (error.code === 'ENOENT' || error.killed)) return resolve(null);
      resolve(`${stdout ?? ''}\n${stderr ?? ''}`);
    }),
  );

// Everything a test replaces comes in through `o`: the platform, the PATH
// value, the start folder, the recorder's file system and listing, the engine.
// Returns the lines to print and the exit code.
export async function runSetup(argv, o) {
  const platform = o.platform ?? process.platform;
  const [command, ...args] = argv;
  if (!['devices', 'profiles', 'choose', 'runtime'].includes(command)) return { lines: [LINES.usage], code: 2 };
  try {
    secureState(o.home, { platform });
  } catch {
    return { lines: [LINES.state], code: 1 };
  }
  if (command === 'runtime') return runtimeCommand(args, o, platform);
  const engine = o.engine ?? (await loadEngine(FRESH_ENGINE, { port: SETTINGS_DEFAULTS.port }));
  const recorderOf = () => resolveRecorder({ platform, pathValue: o.pathValue, startDir: o.startDir, fs: o.fs });
  const listOf = async recorder => listDevices({ recorder, platform, run: o.list ?? runListing(runDir(o.home)) });

  if (command === 'profiles') {
    const profiles = await engine.profiles();
    if (!profiles) return { lines: [LINES.voicebox], code: 1 };
    return { lines: profiles.filter(p => SETTINGS_KEYS.profile(p.id)).map(p => `${p.id} ${cleanText(p.name, 64)}${p.engine ? ` (${cleanText(p.engine, 32)})` : ''}`), code: 0 };
  }
  const recorder = recorderOf();
  if (!recorder) return { lines: [LINES.recorder], code: 1 };
  const { devices } = await listOf(recorder);
  if (!devices.length) return { lines: [LINES.devices], code: 1 };
  if (command === 'devices') return { lines: listingLines(devices), code: 0 };

  if (args.length !== 3 || !/^\d{1,3}$/.test(args[0]) || !/^[0-9a-f]{16}$/.test(args[1])) return { lines: [LINES.usage], code: 2 };
  const index = Number(args[0]);
  if (args[1] !== stampOf(devices)) return { lines: [LINES.stale], code: 1 };
  if (index >= devices.length) return { lines: [LINES.index], code: 1 };
  if (!SETTINGS_KEYS.profile(args[2])) return { lines: [LINES.profile], code: 1 };
  const profiles = await engine.profiles();
  if (!profiles) return { lines: [LINES.voicebox], code: 1 };
  if (!profiles.some(p => p.id === args[2])) return { lines: [LINES.profile], code: 1 };
  // The mic is kept as keyed digests of its id and name, never as text (S13.5);
  // the key is made at the first choose and stays, so older digests keep matching.
  const key = ensureKey(o.home, { platform });
  const settings = { ...SETTINGS_DEFAULTS, engine: FRESH_ENGINE, profile: args[2], device: { index, stamp: args[1], id: deviceDigest(key, devices[index].id), name: deviceDigest(key, devices[index].name) }, recorder };
  for (const [k, v] of Object.entries(settings)) if (!SETTINGS_KEYS[k](v)) return { lines: [LINES.usage], code: 2 };
  writePrivate(settingsPath(o.home), `${JSON.stringify(settings, null, 2)}\n`, { platform });
  return { lines: [LINES.saved], code: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    result = await runSetup(process.argv.slice(2), { home: homedir(), pathValue: process.env.PATH ?? process.env.Path, startDir: process.cwd(), env: process.env, log: l => process.stdout.write(`${l}\n`) });
  } catch (e) {
    result = { lines: [e?.message === 'state' ? LINES.state : LINES.failed], code: 1 };
  }
  process.stdout.write(`${result.lines.join('\n')}\n`, () => process.exit(result.code));
}
