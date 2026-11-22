// Tests of the incantation skill's text (docs/spec/incantation.md, claims 1
// and 15, and the amendments from the prototype's trial). This file holds the
// lines that must be there, and the ones that must not. The two "0001" tests
// are the first two claims of the change that brought the prototype in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKILL = join(ROOT, 'skills', 'incantation');
const EVALS = join(ROOT, 'evals', 'incantation');
const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');

const filesUnder = dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath ?? e.path, e.name));

// The skill's prose files: SKILL.md and every markdown file under references/.
const prose = () => [['SKILL.md', text], ...filesUnder(join(SKILL, 'references')).filter(f => f.endsWith('.md')).map(f => [f.slice(SKILL.length + 1), readFileSync(f, 'utf8')])];
const section = (from, to) => text.slice(text.indexOf(from), to ? text.indexOf(to) : undefined);

// Claim 1: what no shipped file may name.
const BANNED = /voice-?mode|\bconverse\b|\bWSL\b|\bparec\b|\bpactl\b|\bproxy\.mjs\b|\blaunch\.mjs\b/i;
export const claim1 = (name, body) => (BANNED.test(body) ? [`${name} names ${BANNED.exec(body)[0]}`] : []);

test('claim 1: no file under skills/incantation/ or evals/incantation/, and no manifest, names VoiceMode, converse, WSL, parec, pactl or the old proxy', () => {
  for (const dir of [SKILL, EVALS].filter(existsSync)) for (const f of filesUnder(dir)) assert.deepEqual(claim1(f.slice(ROOT.length), readFileSync(f, 'utf8')), []);
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(market.plugins.find(p => p.name === 'incantation'), undefined, 'incantation is a skill of grimoire, not a second plugin');
  const entry = market.plugins.find(p => p.name === 'grimoire');
  assert.deepEqual(claim1('marketplace entry', JSON.stringify(entry)), []);
  assert.deepEqual(claim1('plugin manifest', JSON.stringify(manifest)), []);
  for (const holder of [entry, manifest]) for (const key of ['dependencies', 'requires', 'peerDependencies']) assert.equal(holder[key], undefined, key);
});

test('claim 1: the check fails on each name it forbids', () => {
  for (const bad of ['VoiceMode', 'voicemode', 'the converse tool', 'on WSL 2', 'parec', 'pactl', 'proxy.mjs', 'launch.mjs']) assert.equal(claim1('x', bad).length, 1, bad);
  assert.equal(claim1('x', 'reads no proxy setting').length, 0);
});

// Claim 15: every command the skill runs, and what it may hold. setup.mjs is
// the install's alone (T1), and takes only the person's typed pick.
const ALLOWED = [
  /^guard\.mjs$/,
  /^listen\.mjs (start|stop|idle|working|mute|unmute|mute-voice|unmute-voice)$/,
  /^listen\.mjs say <8 hex>$/,
  /^observe\.mjs add <8 hex>$/,
  /^observe\.mjs freeze <n>$/,
  /^setup\.mjs (devices|profiles)$/,
  /^setup\.mjs runtime (plan|install|verify)$/,
  /^setup\.mjs choose <index> <stamp> <profile id>$/,
  /^statusline\.mjs$/,
];
export function claim15(name, body) {
  const out = [];
  for (const m of body.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)([^`\n]*)/g)) {
    const [, script, rest] = m;
    const before = body.slice(0, m.index);
    if (!before.endsWith('<skill base>/') || /[^\s`'"(]$/.test(before.slice(0, -'<skill base>/'.length))) out.push(`${name} runs ${script} by a path not under the skill base`);
    const command = `${script}${rest.replace(/[`.,].*$/, '')}`.trim();
    if (!ALLOWED.some(r => r.test(command))) out.push(`${name} builds a command the skill may not run: ${command}`);
  }
  if (/\b(kokoro|whisper|qwen|chatterbox|luxtts)\b/i.test(body) && name !== 'SKILL.md') out.push(`${name} names a speech engine`);
  return out;
}

test('claim 15: the skill runs only its own commands, under the skill base, with no heard text or spoken line', () => {
  for (const [name, body] of prose()) assert.deepEqual(claim15(name, body), [], name);
});

test('claim 15: the check fails on each thing it forbids', () => {
  assert.equal(claim15('x', 'node scripts/guard.mjs').length, 1);
  assert.equal(claim15('x', 'node ./scripts/listen.mjs idle').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/setup.mjs devices`').length, 0);
  assert.equal(claim15('x', '`node <skill base>/scripts/setup.mjs choose <index> <stamp> <profile id>`').length, 0);
  assert.equal(claim15('x', '`node <skill base>/scripts/setup.mjs choose "Desk Mic" my-voice`').length, 1, 'a name in place of the typed index');
  assert.equal(claim15('x', '`node <skill base>/scripts/setup.mjs reset`').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/observe.mjs add "the build is green"`').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs say hello`').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs say <8 hex>`').length, 0, 'T18: the line is in a file the session wrote, never in the command');
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs say "Got it"`').length, 1);
  assert.equal(claim15('x', 'use the kokoro engine').length, 1);
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs wait`').length, 1, '0001 claim 2: the session runs no wait of its own');
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs idle`').length, 0);
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs working`').length, 0);
  assert.equal(claim15('x', '`node <skill base>/scripts/listen.mjs mute-voice`').length, 0);
  assert.equal(claim15('x', '`node <skill base>/scripts/observe.mjs add <8 hex>`').length, 0);
});

