import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { START_DENY, statusFile } from './voice-relay.ts'

// Incantation's relay and permission nudge, driven the way the session meets them: the person types
// /incantation, the model starts the listener, the listener's waits answer, and turns, tool calls and
// permission prompts go by. Runs under `claude plugin test .`. The relay's state is the module's own,
// so every test ends with its session's end and a turn's end, and the next one starts bare.

const ON_WINDOWS = /^file:\/\/\/[A-Za-z]:/.test(import.meta.url)
const HOME = ON_WINDOWS ? 'C:\\Work\\owner' : '/work/owner'
const STATUS = statusFile(HOME)
const SAFE_PATH = ON_WINDOWS ? 'C:\\Windows\\System32' : '/usr/bin:/bin'
const COMMAND_OK = { text: '' }

type World = ReturnType<typeof world>

// What the engine does beneath the plugin: just enough, with the waits, the submits and the runs
// scripted by the test and recorded.
function world(on: On) {
  const w = {
    clock: undefined as unknown as ReturnType<typeof mock.clock>,
    waits: [] as string[], // what the next waits print, in order
    wake: undefined as undefined | (() => void),
    spawns: [] as string[][],
    runs: [] as string[][],
    submits: [] as { text: string; asUser?: boolean }[],
    refuse: 0, // refuse this many submits
    writes: [] as string[],
    statusAge: undefined as number | undefined, // the status file's age in ms; undefined = none
    permission: {} as object, // what the engine answers a permission request beneath the plugin
  }
  w.clock = mock.clock(on)
  on('env.get', (_$, e: any) => ({
    value: e.name === 'USERPROFILE' || e.name === 'HOME' ? HOME : e.name === 'PATH' ? SAFE_PATH : e.name === 'OS' && ON_WINDOWS ? 'Windows_NT' : undefined,
  }))
  on('fs.stat', (_$, e: any) => {
    if (e.path !== STATUS || w.statusAge === undefined) return { deny: 'ENOENT: no such file or directory' }
    return { value: { kind: 'file', size: 9, mtimeMs: w.clock.now() - w.statusAge, isLink: false } } as any
  })
  on('fs.write', (_$, e: any) => {
    w.writes.push(String(e.path))
    return { value: undefined }
  })
  on('process.spawn', async function* (_$, e: any) {
    w.spawns.push([...e.argv])
    while (w.waits.length === 0) await new Promise<void>(res => (w.wake = res))
    yield { stream: 'stdout', text: w.waits.shift() as string }
    return { value: { code: 0, signal: null } } as any
  })
  on('process.run', (_$, e: any) => {
    w.runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } } as any
  })
  on('prompt.submit', (_$, e: any) => {
    w.submits.push({ text: e.text, asUser: e.origin?.asUser })
    if (w.refuse > 0) {
      w.refuse--
      return { drop: 'busy' } as any
    }
    return { text: e.text }
  })
  on('command.run', () => COMMAND_OK as any)
  on('tool.call', () => ({ result: { stdout: 'ok' } }) as any)
  on('classic.PermissionRequest', () => w.permission as any)
  on('session.end', () => ({ sessionId: 'a1b2c3d4-0000-4000-8000-000000000000' }))
  on('turn.start', (_$, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.abort', () => undefined)
  return w
}

// The mod's folder, which is the plugin's root to its hooks: this file's own folder's parent.
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '').replace(/\/$/, '')
const root = (_$: any): string => ROOT
const startCommand = ($: any) => (ON_WINDOWS ? `node "${root($)}\\skills\\incantation\\scripts\\listen.mjs" start` : `node ${root($)}/skills/incantation/scripts/listen.mjs start`)
const stopCommand = ($: any) => startCommand($).replace(/ start$/, ' stop')
const typed = ($: any) => $.command.run({ command: 'incantation', args: '', origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } } as any)
const turnStart = ($: any, extra: object = {}) => $.turn.start({ text: '', turnId: 't1', ...extra } as any)
const turnEnd = ($: any, extra: object = {}) => $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 1, isAborted: false, ...extra } as any)
const shell = ($: any, command: string, extra: object = {}) => $.tool.call({ tool: 'Bash', command, ...extra } as any)
// A call a hook refused: the errored result a session's hooks see, or the deny itself.
// A short real-time wait for the relay's own async steps to settle (the mocked clock is for timers).
const tick = () => new Promise<void>(res => setTimeout(res, 40))
const refused = (r: any): boolean => r?.isError === true || typeof r?.deny === 'string'
const wait = (w: World, out: string) => {
  w.waits.push(out)
  w.wake?.()
}
// A typed /incantation, its turn, the listener's start, and the turn's end: the session is bound.
async function bind($: any, w: World) {
  await typed($)
  await turnStart($)
  const started = await shell($, startCommand($))
  expect(refused(started)).toBe(false)
  await turnEnd($)
  await tick()
  return started
}
async function finish($: any, w: World) {
  await $.session.end({ reason: 'other' } as any)
  await turnEnd($)
  await tick()
  w.waits.length = 0
}

