import type { EngineInterface, On } from 'claude-code'

// Incantation's relay and nudge, in grimoire's own mod. Three jobs, none of them drawn in the pane,
// and no lead tool reads them:
//
//   1. The relay holds the listener's one `wait` and sends each delivery into the chat as a message
//      labelled [voice]: between turns as a prompt in the person's role, while the session works as
//      context on the next tool result. A heard turn reaches the session the way typing does, so
//      every hook that reads prompts sees it.
//   2. The permission nudge speaks one fixed line when Claude Code is about to wait on a permission
//      prompt. It never answers the prompt.
//   3. The progress fallback speaks one fixed line when a progress beat found no tool call to ride on.
//
// All three act only in a bound session: the main thread of the one whose own `tool.call` ran
// incantation's `listen.mjs start`, inside the turn a typed /incantation opened. No heard text is
// written anywhere; the only counts kept are three numbers in this module's memory.
//
// Only the listener's own grammar passes (`listen.mjs wait` filters its output to it); the relay adds
// one short tag, a join, and nothing else. Erasable syntax only (no enums, namespaces or parameter
// properties) and no runtime import from the engine, so Node can load it for the tests.

export const LABEL = '[voice]'
export const START_DENY = 'Type /incantation to start voice'
/** The two names a typed /incantation answers to. */
export const COMMANDS: readonly string[] = ['incantation', 'grimoire:incantation']

const SCRIPT_TAIL = '/skills/incantation/scripts/listen.mjs'
const NUDGE_TAIL = '/skills/incantation/scripts/nudge.mjs'
/** A listener's status file is touched every 2 s; this old is a listener that is gone. */
export const STATUS_FRESH_MS = 10_000
/** A delivery refused by the engine is tried again this often, up to MAX_TRIES times. */
export const RETRY_MS = 1_000
export const MAX_TRIES = 20
/** No wait came back with anything worth a turn: look again after this, doubling to the cap. */
export const BACKOFF_MS = 2_000
export const BACKOFF_MAX_MS = 30_000
/** A `progress-due` that no tool call carried in this long is spoken by the mod instead. */
export const PROGRESS_FALLBACK_MS = 10_000
/** `listener error ended` is ignored until the first delivery after binding or this long. */
export const START_GRACE_MS = 90_000
/** This many `listener error waiting` in a row, and the binding ends. */
export const WAITING_STRIKES = 3
export const HEARD_WHILE_WORKING = '(heard while you worked)'

/** One short line per delivery: the tag, then its lines joined, `timing:` left out, `plays` kept. */
export const relayText = (out: string): string => {
  const lines = out
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l && !l.startsWith('timing:'))
  return lines.length ? `${LABEL} ${lines.join(' · ')}` : ''
}

/** A delivery worth a turn: something heard, or a notice the session must act on. */
export const worthATurn = (out: string): boolean =>
  /^(Heard|interrupted|stt-dropped|say-failed|dropped|mic-muted|mic-unmuted|ready|mic-fallback|progress-due|stopped|listener error (?!waiting|ended))/m.test(out)

/** Turns that pile up go as one message, in order: two prompts sent back to back could lose the second. */
export const joinPending = (items: readonly string[]): string =>
  items.length === 1 ? items[0] : `${LABEL} ${items.map(t => t.replace(/^\[voice\] /, '')).join(' | then: ')}`

/** A delivery that is only `progress-due`: the one kind the mod may speak for. */
export const onlyProgress = (out: string): boolean => {
  const lines = out.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('timing:'))
  return lines.length === 1 && lines[0] === 'progress-due'
}

