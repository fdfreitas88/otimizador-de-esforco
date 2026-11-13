import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The engine beneath the mod, in auto mode, with the pick model answering `pickJson`.
function engine(on: On, pickJson: string, model = 'claude-opus-5-5') {
  mock.store(on, { mode: 'auto' })
  on('session.model', () => ({ value: model }))
  const state = new Map<string, unknown>()
  on('state.get', (_, e) => ({ value: { value: state.get(`${e.plugin}.${e.key}`) ?? null, version: 1 } }))
  on('state.set', (_, e) => {
    state.set(`${e.plugin}.${e.key}`, e.value)
    return { value: { isSet: true as const, version: 2 } }
  })
  on('command.register', () => ({ value: { command: 'otimizador-de-esforco' } }))
  on('config.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(typeof e.prompt === 'string' ? e.prompt : '')
    return { value: { isAnswered: true, text: pickJson, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  const sent: (string | number | undefined)[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { prompts, sent }
}

async function turn($: Engine, text: string, model: string) {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
  const s = $.turn.step({ turnId: 't1', index: 0, model, effort: 'high', messageCount: 1 })
  for await (const _ of s) {
    // drain
  }
}

test('on Fable 5.2 a max pick the prompt did not ask for runs at xhigh', async ($, on) => {
  const { prompts, sent } = engine(on, '{"level":"max","why":"critical handoff"}', 'claude-fable-5-2')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'Write the full due diligence report on this acquisition.', 'claude-fable-5-2')
  expect(sent).toEqual(['xhigh'])
  expect(prompts[0]).toContain('Claude Fable')
})

test('on Fable 5.2 a prompt that asks for max effort gets max', async ($, on) => {
  const { sent } = engine(on, '{"level":"max","why":"asked for it"}', 'claude-fable-5-2')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'Use maximum effort: review this 50 page agreement, it is critical.', 'claude-fable-5-2')
  expect(sent).toEqual(['max'])
})

test('on Opus 5.5 the pick is sent as is and the prompt names Opus', async ($, on) => {
  const { prompts, sent } = engine(on, '{"level":"low","why":"quick rewrite"}')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'Make this sentence friendlier.', 'claude-opus-5-5')
  expect(sent).toEqual(['low'])
  expect(prompts[0]).toContain('Claude Opus')
})