describe('voice relay', () => {
  test('an unbound session spawns nothing and holds no wait: turns, tool calls and a stop go by', async ($, on) => {
    const w = world(on)
    await turnStart($)
    expect(refused(await shell($, 'ls'))).toBe(false)
    expect(refused(await shell($, stopCommand($)))).toBe(false)
    await turnEnd($)
    await w.clock.advance(5000)
    expect(w.spawns).toEqual([])
    expect(w.submits).toEqual([])
    await finish($, w)
  })

  test('a start outside a typed /incantation turn is denied with the fixed reason; a stop never is', async ($, on) => {
    const w = world(on)
    await turnStart($)
    const denied = await shell($, startCommand($))
    expect(refused(denied)).toBe(true)
    expect(String(denied.text ?? denied.deny)).toContain(START_DENY)
    expect(refused(await shell($, stopCommand($)))).toBe(false)
    await turnEnd($)
    // A typed command that was not the person's own typing arms nothing.
    await $.command.run({ command: 'incantation', args: '', origin: { kind: 'plugin', name: 'other' }, presentation: { layout: 'main', columns: 80 } } as any)
    await turnStart($)
    expect(refused(await shell($, startCommand($)))).toBe(true)
    await turnEnd($)
    expect(w.spawns).toEqual([])
    await finish($, w)
  })

  test('a start in the turn a typed /incantation opened binds, and the relay holds one wait through node by name', async ($, on) => {
    const w = world(on)
    await bind($, w)
    expect(w.spawns.length).toBe(1)
    expect(w.spawns[0][0]).toBe('node')
    expect(w.spawns[0][2]).toBe('wait')
    expect(w.spawns[0][1].replace(/\\/g, '/')).toMatch(/\/skills\/incantation\/scripts\/listen\.mjs$/)
    await finish($, w)
  })

  test('a subagent never binds, and its tool results carry no heard text', async ($, on) => {
    const w = world(on)
    await typed($)
    await turnStart($)
    expect(refused(await shell($, startCommand($), { agentId: 'a1' }))).toBe(false)
    await tick()
    expect(w.spawns).toEqual([])
    await bind($, w)
    await turnStart($)
    wait(w, 'Heard: "hello"\nplays 0\n')
    await tick()
    const sub: any = await shell($, 'ls', { agentId: 'a1' })
    expect(sub.context).toBeUndefined()
    await turnEnd($, { agentId: 'a1' })
    await turnEnd($)
    await finish($, w)
  })

  test('another listener alive (a status file touched in the last 10 s) means no binding', async ($, on) => {
    const w = world(on)
    w.statusAge = 3000
    await typed($)
    await turnStart($)
    expect(refused(await shell($, startCommand($)))).toBe(false)
    await turnEnd($)
    await w.clock.advance(10)
    expect(w.spawns).toEqual([])
    await finish($, w)
  })

  test('between turns a heard turn goes as a prompt in the person\'s role, labelled, timing left out, plays kept', async ($, on) => {
    const w = world(on)
    await bind($, w)
    wait(w, 'Heard (after reply): "go ahead"\ntiming: wait 2500 stt 300\nplays 1\n')
    await tick()
    expect(w.submits).toEqual([{ text: '[voice] Heard (after reply): "go ahead" · plays 1', asUser: true }])
    await finish($, w)
  })

  test('deliveries that pile up while a submit waits go together, in order, joined by | then:', async ($, on) => {
    const w = world(on)
    await bind($, w)
    await turnStart($)
    wait(w, 'Heard: "a"\nplays 0\n')
    await tick()
    wait(w, 'Heard: "b"\nplays 0\n')
    await tick()
    expect(w.submits).toEqual([])
    await turnEnd($)
    await tick()
    expect(w.submits).toEqual([{ text: '[voice] Heard: "a" · plays 0 | then: Heard: "b" · plays 0', asUser: true }])
    await finish($, w)
  })

  test('while a turn runs a heard turn rides the next tool result as context, ending (heard while you worked); the rest goes at the turn\'s end', async ($, on) => {
    const w = world(on)
    await bind($, w)
    await turnStart($)
    wait(w, 'Heard: "wait"\nplays 0\n')
    await tick()
    expect(w.submits).toEqual([])
    const r: any = await shell($, 'ls')
    expect(r.context).toEqual(['[voice] Heard: "wait" · plays 0 (heard while you worked)'])
    // Heard after that tool step: it waits for the turn's end, and goes as a prompt.
    wait(w, 'Heard: "and then"\nplays 0\n')
    await tick()
    expect(w.submits).toEqual([])
    await turnEnd($)
    await tick()
    expect(w.submits).toEqual([{ text: '[voice] Heard: "and then" · plays 0', asUser: true }])
    await finish($, w)
  })

  test('a refused submit is tried again every second, in order; after 20 tries the batch is dropped and the next delivery says how many', async ($, on) => {
    const w = world(on)
    await bind($, w)
    w.refuse = 100
    wait(w, 'Heard: "one"\nplays 0\n')
    await tick()
    await w.clock.advance(25_000)
    expect(w.submits.length).toBe(20)
    expect(w.submits.every(s => s.text === '[voice] Heard: "one" · plays 0')).toBe(true)
    w.refuse = 0
    wait(w, 'Heard: "two"\nplays 0\n')
    await tick()
    expect(w.submits.at(-1)?.text).toBe('[voice] dropped 1 | then: Heard: "two" · plays 0')
    await finish($, w)
  })

  test('the relay writes no file: no heard text is kept anywhere', async ($, on) => {
    const w = world(on)
    await bind($, w)
    wait(w, 'Heard: "a private thing"\nplays 0\n')
    await tick()
    await turnStart($)
    wait(w, 'Heard: "another"\nplays 0\n')
    await tick()
    await shell($, 'ls')
    await turnEnd($)
    await tick()
    expect(w.writes).toEqual([])
    await finish($, w)
  })

  test('stopped, and a listener error other than waiting or ended, end the binding after the notice goes out', async ($, on) => {
    const w = world(on)
    await bind($, w)
    wait(w, 'stopped\n')
    await tick()
    expect(w.submits).toEqual([{ text: '[voice] stopped', asUser: true }])
    const before = w.spawns.length
    await w.clock.advance(5000)
    expect(w.spawns.length).toBe(before)
    await finish($, w)
  })

  test('a listener that is not up yet (listener error ended) is waited for; waiting three times in a row ends the binding', async ($, on) => {
    const w = world(on)
    await bind($, w)
    wait(w, 'listener error ended\n')
    await w.clock.advance(2100)
    expect(w.submits).toEqual([])
    expect(w.spawns.length).toBeGreaterThan(1)
    for (let i = 0; i < 3; i++) {
      wait(w, 'listener error waiting\n')
      await w.clock.advance(31_000)
    }
    const before = w.spawns.length
    await w.clock.advance(60_000)
    expect(w.spawns.length).toBe(before)
    await finish($, w)
  })
})