// Backslashes become `/` and quotes go, on both sides, before any match. A Windows drive letter's
// case is folded too, since the host spells it either way.
const flat = (s: string): string => s.replace(/\\/g, '/').replace(/["'`]/g, '')
const fold = (s: string): string => (/^[A-Za-z]:/.test(s) ? s.toLowerCase() : s)

/** Whether a shell command runs this plugin's `listen.mjs` with `start` as the word right after it. */
export function runsStart(command: unknown, root: unknown): boolean {
  if (typeof command !== 'string' || typeof root !== 'string' || root === '') return false
  const base = flat(root).replace(/\/+$/, '')
  const target = fold(base) + SCRIPT_TAIL
  const text = /^[A-Za-z]:/.test(base) ? flat(command).toLowerCase() : flat(command)
  for (let at = text.indexOf(target); at !== -1; at = text.indexOf(target, at + 1)) {
    if (/^\s+start(?![\w-])/.test(text.slice(at + target.length))) return true
  }
  return false
}

/** The person's home folder from the engine's environment: an absolute path of sane length, else undefined. */
export function homeOf(profile: unknown, home: unknown): string | undefined {
  for (const v of [profile, home]) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 260 || /[\0\r\n]/.test(v)) continue
    if (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith('/')) return v
  }
  return undefined
}

/** The listener's status file, touched while it runs. */
export function statusFile(home: string): string {
  const s = home.includes('\\') ? '\\' : '/'
  return [home.replace(/[\\/]+$/, ''), '.grimoire', 'incantation', 'run', 'status'].join(s)
}

/** The plugin's root with the tail of a script of the skill's. */
export const nudgeScript = (root: string): string => flat(root).replace(/\/+$/, '') + NUDGE_TAIL
export const listenScript = (root: string): string => flat(root).replace(/\/+$/, '') + SCRIPT_TAIL


type Piece = { stream?: unknown; text?: unknown }
type Held = { text: string; progress: boolean }

export type RelayStats = { relayed: number; refused: number; dropped: number }

// The relay's state is this module's own, and in memory only: three counts and nothing that was said.
// (The engine's checker holds `$` to top-level functions, so the state lives at the top, not in a closure.)
let stats: RelayStats = { relayed: 0, refused: 0, dropped: 0 }
// The binding: true while this session owns the listener. `generation` ends a loop left behind.
let bound = false
let generation = 0
// A typed /incantation arms the next main-thread turn; a `listen.mjs start` binds only inside it.
let armed = false
let startTurn = false
// A main-thread turn is running: heard turns ride a tool result as context; otherwise they go as a prompt.
let busy = false
// Held deliveries, each with whether it is a `progress-due` the mod may speak for.
let pending: Held[] = []
let draining = false
let droppedOwed = 0
let progressTimer: { cancel: () => void } | undefined

/** The counts, for the tests. */
export const relayStats = (): Readonly<RelayStats> => stats
/** Whether the session is bound and what is held: for the tests. */
export const relayState = () => ({ bound, busy, startTurn, armed, pending: pending.map(p => p.text) })
/** Back to a fresh module: for the tests. */
export function resetRelay(): void {
  unbind()
  stats = { relayed: 0, refused: 0, dropped: 0 }
  armed = false
  startTurn = false
  busy = false
  draining = false
  droppedOwed = 0
}

// The pane's host rule for a program found by name (brigade.md): on Windows the engine runs the real
// program and no PATH is checked; elsewhere every PATH entry must be absolute, since an empty or
// relative one could let a file in the project folder run in its place.
async function nameFindable($: EngineInterface): Promise<boolean> {
  try {
    if (
      (await $.env.get('OS')) === 'Windows_NT' ||
      typeof (await $.env.get('SystemRoot')) === 'string' ||
      typeof (await $.env.get('windir')) === 'string'
    )
      return true
    const path = await $.env.get('PATH')
    return typeof path === 'string' && path !== '' && path.split(':').every(entry => entry.startsWith('/'))
  } catch {
    return false
  }
}

// The binding ends. A closing notice (stopped, a listener error) is kept to go out; otherwise what is
// held is dropped.
function unbind(flush = false): void {
  bound = false
  generation++
  if (!flush) pending = []
  progressTimer?.cancel()
  progressTimer = undefined
}

