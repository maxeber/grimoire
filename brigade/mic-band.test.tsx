import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { advanceLine, commandFile, fullWidth, levelsFile, voiceFile } from './mic-view.ts'
import { orbSvg, phase } from './mic-svg.ts'

// The Incantation mic band, driven the way the person sees it: the listener's
// levels file appears, changes and goes, and the button is pressed. Runs under
// `claude plugin test .`, which gives a plugin no file system: the hooks below
// hold a small one in memory, and the clock is the test's.

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const ON_WINDOWS = /^file:\/\/\/[A-Za-z]:/.test(import.meta.url)
const HOME = ON_WINDOWS ? 'C:\\Work\\owner' : '/work/owner'
const LEVELS = levelsFile(HOME)
const COMMAND = commandFile(HOME)
const VOICE = voiceFile(HOME)
const WAVE = '000012345678765432100000'

function world(on: On) {
  const w = { files: new Map<string, string>(), writes: [] as [string, string][], reads: 0, busy: false, clock: undefined as unknown as ReturnType<typeof mock.clock> }
  w.clock = mock.clock(on)
  on('env.get', (_$, e: any) => ({ value: e.name === 'USERPROFILE' || e.name === 'HOME' ? HOME : undefined }))
  on('fs.read', (_$, e: any) => {
    if (e.path === LEVELS) w.reads++
    if (w.busy) return { deny: 'EBUSY: resource busy or locked' }
    return w.files.has(e.path) ? { value: w.files.get(e.path) } : { deny: 'ENOENT: no such file or directory' }
  })
  on('fs.write', (_$, e: any) => {
    w.writes.push([e.path, String(e.text)])
    w.files.set(e.path, String(e.text))
    return { value: undefined }
  })
  // The engine's own band: an empty box, so a hidden band draws nothing more.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return w
}
const levels = (w: ReturnType<typeof world>, word: string, digits = WAVE, at = w.clock.now()) => w.files.set(LEVELS, `${at} ${word} ${digits}\n`)
const mount = ($: any, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', props: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'grimoire', surface, ...BAND, props: { ...BAND.props, ...props } })

describe('mic band', () => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    test(`with no listener the band draws nothing, and with one it draws the state word, the wave and a mute button (${surface})`, async ($, on) => {
      const w = world(on)
      const ui = await mount($, surface)
      await w.clock.advance(1000)
      expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
      levels(w, 'hearing')
      // With none listening the reads come at the slow beat, two seconds apart.
      await w.clock.advance(2250)
      expect(await ui.find({ type: 'Text', text: /mic: hearing/ })).toBeDefined()
      expect(await ui.find({ key: 'mic-toggle', label: 'Mute mic' })).toBeDefined()
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Text', text: /^[▁▂▃▄▅▆▇█]{80}$/ })).toBeDefined()
      } else {
        const svg: any = await ui.find({ type: 'Svg' } as any)
        expect(svg).toBeDefined()
        expect(svg.props.isInteractive).toBe(false)
      }
      await ui.unmount()
    })
  }

  test('the desktop picture is an Svg image, not interactive, whose animations begin in the past and whose clock a redraw of the same reading keeps', async ($, on) => {
    const w = world(on)
    let ui = await mount($, 'desktop')
    levels(w, 'listening')
    await w.clock.advance(1000)
    levels(w, 'hearing')
    await w.clock.advance(400)
    // A redraw with no new reading: the surface draws the band again (a fresh
    // mount stands for it) and the picture is laid out again for the same reading.
    const draw = async () => {
      await ui.unmount()
      ui = await mount($, 'desktop')
      return (await ui.find({ type: 'Svg' } as any)) as any
    }
    const first = await draw()
    expect(first.props.isInteractive).toBe(false)
    const a = String(first.props.source)
    expect(a).toContain('<animateTransform')
    expect(a).toMatch(/<animateTransform[^>]*begin="-\d+ms"/)
    // The same reading drawn again a moment later: the wave's points, which
    // hold the picture's clock, do not move; only the start does.
    await w.clock.advance(60)
    const b = String((await draw()).props.source)
    const paths = (s: string) => [...s.matchAll(/<path d="([^"]+)"/g)].map(m => m[1])
    const begins = (s: string) => [...s.matchAll(/begin="(-\d+)ms"/g)].map(m => Number(m[1]))
    expect(paths(a).length).toBe(2)
    expect(paths(b)).toEqual(paths(a))
    expect(Math.min(...begins(b))).toBeLessThan(Math.min(...begins(a)))
    await ui.unmount()
  })

  test('the terminal rows are as wide as the viewport, two mirrored rows', async ($, on) => {
    const w = world(on)
    levels(w, 'hearing')
    const ui = await $.ui.mount({ plugin: 'grimoire', surface: 'terminal', ...BAND, viewport: { columns: 120, rows: 40, isFullscreen: false } } as any)
    await w.clock.advance(1000)
    const up: any = await ui.find({ type: 'Text', text: /^[▁▂▃▄▅▆▇█]+$/ } as any)
    const down: any = await ui.find({ type: 'Text', text: /^[▔▀█]+$/ } as any)
    expect(String(up.text).length).toBe(120)
    expect(String(down.text).length).toBe(120)
    await ui.unmount()
  })

  test('the button writes mute, and once muted unmute, to the listener\'s command file and nothing else', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'desktop')
    levels(w, 'listening')
    await w.clock.advance(1000)
    await ui.press({ key: 'mic-toggle' })
    expect(w.writes).toEqual([[COMMAND, 'mute']])
    levels(w, 'muted')
    await w.clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: /mic: muted/ })).toBeDefined()
    expect(await ui.find({ key: 'mic-toggle', label: 'Unmute mic' })).toBeDefined()
    const svg: any = await ui.find({ type: 'Svg' } as any)
    expect(String(svg.props.source)).toContain('#8a8f9c')
    await ui.press({ key: 'mic-toggle' })
    expect(w.writes).toEqual([[COMMAND, 'mute'], [COMMAND, 'unmute']])
    await ui.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the band draws the working word and a voice button; a press writes mute-voice, and with run/voice muted unmute-voice (${surface})`, async ($, on) => {
      const w = world(on)
      const ui = await mount($, surface)
      levels(w, 'working')
      await w.clock.advance(1000)
      expect(await ui.find({ type: 'Text', text: /mic: working/ })).toBeDefined()
      expect(await ui.find({ key: 'voice-toggle', label: 'Mute voice' })).toBeDefined()
      await ui.press({ key: 'voice-toggle' })
      expect(w.writes).toEqual([[COMMAND, 'mute-voice']])
      // The listener answers by writing run/voice; the band reads it on its next beat.
      w.files.set(VOICE, 'muted\n')
      await w.clock.advance(1000)
      expect(await ui.find({ key: 'voice-toggle', label: 'Unmute voice' })).toBeDefined()
      await ui.press({ key: 'voice-toggle' })
      expect(w.writes).toEqual([[COMMAND, 'mute-voice'], [COMMAND, 'unmute-voice']])
      // The mic button is the mic's alone: it still writes mute.
      await ui.press({ key: 'mic-toggle' })
      expect(w.writes.at(-1)).toEqual([COMMAND, 'mute'])
      await ui.unmount()
    })
  }

  test('the band follows the file: a new word and new digits redraw, a removed file or an old stamp clears it', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'terminal')
    levels(w, 'listening', '0'.repeat(24))
    await w.clock.advance(500)
    expect(await ui.find({ type: 'Text', text: /mic: listening/ })).toBeDefined()
    levels(w, 'speaking')
    await w.clock.advance(500)
    expect(await ui.find({ type: 'Text', text: /mic: speaking/ })).toBeDefined()
    w.files.delete(LEVELS)
    await w.clock.advance(500)
    expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    levels(w, 'hearing', WAVE, w.clock.now() - 60_000)
    await w.clock.advance(2000)
    expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    await ui.unmount()
  })

  test('a file that is not the listener\'s shape draws nothing: wrong word, short row, a digit past 8, a long line', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'desktop')
    for (const text of [`${w.clock.now()} shouting ${WAVE}\n`, `${w.clock.now()} hearing 0123\n`, `${w.clock.now()} hearing ${'9'.repeat(24)}\n`, `${w.clock.now()} hearing ${WAVE} words here`, 'x'.repeat(200)]) {
      w.files.set(LEVELS, text)
      await w.clock.advance(500)
      expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    }
    await ui.unmount()
  })

  test('a survey holds the band: nothing is drawn over it', async ($, on) => {
    const w = world(on)
    levels(w, 'hearing')
    const ui = await mount($, 'desktop', { hasSurvey: true })
    await w.clock.advance(1000)
    expect(await ui.find({ key: 'mic-toggle' })).toBeUndefined()
    await ui.unmount()
  })

  test('the reads: four a second while a listener writes, about one a second and a half without', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'desktop')
    await w.clock.advance(8000)
    const idle = w.reads
    expect(idle).toBeLessThanOrEqual(5)
    levels(w, 'listening')
    w.reads = 0
    for (let i = 0; i < 8; i++) {
      levels(w, 'listening')
      await w.clock.advance(1000)
    }
    // Back at the fast beat within one slow beat, then four a second.
    expect(w.reads).toBeGreaterThanOrEqual(24)
    expect(w.reads).toBeLessThanOrEqual(34)
    await ui.unmount()
  })

  // The picture itself, a pure function: no mount, no clock but the ones it is given.
  const SOFT = '2'.repeat(24)
  const LOUD = '8'.repeat(24)
  const animations = (src: string) => [...src.matchAll(/<animate(?:Transform)?\s[^>]*>/g)].map(m => m[0])

  test('the speaking picture has no wave, one slow ripple and a breathing orb, each kept in phase by a begin', async () => {
    const now = 5000
    const el = 120
    const src = orbSvg(WAVE, WAVE, 'speaking', 250, 1000, now, el)
    expect(src).not.toContain('<path d=')
    expect(src.match(/<circle[^>]*stroke-opacity="0"/g)?.length).toBe(1)
    expect(src).toContain(`dur="2200ms" begin="${Math.round(phase(now + el, 2200))}ms" repeatCount="indefinite"`)
    expect(src).toContain('values="12;19;14;21;13;18;12" dur="1900ms" begin="' + Math.round(phase(now + el, 1900)) + 'ms" repeatCount="indefinite"')
    // A redraw of the same reading a moment later resumes the breath at the later phase.
    const later = orbSvg(WAVE, WAVE, 'speaking', 250, 1000, now + 60, el + 60)
    expect(later).not.toBe(src)
    expect(later).toContain('begin="' + Math.round(phase(now + 60 + el + 60, 1900)) + 'ms"')
  })

  test('every animation in the hearing, speaking and first pictures carries a begin', async () => {
    for (const src of [orbSvg(WAVE, WAVE, 'hearing', 250, 1000, 5000, 400), orbSvg('', WAVE, 'hearing', 250, 1000, 5000, 100), orbSvg(WAVE, WAVE, 'speaking', 250, 1000, 5000, 100), orbSvg(WAVE, WAVE, 'muted', 250, 1000, 5000, 100)]) {
      const all = animations(src)
      expect(all.length).toBeGreaterThan(0)
      for (const a of all) expect(a).toMatch(/\sbegin="-?\d+ms"/)
    }
    // The first picture's grow reveal is among them.
    expect(animations(orbSvg('', WAVE, 'hearing', 250, 1000, 5000, 100)).filter(a => a.includes('dur="350ms"')).length).toBe(2)
  })

  test('ripples: none for soft sound, at most one every fourth reading, reaching 15 + 60 v/8 over 2.2 s from r 2', async () => {
    expect(orbSvg(SOFT, SOFT, 'hearing', 250, 1000, 5000, 100).match(/<circle[^>]*stroke-opacity="0"/g)).toBeNull()
    const loud = orbSvg(LOUD, LOUD, 'hearing', 250, 1000, 5000, 100)
    const rings = loud.match(/<circle[^>]*stroke-opacity="0"/g) ?? []
    // Ages under 2.2 s are under 9 readings: with one a fourth reading, two or three.
    expect(rings.length).toBeGreaterThanOrEqual(2)
    expect(rings.length).toBeLessThanOrEqual(3)
    expect(loud).toContain('<animate attributeName="r" from="2.0" to="77.0" dur="2200ms"')
    // Muted: no ripple at all.
    expect(orbSvg(LOUD, LOUD, 'muted', 250, 1000, 5000, 100).match(/<circle[^>]*stroke-opacity="0"/g)).toBeNull()
  })

  test('a muted picture is a flat line: every point of the wave sits on the middle', async () => {
    const src = orbSvg(LOUD, LOUD, 'muted', 250, 1000, 5000, 100)
    const paths = [...src.matchAll(/<path d="([^"]+)"/g)].map(m => m[1])
    expect(paths.length).toBe(2)
    for (const d of paths) {
      const ys = new Set([...d.matchAll(/,(-?[\d.]+)/g)].map(m => m[1]))
      expect([...ys]).toEqual(['22.0'])
    }
    const live = [...orbSvg(LOUD, LOUD, 'hearing', 250, 1000, 5000, 100).matchAll(/<path d="([^"]+)"/g)].map(m => m[1])
    expect(new Set([...live[0].matchAll(/,(-?[\d.]+)/g)].map(m => m[1])).size).toBeGreaterThan(5)
  })

  test('the terminal draws a muted mic as a flat line, and rows past 400 columns stay full width', async () => {
    expect(fullWidth(WAVE, 'muted', 10)).toEqual(['▁'.repeat(10), '▔'.repeat(10)])
    expect(fullWidth(WAVE, 'hearing', 500)[0].length).toBe(500)
  })

  test('the reading clock steps by the shift the digits show, and resets to the stamp only past two readings of drift', async () => {
    const ms = 250
    const a = '012345678765432101234567'
    const next = a.slice(1) + '3'
    const first = advanceLine({ t: -1, stamp: 0, digits: '' }, 10_000, a, ms)
    expect(first).toEqual({ t: 10_000, stamp: 10_000, digits: a })
    // The wave moved one place; the stamp is a reading late (jitter): still one reading.
    const one = advanceLine(first, 10_000 + 2 * ms, next, ms)
    expect(one.t).toBe(10_000 + ms)
    // Drift past two readings from the stamp resets the clock to it.
    const far = advanceLine(first, 10_000 + 5 * ms, next, ms)
    expect(far.t).toBe(10_000 + 5 * ms)
    // Two readings of drift do not.
    const two = advanceLine(first, 10_000 + 3 * ms, next, ms)
    expect(two.t).toBe(10_000 + ms)
    // A different number of digits starts over.
    expect(advanceLine(first, 20_000, a.slice(0, 20), ms).t).toBe(20_000)
  })


  test('a sustained level keeps the listener alive: one read that fails after ten unchanged seconds does not hide the band', async ($, on) => {
    const w = world(on)
    const ui = await mount($, 'desktop')
    for (let i = 0; i < 14; i++) {
      levels(w, 'listening', '0'.repeat(24))
      await w.clock.advance(1000)
    }
    w.busy = true
    await w.clock.advance(1000)
    expect(await ui.find({ key: 'mic-toggle' })).toBeDefined()
    await ui.unmount()
  })

})
