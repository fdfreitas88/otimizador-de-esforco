import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The engine beneath the mod: the session runs on `model`, the pick answers `pickJson`,
// and the person answers the dialog with the option `choose` picks from those offered.
function engine(on: On, pickJson: string, model: string, choose: (options: readonly string[]) => string) {
  mock.store(on, { mode: 'suggest' })
  on('session.model', () => ({ value: model }))
  const state = new Map<string, unknown>()
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
  on('fs.write', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const submitted: string[] = []
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const asked: { question: string; options: readonly string[] }[] = []
  // $.ui.ask is an AskUserQuestion tool call: answer it as the person would.
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!
    const options = q.options.map(o => o.label)
    asked.push({ question: q.question, options })
    return { result: { questions: e.questions, answers: { [q.question]: choose(options) } } }
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: pickJson, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }))
  const sent: (string | number | undefined)[] = []
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { submitted, asked, sent }
}

async function turn($: Engine, text: string, model: string, effort: 'medium' | 'high' = 'medium') {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1 })) {
    // drain
  }
}

test('on Fable a routine task offers Sonnet, and a yes sends a handoff prompt at low effort', async ($, on) => {
  const { submitted, asked, sent } = engine(on, '{"level":"medium","model":"sonnet","why":"everyday rewrite"}', 'claude-fable-5-2', o => o[0]!)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'Rewrite the README intro to be friendlier.', 'claude-fable-5-2')
  expect(asked.length).toBe(1)
  expect(asked[0]!.options[0]).toBe('Abrir nova sessão no Sonnet com esforço Médio')
  expect(submitted[0]).toContain('[Otimizador de esforço: repasse]')
  expect(submitted[0]).toContain('claude-sonnet-5-5')
  expect(submitted[0]).toContain('Rewrite the README intro to be friendlier.')
  expect(sent).toEqual(['low'])
})

test('on Sonnet a critical task offers Opus with a stronger level; staying switches the level', async ($, on) => {
  const { submitted, asked, sent } = engine(on, '{"level":"high","model":"opus","why":"contract risk review"}', 'claude-sonnet-5-5', o => o[1]!)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'Review this contract for risks before I sign.', 'claude-sonnet-5-5')
  expect(asked[0]!.options).toEqual(['Abrir nova sessão no Opus com esforço Alto', 'Ficar aqui, mudar para Alto', 'Ficar aqui como está'])
  expect(submitted[0]).toBe('Review this contract for risks before I sign.')
  expect(sent).toEqual(['high'])
})

test('a declined model is not offered again this session', async ($, on) => {
  const { asked } = engine(on, '{"level":"medium","model":"sonnet","why":"routine"}', 'claude-opus-5-5', o => o[o.length - 1]!)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'Summarize this file.', 'claude-opus-5-5')
  await turn($, 'Summarize that other file.', 'claude-opus-5-5')
  expect(asked.length).toBe(1)
})

test('a move the wrong way is never offered (Sonnet down to Haiku, Fable up)', async ($, on) => {
  const { asked, submitted } = engine(on, '{"level":"low","model":"haiku","why":"trivial"}', 'claude-sonnet-5-5', o => o[0]!)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'Sort this list.', 'claude-sonnet-5-5')
  expect(asked.some(a => a.options.some(o => o.startsWith('Abrir nova')))).toBe(false)
  expect(submitted[0]).toBe('Sort this list.')
})