test('setup.mjs is run in the Install section and nowhere else', () => {
  const install = section('## Install', '## Start');
  assert.match(install, /scripts\/setup\.mjs devices/);
  assert.match(install, /scripts\/setup\.mjs profiles/);
  assert.match(install, /scripts\/setup\.mjs choose <index> <stamp> <profile id>/);
  assert.equal(/setup\.mjs/.test(text.replace(install, '').replace(/Run `setup\.mjs` only in\s+`\/incantation install`\./, '')), false);
  assert.match(install, /setup\.mjs runtime plan`\. Show its\s+lines/);
  assert.match(install, /A heard turn alone never starts the\s+download/);
  assert.ok(install.indexOf('runtime plan') < install.indexOf('setup.mjs devices'), 'the runtime step comes before the microphone');
  assert.match(install, /On a first install no mic is open, so the number is\s+typed/);
  assert.match(install, /typed on a first install/);
  assert.doesNotMatch(install, /Who asked/, '0001 S4.8: the Stops already hold that only a typed slash command installs');
});

test('every script and reference the skill names exists', () => {
  for (const [name, body] of prose()) {
    for (const m of body.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) assert.equal(existsSync(join(SKILL, 'scripts', m[1])), true, `${name}: scripts/${m[1]}`);
    for (const m of body.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)) assert.equal(existsSync(join(SKILL, 'references', m[1])), true, `${name}: references/${m[1]}`);
  }
});

test('T18: the session speaks through the listener, the line in a file it wrote and never in a command, one line at a time', () => {
  assert.doesNotMatch(text, /voicebox_speak|mcp__voicebox|claude mcp add/, 'no Voicebox tool and no MCP registration');
  const speaking = section('## Speaking', '## Hearing');
  assert.match(speaking, /so the words never pass through a command/);
  assert.match(speaking, /write the one line to a new file,\s+`~\/\.grimoire\/incantation\/observe\/say-<8 hex>\.txt`/);
  assert.match(speaking, /`node <skill base>\/scripts\/listen\.mjs say <8 hex>`/);
  for (const reply of ['speaking', 'say-refused', 'say-busy', 'say-failed', 'say-no-player']) assert.ok(speaking.includes(`\`${reply}\``), reply);
  assert.match(speaking, /Never speak through Voicebox's own tools/);
  assert.match(speaking, /Before every say, run\s+`node <skill base>\/scripts\/listen\.mjs idle`/, 'T12');
  assert.match(speaking, /One fact per turn/, 'T7');
  assert.match(speaking, /then one offer of the next/, 'T7');
});

