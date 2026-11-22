import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { relayTurnEnd } from './voice-relay.ts'

import { dataPlace, placeSummary, statRejection } from './roster.ts'
import type { StatAnswer } from './roster.ts'
import {
  MAX_SUMMARY_BYTES,
  askWrite,
  isSummaryFile,
  newFlight,
  newUsageMemory,
  recordCall,
  serializeSummary,
  stepCall,
  summaryFrom,
  writeDone,
} from './view.ts'

// The usage summary writer. Every session with the plugin keeps its own usage
// numbers as it works and writes them, numbers only, to its own summary file,
// brigade/usage/<session id>.json in the plugin's data folder, so the lead's
// pane can draw a member whose transcript is too large to read. No pane, no
// /brigade and no tool is needed for it to run.
//
// A `turn.step` hook starts an unawaited read of the session id, passes the
// step on, then records it. On the step's
// path it awaits no engine call: it reads the step's own result, keeps the
// numbers in module memory, stamps them from the module's own clock and, when
// a write is due, starts one it does not await. The writes run one at a time,
// at most every 15 s while a turn runs and at every main-loop turn end. The
// decisions are view.ts's, under its tests; this file only feeds them, stats
// and writes.
//
// It makes no session usage call, so no cost, rate limit or context breakdown
// ever enters it. The first refusal of the summary path, before or after a
// write, stops it until the module reloads, with one toast; a clear does not
// restart it.

// The engine's record of a session's start, the last one raised, which register.tsx's
// `classic.SessionStart` hook keeps under the same key.
const started = atom({ plugin: 'grimoire', key: 'start' } as const, { sessionId: '', transcript: '' })

let memory = newUsageMemory()
let flight = newFlight()
let stopped = false
// The session id the memory belongs to, from the engine's session start and
// from the id reads below.
let sessionOf: string | undefined
// The id reads the step hook starts, numbered in the order started. Only the
// latest-started read that has answered counts, so a slow older answer cannot
// put the writer back on a session it has left.
let readsStarted = 0
let latestAnswered = 0

// The module's clock: the engine clock's epoch, read once and never awaited
// on a step's path, carried on by `performance.now()`. Until the epoch
// arrives, the machine's own clock stands in; both read the same epoch in a
// live session (probe part 2 on #311). Whole milliseconds.
let epoch: { engine: number; perf: number } | undefined
let epochAsked = false
function readEpoch($: EngineInterface) {
  if (epochAsked) return
  epochAsked = true
  const perf = performance.now()
  $.clock.now().then(
    engine => {
      if (Number.isFinite(engine)) epoch = { engine, perf }
    },
    () => undefined,
  )
}
const now = (): number => Math.round(epoch === undefined ? Date.now() : epoch.engine + (performance.now() - epoch.perf))

// The engine follows `$` only into functions declared in the file that holds
// the hook, so the functions below are written here rather than imported.

// The config folder, the plugin's data id and this session's id, read at
// each write, so after a clear the file follows the new id; by the rule the
// roster uses (`dataPlace`). Undefined when no config folder can be named.
async function locate($: EngineInterface): Promise<{ config: string; plugin: string; id: string } | undefined> {
  const id = await $.session.id()
  const { config, plugin } = dataPlace($.plugin.root, $.plugin.name, await read($, started))
  return config === undefined ? undefined : { config, plugin, id }
}

// Starts a read of the session id and does not wait for it, so a clear or a
// resume is seen without `classic.SessionStart`. A rejected read is ignored.
function followSession($: EngineInterface) {
  const n = ++readsStarted
  $.session.id().then(
    id => {
      if (n < latestAnswered) return
      latestAnswered = n
      writerSession(id)
    },
    () => undefined,
  )
}

// One resolving `stat` for the path rule, a rejection sorted into missing or
// failed by its message.
function statPath($: EngineInterface, path: string): Promise<StatAnswer> {
  return $.fs.stat(path, { resolve: true }).then(
    found => ({ found }),
    err => statRejection(String(err instanceof Error ? err.message : err)),
  )
}

// The kinds of refusal, in fixed words: the toast names the kind and never
// the engine's message or the file's text, either of which can hold a path.
const REFUSED = {
  path: 'the summary path failed its check',
  file: 'the summary path holds a file that is not a summary file, so it is not overwritten',
  after: 'the summary path failed its check after the write',
} as const

// The first refusal stops every later write until the module reloads, and
// its words are toasted once, by the caller; a later refusal has none. A
// clear does not restart it. The caller makes the toast so `$` reaches no
// helper here: the directory's checker refuses that.
function refuse(kind: keyof typeof REFUSED): string | undefined {
  if (stopped) return undefined
  stopped = true
  return `Brigade: the usage summary was not written, and will not be until the plugin reloads (a clear does not restart it): ${REFUSED[kind]}.`
}

// A write is asked for; one starts when the throttle and the single flight
// allow. Its run, and any run waiting behind it, is never awaited here.
function ask($: EngineInterface, turnEnd: boolean) {
  const r = askWrite(flight, now(), turnEnd)
  flight = r.flight
  if (r.start) void run($)
}

