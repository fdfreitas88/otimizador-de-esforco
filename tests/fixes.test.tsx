import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { engine, send, start } from './engine'

test('a keep answer leaves the level alone and is not logged as unreadable', async ($, on) => {
  const s = engine(on, { pick: '{"level":"keep","why":"approves earlier work"}' })
  await start($)
  await send($, s, 'yes, go ahead')
  expect(s.commands).toEqual([])
  expect(s.submitted).toEqual(['yes, go ahead'])
  expect(s.sent).toEqual(['medium'])
  expect(s.writes.some(w => w.text.includes('pick unreadable'))).toBe(false)
})

test('auto mode: /effort moves the menu before the prompt, which then starts at the new level', async ($, on) => {
  const s = engine(on, { pick: '{"level":"high","why":"risky review"}' })
  await start($)
  await send($, s, 'Review this contract.')
  // The menu moved first; the prompt came back right after, as typed; no per-request override was needed.
  expect(s.commands).toEqual(['/effort high'])
  expect(s.submitted).toEqual(['Review this contract.'])
  expect(s.sent).toEqual(['high'])
  expect(s.writes.some(w => w.text.includes('request:'))).toBe(false)
})

test('suggest mode: the switch runs /effort right after the person accepts', async ($, on) => {
  const s = engine(on, { pick: '{"level":"high","why":"risky review"}', mode: 'suggest' })
  await start($)
  await send($, s, 'Review this contract.')
  expect(s.asked[0]!.options[0]).toBe('Mudar para Alto')
  expect(s.commands).toEqual(['/effort high'])
  expect(s.sent).toEqual(['high'])
})

test('suggest mode: keeping the level sends the prompt at once, menu untouched', async ($, on) => {
  const s = engine(on, { pick: '{"level":"high","why":"risky review"}', mode: 'suggest', choose: o => o[o.length - 1]! })
  await start($)
  await send($, s, 'Review this contract.')
  expect(s.commands).toEqual([])
  expect(s.submitted).toEqual(['Review this contract.'])
  expect(s.sent).toEqual(['medium'])
})

test('a prompt with an @file mention goes at once by the override; the menu follows after the reply', async ($, on) => {
  const s = engine(on, { pick: '{"level":"high","why":"risky review"}' })
  await start($)
  await send($, s, 'Review @contract.md for risks.')
  expect(s.submitted).toEqual(['Review @contract.md for risks.'])
  expect(s.sent).toEqual(['high'])
  expect(s.commands).toEqual(['/effort high'])
})

test('the log goes to a .claude/mods-logs file named after the mod', async ($, on) => {
  const s = engine(on, { pick: '{"level":"low","why":"quick rewrite"}' })
  await start($)
  await send($, s, 'Make this friendlier.')
  // Where .claude/ sits depends on where the mod is installed; the file name is the mod's own.
  expect(s.writes.map(w => w.path).join(', ')).toContain('/.claude/mods-logs/otimizador-de-esforco.log')
})

// The engine's own footer: the modes joined.
function footer(on: On) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const modes = (e.props as { modes: readonly string[] }).modes
    return <Text>{modes.join(' & ')}</Text>
  })
}

test('on desktop the mod draws its own footer label, beside the other modes', async ($, on) => {
  engine(on, { pick: '{"level":"keep","why":""}', override: 'high' })
  footer(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'otimizador-de-esforco', component: 'SessionMode', surface: 'desktop', props: { modes: ['focus'] } })
  expect((await ui.find({ type: 'Text', text: /^Esforço Alto$/ }))?.text).toBe('Esforço Alto')
  expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  await ui.unmount()
})

test('on desktop with no other modes, only the label is drawn', async ($, on) => {
  engine(on, { pick: '{"level":"keep","why":""}', override: 'high' })
  footer(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'otimizador-de-esforco', component: 'SessionMode', surface: 'desktop', props: { modes: [] } })
  expect((await ui.find({ type: 'Text', text: /Esforço/ }))?.text).toBe('Esforço Alto')
  await ui.unmount()
})

test('on the terminal the label joins the footer modes', async ($, on) => {
  engine(on, { pick: '{"level":"keep","why":""}', override: 'high' })
  footer(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'otimizador-de-esforco', component: 'SessionMode', surface: 'terminal', props: { modes: ['focus'] } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('focus & Esforço Alto')
  await ui.unmount()
})