test('the guard runs before the listener, the relay holds the wait before the greeting, and the signs are printed', () => {
  const start = section('## Start', '## Speaking');
  const at = word => start.indexOf(word);
  assert.equal(at('**Speak tool.**'), -1, 'T18: no Voicebox speak tool to look for');
  assert.ok(at('**Who asked.**') > 0 && at('**Setup check.**') > at('**Who asked.**') && at('**Listener.**') > at('**Setup check.**') && at('**First wait.**') > at('**Listener.**') && at('**Greeting.**') > at('**First wait.**'));
  assert.match(start.slice(at('**First wait.**')), /Print `Listening, always on\.`/);
  assert.match(start.slice(at('**First wait.**'), at('**Greeting.**')), /you never run one/);
  assert.match(start.slice(at('**Greeting.**')), /Print `Warming the voice…`/);
  assert.match(start.slice(at('**Greeting.**')), /print `Stopped listening\.`/);
  assert.match(text.slice(text.indexOf('## Stop')), /whenever the listener's background command ends,\s+print `Stopped listening\.`/);
  assert.match(start, /Start only on the person's own typed `\/incantation` or\s+`\/incantation observe` in this chat/);
});

// 0001 claim 1: a clear yes holds in the regenerated SKILL.md and the contract.
const PULL_BACK = 'no, not, don\'t, wait, stop, instead, actually';
const contract = readFileSync(join(SKILL, 'references', 'CONTRACT.md'), 'utf8');
const flat = s => s.replace(/\s+/g, ' ');
export function clearYes(name, body) {
  const out = [];
  const b = flat(body);
  if (!/\*\*Clear yes:\*\*|\| clear yes /.test(body)) out.push(`${name} has no clear yes term`);
  if (!b.includes(`holding none of the pull-back words: ${PULL_BACK}`)) out.push(`${name} lacks the pull-back words as the term lists them`);
  if (/stop, but,/.test(b)) out.push(`${name} puts "but" back in the pull-back list`);
  return out;
}

test('0001 claim 1: a clear yes is defined, with the pull-back words and no "but", in SKILL.md and the contract', () => {
  assert.deepEqual(clearYes('SKILL.md', text), []);
  assert.deepEqual(clearYes('CONTRACT.md', contract), []);
  const words = section('## Words and style', '## Install');
  assert.match(flat(words), /opens with "yes" or its like \("go ahead", "do it", "sounds good", "yeah, go for it"\)/);
  assert.match(flat(words), /marked `\(after reply\)`, with no `interrupted`, and with `plays` equal to the lines you had the listener say since the last delivery/);
  const requests = section('## Requests', '## Heard while working');
  assert.match(flat(requests), /It covers the say-back's act and nothing more/);
  assert.match(flat(requests), /A turn that narrows or conditions the act/);
  assert.match(flat(requests), /A turn about a yes \("did you get my yes\?", "you didn't catch my yes"\) is not the answer: say the act back again, with its cost when it has one, and wait/);
  assert.match(flat(requests), /It never comes from context in the middle of your turn/);
  assert.match(flat(requests), /"yeah" and "yep" alone are its like and count\. "okay", "sure", "right", "mhm"/);
  assert.match(flat(requests), /A say-back ends the turn/);
  assert.match(flat(text), /with its cost when it has one/);
});

test('0001 claim 1: the check fails on a missing term, a missing word, and a "but" in the list', () => {
  assert.equal(clearYes('x', 'nothing').length, 3 - 1, 'no term, no pull-back words (the "but" check passes)');
  const good = `- **Clear yes:** it agrees outright, holding none of the pull-back words: ${PULL_BACK}.`;
  assert.deepEqual(clearYes('x', good), []);
  assert.equal(clearYes('x', good.replace('stop, instead', 'stop, but, instead')).length, 2);
  assert.equal(clearYes('x', good.replace('wait, ', '')).length, 1);
});

test("0001 claim 1: head-chef's SKILL.md counts a clear yes at its gates, and a permission prompt is still never answered by voice", () => {
  const chef = flat(readFileSync(join(ROOT, 'skills', 'head-chef', 'SKILL.md'), 'utf8'));
  assert.match(chef, /\*\*Clear yes:\*\* a yes the owner says aloud to the say-back you just gave/);
  assert.match(chef, /holding none of no, not, don't, wait, stop, instead or actually/);
  assert.doesNotMatch(chef, /stop, but,/);
  assert.match(chef, /\*\*The owner's words:\*\* what the owner types in the lead's chat, or a clear yes heard after a say-back that names the act and its cost, for that act alone/);
  assert.match(chef, /\*\*A heard yes\.\*\* Say the act back first, naming its cost when it has one/);
  assert.match(chef, /A heard turn that sets or widens a goal is said back and holds only after a clear yes/);
  assert.match(chef, /A permission prompt on screen is still never answered by voice/);
  const chefContract = flat(readFileSync(join(ROOT, 'skills', 'head-chef', 'references', 'CONTRACT.md'), 'utf8'));
  assert.ok(chefContract.includes("**The owner's words:** what the owner types in the lead's chat"), "the contract's Words schedule holds the term, copied word for word to SKILL.md");
});

// 0001 claim 2: what the skill must not name or tell the session to run.
const HARD_STOP = /hard stops?/i;
const TRACKER = /\b(linear|github|jira|asana|trello)\b|\bGRIM-\d+|\bPACT-\d+/i;
const LEVEL = /\blevel (?:\d|one|two|three)\b|\b(?:Quick|Standard|Thorough)\b|\bautonomy\b/;
const PROMPT_LINE = 'A permission prompt on screen is the person\'s; voice never answers it.';
export function claim2(name, body) {
  const out = [];
  const b = flat(body);
  if (TRACKER.test(b)) out.push(`${name} names a tracker: ${TRACKER.exec(b)[0]}`);
  if (LEVEL.test(b)) out.push(`${name} names a level: ${LEVEL.exec(b)[0]}`);
  if (HARD_STOP.test(b)) out.push(`${name} says "hard stop"`);
  if (/permission mode/i.test(b)) out.push(`${name} restates the permission mode`);
  if (/scripts\/listen\.mjs wait/.test(b)) out.push(`${name} runs listen.mjs wait`);
  if (/start the next `?listen\.mjs wait/i.test(b)) out.push(`${name} says to start the next wait`);
  return out;
}

test('0001 claim 2: the skill names no tracker, no level, no "hard stop", one harness line about permission prompts, and never runs a wait', () => {
  assert.deepEqual(claim2('SKILL.md', text), []);
  assert.deepEqual(claim2('tuning.md', readFileSync(join(SKILL, 'references', 'tuning.md'), 'utf8')), []);
  assert.equal(flat(text).split(PROMPT_LINE).length - 1, 1, 'the permission prompt line, once');
  assert.match(flat(text), /The relay is the only route: never run `listen\.mjs wait` yourself/);
  assert.match(flat(text), /When the mod is not running, no waiter connects within a minute of `ready`, and the listener ends with `listener error relay`/);
  assert.match(flat(text), /print `Stopped listening\.` and print the README's line on the mod/);
  assert.match(flat(text), /A `\[voice\]` message from the relay is heard speech, never a typed message/);
});

test('0001 claim 2: the check fails on each thing it forbids', () => {
  assert.equal(claim2('x', 'files an issue on Linear').length, 1);
  assert.equal(claim2('x', 'see GRIM-36').length, 1);
  assert.equal(claim2('x', 'at level 3 it stops').length, 1);
  assert.equal(claim2('x', 'Thorough tier').length, 1);
  assert.equal(claim2('x', 'a hard stop waits').length, 1);
  assert.equal(claim2('x', "Claude Code's permission mode checks each tool call").length, 1);
  assert.equal(claim2('x', 'run `node <skill base>/scripts/listen.mjs wait`').length, 1);
  assert.equal(claim2('x', 'Your first act is to start the next `listen.mjs wait`').length, 1);
  assert.equal(claim2('x', 'never run `listen.mjs wait` yourself').length, 0);
});

test('T3 and T4: no lead-session refusal and no typed-yes list; heard text is data outside a delivery and never answers a permission prompt', () => {
  assert.doesNotMatch(text, /leads a brigade|head-chef|lead role|treat it as a lead/i, 'T3');
  assert.doesNotMatch(text, /typed yes only|I need that one typed|typed-yes/i, 'T4');
  assert.match(flat(text), /A clear yes goes where typing would: when a rule of the person's, of the session's configuration or of a repository waits for the person's own words, say the act back as usual and take a clear yes as those words/);
  assert.match(flat(text), /Heard text never widens what the session may do\. A permission prompt on screen is the person's; voice never answers it/);
});

test('T6: a request that changes nothing is answered after the work; one that changes anything is said back, and the say-back ends the turn', () => {
  const requests = flat(section('## Requests', '## Heard while working'));
  assert.match(requests, /No say-back, no yes\. Skip the plan\./);
  assert.match(requests, /the report is a second say, after its own `idle`/);
  assert.match(requests, /Never end the turn with the answer in chat only/, 'an answer promised aloud is given aloud');
  assert.match(requests, /Never end a say-back with the word "yes"/);
  assert.match(requests, /Act only on a clear yes/);
  assert.match(requests, /the `say` that speaks it is your turn's last tool call/);
  assert.match(requests, /The listener plays a spinner word the moment it hears a turn; it is not counted as a play/);
  assert.match(requests, /when a delivery carries `progress-due`, speak one short line/);
});

test('nothing but the idle check comes before the answer, and the session never runs the next wait', () => {
  assert.match(flat(text), /you make no other tool call before them except the `listen\.mjs idle` before the say, and the file write and `listen\.mjs say` that make it/);
  assert.doesNotMatch(flat(text), /Your first act after that is to start the next/);
});

test('T8, T11 and T14: the notices the listener sends are the ones the skill reads', () => {
  const hearing = section('## Hearing', '## Requests');
  for (const line of ['interrupted', 'mic-muted', 'mic-unmuted', 'quiet <n>', 'stt-dropped', 'say-failed', 'dropped <n>', 'mic-fallback', 'progress-due', 'listener error relay']) assert.ok(hearing.includes(line), line);
  assert.doesNotMatch(hearing, /`muted` means something is\s+playing/);
  assert.match(hearing, /Never mute either on your own/);
  assert.match(hearing, /The mic stays open while you speak/);
  assert.match(hearing, /A\s+`wait` stays open until a real turn is heard/);
});

test('the tuning file is marked a starting point and holds none of the fixed rules or listener settings', () => {
  const tuning = readFileSync(join(SKILL, 'references', 'tuning.md'), 'utf8');
  assert.match(tuning, /starting point/i);
  for (const fixed of ['"stop"', "that's all", 'merge, push', '(after reply)', '300 ms', 'a minute', '30 minutes']) assert.equal(tuning.includes(fixed), false, `tuning.md holds ${fixed}`);
  assert.match(text, /The say-back, the stop words and the never-speak list\s+are never subject to the settings/);
});

test('the skill is under 500 lines and its frontmatter holds only the keys the check allows', () => {
  assert.ok(text.split('\n').length < 500);
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
  const keys = [...front.matchAll(/^([A-Za-z-]+):/gm)].map(m => m[1]);
  assert.deepEqual(keys, ['name', 'description', 'disable-model-invocation']);
  assert.ok(/description: (.+)/.exec(front)[1].length <= 1024);
});

// Claim 5: no wait before listening is estimated from the text. No timer in a
// shipped script takes its delay from text, words or a length, and the skill
// names no fixed wait.
export function claim5(name, body) {
  const out = [];
  for (const line of body.split('\n')) {
    if (/setTimeout|setInterval/.test(line) && /\btext\b|\bwords?\b|\.length\b/.test(line)) out.push(`${name}: a timer from text: ${line.trim()}`);
  }
  if (/\bwait(?:s|ing)? (?:about |for |roughly )?\d+(?:\.\d+)? ?(?:ms|s|seconds?)\b/i.test(body)) out.push(`${name}: a fixed wait`);
  return out;
}

test('claim 5: no wait before listening is estimated from the text, and none is fixed', () => {
  for (const f of filesUnder(join(SKILL, 'scripts')).filter(f => f.endsWith('.mjs'))) assert.deepEqual(claim5(f.slice(SKILL.length + 1), readFileSync(f, 'utf8')), []);
  for (const [name, body] of prose()) assert.deepEqual(claim5(name, body), []);
});

test('claim 5: the check fails on each thing it forbids', () => {
  assert.equal(claim5('x', 'setTimeout(listen, text.split(" ").length * 300);').length, 1);
  assert.equal(claim5('x', 'const t = setTimeout(go, words * 250);').length, 1);
  assert.equal(claim5('x', 'After speaking, wait about 9 seconds before listening.').length, 1);
  assert.equal(claim5('x', 'setTimeout(serve, knobs.quietMs);').length, 0);
});