// Heard turns go as a prompt between turns, together as one message when several piled up.
async function drain($: EngineInterface): Promise<void> {
  if (draining || busy) return
  draining = true
  try {
    for (let tries = 0; pending.length && !busy && tries < MAX_TRIES; ) {
      const batch = pending.splice(0)
      const text = joinPending(batch.map(b => b.text))
      let refused = false
      try {
        const r: { drop?: unknown } | undefined = await $.prompt.submit({ text, asUser: true })
        refused = Boolean(r?.drop)
      } catch {
        refused = true
      }
      if (!refused) {
        stats.relayed += batch.length
        tries = 0
        continue
      }
      stats.refused++
      pending.unshift(...batch)
      tries++
      if (tries >= MAX_TRIES) {
        // Past the limit the batch is dropped, and the next delivery says how many.
        stats.dropped += pending.length
        droppedOwed += pending.length
        pending = []
        break
      }
      await $.clock.sleep(RETRY_MS)
    }
  } finally {
    draining = false
  }
}

// A `progress-due` that no tool call carried: the mod speaks the fixed line itself, and drops it.
async function speakProgress($: EngineInterface): Promise<void> {
  progressTimer = undefined
  if (!bound || !pending.some(p => p.progress)) return
  pending = pending.filter(p => !p.progress)
  const root = $.plugin.root
  if (typeof root !== 'string' || !(await nameFindable($))) return
  void $.process.run(['node', nudgeScript(root), 'progress'], { timeoutMs: 120_000 }).catch(() => undefined)
}

function hold($: EngineInterface, text: string, progress: boolean): void {
  if (progress && !busy) return // nothing works, so there is nothing to report on
  if (droppedOwed > 0 && !progress) {
    pending.push({ text: `${LABEL} dropped ${droppedOwed}`, progress: false })
    droppedOwed = 0
  }
  pending.push({ text, progress })
  if (progress) {
    progressTimer?.cancel()
    progressTimer = $.clock.after(PROGRESS_FALLBACK_MS, () => void speakProgress($))
  }
  void drain($)
}

// The wait loop: one `listen.mjs wait` at a time, stdout only.
async function relayLoop($: EngineInterface, mine: number): Promise<void> {
  const root = $.plugin.root
  if (typeof root !== 'string' || !(await nameFindable($))) {
    if (mine === generation) unbind()
    return
  }
  const script = listenScript(root)
  const began = await $.clock.now()
  let delivered = false
  let backoff = BACKOFF_MS
  let waiting = 0
  while (bound && mine === generation) {
    let out = ''
    try {
      for await (const piece of $.process.spawn({ argv: ['node', script, 'wait'] }) as AsyncIterable<Piece>) {
        if (piece.stream === 'stdout' && typeof piece.text === 'string') out += piece.text
      }
    } catch {
      out = ''
    }
    if (!bound || mine !== generation) return
    if (/^listener error waiting$/m.test(out)) {
      if (++waiting >= WAITING_STRIKES) return unbind()
    } else {
      waiting = 0
    }
    if (/^listener error ended$/m.test(out) && !worthATurn(out)) {
      const inGrace = !delivered && (await $.clock.now()) - began < START_GRACE_MS
      if (!inGrace) return unbind()
    }
    if (!worthATurn(out)) {
      await $.clock.sleep(backoff)
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
      continue
    }
    backoff = BACKOFF_MS
    delivered = true
    const text = relayText(out)
    if (text) hold($, text, onlyProgress(out))
    // The listener stopped, or its own error ends the binding; the notice still goes out.
    if (/^stopped$/m.test(out) || /^listener error (?!waiting|ended)/m.test(out)) return unbind(true)
  }
}

/** The lead's turn start (register.tsx's own hook calls it): the turn a typed /incantation opened may start the listener. */
export function relayTurnStart(e: { agentId?: string }): void {
  if (e.agentId !== undefined) return
  busy = true
  startTurn = armed
  armed = false
}

