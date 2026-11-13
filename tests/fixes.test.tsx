import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The engine beneath the mod, in auto mode, with the pick model answering `pickJson`.
function engine(on: On, pickJson: string, override: string | null = null) {
  mock.store(on, { mode: 'auto' })
  const state = new Map<string, unknown>([['otimizador-de-esforco.override', override]])
  on('state.get', (_, e) => ({ value: { value: state.get(`${e.plugin}.${e.key}`) ?? null, version: 1 } }))
  on('state.set', (_, e) => {
    state.set(`${e.plugin}.${e.key}`, e.value)
    return { value: { isSet: true as const, version: 2 } }
  })
  on('command.register', () => ({ value: { command: 'otimizador-de-esforco' } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('config.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.messages', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: pickJson, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }))
  const sent: (string | number | undefined)[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { sent, writes }
}

test('a keep answer leaves the level alone and is not logged as unreadable', async ($, on) => {
  const { sent, writes } = engine(on, '{"level":"keep","why":"approves earlier work"}')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'yes, go ahead', origin: { kind: 'composer' }, wait: false })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    // drain
  }
  expect(sent).toEqual(['medium'])
  expect(writes.some(w => w.text.includes('pick unreadable'))).toBe(false)
})

test('the log goes to a .claude/mods-logs file named after the mod', async ($, on) => {
  const { writes } = engine(on, '{"level":"low","why":"quick rewrite"}')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Make this friendlier.', origin: { kind: 'composer' }, wait: false })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    // drain
  }
  // Where .claude/ sits depends on where the mod is installed; the file name is the mod's own.
  expect(writes.map(w => w.path).join(', ')).toContain('/.claude/mods-logs/otimizador-de-esforco.log')
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
  engine(on, '{"level":"keep","why":""}', 'high')
  footer(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'otimizador-de-esforco', component: 'SessionMode', surface: 'desktop', props: { modes: ['focus'] } })
  expect((await ui.find({ type: 'Text', text: /^Esforço Alto$/ }))?.text).toBe('Esforço Alto')
  expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus')
  await ui.unmount()
})

test('on desktop with no other modes, only the label is drawn', async ($, on) => {
  engine(on, '{"level":"keep","why":""}', 'high')
  footer(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'otimizador-de-esforco', component: 'SessionMode', surface: 'desktop', props: { modes: [] } })
  expect((await ui.find({ type: 'Text', text: /Esforço/ }))?.text).toBe('Esforço Alto')
  await ui.unmount()
})

test('on the terminal the label joins the footer modes', async ($, on) => {
  engine(on, '{"level":"keep","why":""}', 'high')
  footer(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'otimizador-de-esforco', component: 'SessionMode', surface: 'terminal', props: { modes: ['focus'] } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('focus & Esforço Alto')
  await ui.unmount()
})