describe('permission nudge and progress', () => {
  test('a permission prompt in a bound session runs nudge.mjs, not awaited, and passes the event on unchanged', async ($, on) => {
    const w = world(on)
    w.permission = { hookSpecificOutput: { decision: { behavior: 'allow' } } }
    await bind($, w)
    const answer = await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as any)
    expect(answer).toEqual({ hookSpecificOutput: { decision: { behavior: 'allow' } } })
    await tick()
    expect(w.runs.length).toBe(1)
    expect(w.runs[0][0]).toBe('node')
    expect(w.runs[0][1].replace(/\\/g, '/')).toMatch(/\/skills\/incantation\/scripts\/nudge\.mjs$/)
    expect(w.runs[0].length).toBe(2)
    await finish($, w)
  })

  test('with no binding a permission prompt runs nothing', async ($, on) => {
    const w = world(on)
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as any)
    await tick()
    expect(w.runs).toEqual([])
    await finish($, w)
  })

  test('a progress-due held 10 s with no tool call runs nudge.mjs progress once and is dropped', async ($, on) => {
    const w = world(on)
    await bind($, w)
    await turnStart($)
    wait(w, 'progress-due\n')
    await tick()
    await w.clock.advance(10_500)
    expect(w.runs.length).toBe(1)
    expect(w.runs[0][2]).toBe('progress')
    // It is gone: the next tool call carries nothing.
    const r: any = await shell($, 'ls')
    expect(r.context).toBeUndefined()
    await turnEnd($)
    await tick()
    expect(w.submits).toEqual([])
    await finish($, w)
  })

  test('a progress-due that a tool call carries rides as context, and the mod speaks nothing', async ($, on) => {
    const w = world(on)
    await bind($, w)
    await turnStart($)
    wait(w, 'progress-due\n')
    await tick()
    const r: any = await shell($, 'ls')
    expect(r.context).toEqual(['[voice] progress-due (heard while you worked)'])
    await w.clock.advance(11_000)
    expect(w.runs).toEqual([])
    await turnEnd($)
    await finish($, w)
  })

  test('a progress-due with no turn running is dropped, not sent', async ($, on) => {
    const w = world(on)
    await bind($, w)
    wait(w, 'progress-due\n')
    await tick()
    await w.clock.advance(11_000)
    expect(w.submits).toEqual([])
    expect(w.runs).toEqual([])
    await finish($, w)
  })
})