/** The lead's turn end (the writer's turn-end hook and the abort hook call it): what was heard after the last tool step goes now. */
export function relayTurnEnd($: EngineInterface, e: { agentId?: string }): void {
  if (e.agentId !== undefined) return
  busy = false
  startTurn = false
  // What reported on work that is over is dropped; the rest goes as a prompt.
  pending = pending.filter(p => !p.progress)
  void drain($)
}

type CallPlan = { deny?: string; bind?: boolean }

// Before a main-thread tool call: a `listen.mjs start` outside a typed /incantation turn is denied (a
// speed bump against a typo, not a control: a steered shell can record audio on its own); inside one it
// binds, unless another listener is alive. `stop` is never touched.
async function planCall($: EngineInterface, e: { agentId?: string; tool?: string; command?: unknown }): Promise<CallPlan> {
  if (e.agentId !== undefined || (e.tool !== 'Bash' && e.tool !== 'PowerShell')) return {}
  // A throw here must not stop the call: the hook has no `.catch`, since a retry would run it twice.
  try {
    if (!runsStart(e.command, $.plugin.root)) return {}
    if (!startTurn) return { deny: START_DENY }
    const home = homeOf(await $.env.get('USERPROFILE'), await $.env.get('HOME'))
    if (home === undefined) return {}
    try {
      const st = await $.fs.stat(statusFile(home))
      if ((await $.clock.now()) - st.mtimeMs <= STATUS_FRESH_MS) return {}
    } catch {
      // no status file: no listener
    }
    return { bind: true }
  } catch {
    return {}
  }
}

// After the call: a start that went through binds; held deliveries ride the result as context.
function finishCall($: EngineInterface, plan: CallPlan, r: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (r === undefined || r.deny) return r
  if (plan.bind) {
    const mine = ++generation
    bound = true
    void relayLoop($, mine)
  }
  if (!pending.length) return r
  const batch = pending.splice(0)
  progressTimer?.cancel()
  progressTimer = undefined
  stats.relayed += batch.length
  const ctx = Array.isArray(r.context) ? (r.context as string[]) : []
  return { ...r, context: [...ctx, `${joinPending(batch.map(b => b.text))} ${HEARD_WHILE_WORKING}`] }
}

// The permission nudge: a spawn that is not awaited. It never answers the prompt.
function nudge($: EngineInterface, e: { agent_id?: string }): void {
  if (!bound || e.agent_id !== undefined) return
  const root = $.plugin.root
  if (typeof root !== 'string') return
  void nameFindable($)
    .then(ok => (ok ? $.process.run(['node', nudgeScript(root)], { timeoutMs: 120_000 }) : undefined))
    .catch(() => undefined)
}

export function registerRelay(on: On): void {
  on('session.end', ($, e, next) => {
    unbind()
    return next(e)
  })

  // A typed /incantation arms the turn it opens. Only the person's own typing counts.
  for (const command of COMMANDS) {
    on('command.run', { command }, async ($, e, next) => {
      const r: { text?: unknown } | undefined = await next(e)
      if (e.origin?.kind === 'composer' && r !== undefined) armed = true
      return r
    }).catch(($, e, next) => next(e))
  }

  // The engine takes one unmatched hook per event from a module, and register.tsx's turn start and the
  // writer's turn end are taken: they call relayTurnStart and relayTurnEnd. The abort is ours.
  on('turn.abort', async ($, e: { agentId?: string }, next) => {
    const r = await next(e as never)
    relayTurnEnd($, e)
    return r
  })

  // The start's binding and the mid-turn ride: one hook, main thread only.
  on('tool.call', async ($, e: { agentId?: string; tool?: string; command?: unknown }, next) => {
    // A subagent's tool result never carries heard text, and a subagent never binds.
    if (e.agentId !== undefined) return next(e as never)
    const plan = await planCall($, e)
    if (plan.deny !== undefined) return { deny: plan.deny }
    const r = (await next(e as never)) as Record<string, unknown> | undefined
    return finishCall($, plan, r) as never
  })

  on('classic.PermissionRequest', ($, e: { agent_id?: string }, next) => {
    nudge($, e)
    return next(e as never)
  }).catch(($, e, next) => next(e))
}