async function run($: EngineInterface) {
  try {
    await writeOnce($)
  } catch {
    // A write that fails is tried again at the next one due.
  } finally {
    const r = writeDone(flight, now())
    flight = r.flight
    if (r.start) void run($)
  }
}

// One write: place the file under the path rule, overwrite only a summary
// file, take the newest numbers, write, and run the path rule again after.
async function writeOnce($: EngineInterface) {
  if (stopped) return
  // The session the memory belongs to when the write starts. A clear while
  // the write waits on its checks moves it, and the write is skipped, so one
  // session's numbers never land in another's file; the next one due writes.
  const owner = sessionOf
  // No config folder named: nothing is written, and nothing was refused.
  const at = await locate($)
  if (at === undefined || (owner !== undefined && at.id !== owner)) return
  const placed = await placeSummary(at.config, at.plugin, at.id, (path: string) => statPath($, path))
  if ('refused' in placed) {
    const said = refuse('path')
    if (said !== undefined) $.ui.toast(said, { timeoutMs: 15000 })
    return
  }
  if (placed.existing !== undefined) {
    const text = placed.existing.size <= MAX_SUMMARY_BYTES ? String(await $.fs.read(placed.file)) : undefined
    if (!isSummaryFile(placed.existing.size, text)) {
      const said = refuse('file')
      if (said !== undefined) $.ui.toast(said, { timeoutMs: 15000 })
      return
    }
  }
  // The id again, just before the numbers are taken: a clear while the checks
  // waited moves it, and this write is skipped; the writer moves to the new
  // session.
  const again = await $.session.id()
  if (again !== at.id) return writerSession(again)
  const summary = summaryFrom(memory, now())
  if (summary === undefined || stopped || sessionOf !== owner) return
  const text = serializeSummary(summary)
  if ('error' in text) return
  await $.fs.write(placed.file, text.value)
  // A link swapped in between the check and the write is caught here, after
  // the fact. A hard link is not.
  const after = await placeSummary(at.config, at.plugin, at.id, (path: string) => statPath($, path)).catch(() => ({ refused: 'the check could not run' }))
  const why = 'refused' in after ? after.refused : after.existing === undefined ? 'the file is not there' : undefined
  if (why === undefined) return
  const said = refuse('after')
  if (said !== undefined) $.ui.toast(said, { timeoutMs: 15000 })
}

/** For register.tsx's `session.start` hook, which a module load raises: the
 *  engine clock's time and `performance.now()` when it was asked, so the
 *  epoch is known before the first step. Only numbers cross: the engine
 *  follows `$` into no function of another file. The first epoch wins. */
export function writerEpoch(engine: number, perf: number) {
  epochAsked = true
  if (epoch === undefined && Number.isFinite(engine) && Number.isFinite(perf)) epoch = { engine, perf }
}

/** For register.tsx's `session.start` and `classic.SessionStart` hooks, and
 *  for the id reads the step hook starts: the session id the memory belongs
 *  to. A module load names it first, so a clear or a resume after a reload is
 *  seen as one; a new id starts the series over, the old file left behind.
 *  Never throws. */
export function writerSession(sessionId: unknown) {
  if (typeof sessionId !== 'string') return
  if (sessionOf !== undefined && sessionOf !== sessionId) memory = newUsageMemory()
  sessionOf = sessionId
}

/** Registers the writer's two hooks. The engine takes one hook per event from
 *  a module, so the session start's work is register.tsx's to call:
 *  `writerEpoch` and `writerSession`. */
export function registerWriter(on: On, afterTurn?: (e: { agentId?: string }) => string | undefined) {
  // The step starts its id read, then is passed on. Everything after it sits
  // in one catch, and the registration's own catch passes the step through
  // unchanged.
  on('turn.step', async function* ($, e, next) {
    try {
      followSession($)
    } catch {
      // The step goes on unchanged.
    }
    const r = yield* next(e)
    try {
      if (!stopped) {
        readEpoch($)
        const call = stepCall(e, r)
        if (call !== undefined) {
          memory = recordCall(memory, call, now())
          ask($, false)
        }
      }
    } catch {
      // The step goes on unchanged.
    }
    return r
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // Every main-loop turn end writes, aborted turns included, once a call was
  // counted since the module loaded. A subagent's turn end writes nothing.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (!stopped && e.agentId === undefined && memory.calls > 0) ask($, true)
    } catch {
      // The turn ends unchanged.
    }
    // Incantation's relay hears the turn's end too (voice-relay.ts): what was heard after the last
    // tool step goes as a prompt now. It never throws into the turn.
    try {
      relayTurnEnd($, e)
    } catch {
      // The turn ends unchanged.
    }
    // The module's own work at a turn end (the roster reminder, issue 532):
    // the engine takes one hook per event from a module, so it runs here.
    try {
      const line = afterTurn?.(e)
      if (line !== undefined) {
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: `Brigade (plugin note): ${line}` }] } })
      }
    } catch {
      // The turn ends unchanged.
    }
    return r
  }).catch(($, e, next) => next(e))
}
