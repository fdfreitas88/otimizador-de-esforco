import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Options = {
  /** What the pick model answers. */
  pick: string
  /** The session's model. */
  model?: string
  mode?: 'auto' | 'suggest'
  /** The app's effort menu: what each request carries until /effort moves it. */
  menu?: Level
  /** The footer override already stored. */
  override?: Level | null
  /** Which offered option the person picks in a dialog. */
  choose?: (options: readonly string[]) => string
}

// The engine beneath the mod, standing in for the app: /effort moves `menu`, and a turn runs at it.
export function engine(on: On, o: Options) {
  mock.store(on, { mode: o.mode ?? 'auto' })
  const s = {
    model: o.model ?? 'claude-opus-5-5',
    menu: (o.menu ?? 'medium') as Level,
    commands: [] as string[],
    submitted: [] as string[],
    asked: [] as { question: string; options: readonly string[] }[],
    prompts: [] as string[],
    sent: [] as (string | number | undefined)[],
    writes: [] as { path: string; text: string }[],
  }
  on('session.model', () => ({ value: s.model }))
  const state = new Map<string, unknown>([['otimizador-de-esforco.override', o.override ?? null]])
  on('state.get', (_, e) => ({ value: { value: state.get(`${e.plugin}.${e.key}`) ?? null, version: 1 } }))
  on('state.set', (_, e) => {
    state.set(`${e.plugin}.${e.key}`, e.value)
    return { value: { isSet: true as const, version: 2 } }
  })
  on('command.register', () => ({ value: { command: 'otimizador-de-esforco' } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('config.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_, e) => {
    s.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.messages', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', (_, e) => {
    s.commands.push(`/${e.command} ${e.args}`)
    if (e.command === 'effort') s.menu = e.args as Level
    return { text: 'ok' }
  })
  on('prompt.submit', (_, e) => {
    s.submitted.push(e.text)
    return { text: e.text }
  })
  // $.ui.ask is an AskUserQuestion tool call: answer it as the person would.
  const choose = o.choose ?? (options => options[0]!)
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!
    const options = q.options.map(x => x.label)
    s.asked.push({ question: q.question, options })
    return { result: { questions: e.questions, answers: { [q.question]: choose(options) } } }
  })
  on('model.complete', (_, e) => {
    s.prompts.push(typeof e.prompt === 'string' ? e.prompt : '')
    return { value: { isAnswered: true, text: o.pick, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('turn.step', async function* (_, e) {
    s.sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return s
}

export type Stand = ReturnType<typeof engine>

// Lets timers and the work they start finish.
export async function settle() {
  for (let i = 0; i < 200; i += 1) await Promise.resolve()
}

// The person types `text`; when a prompt entered (typed, or sent again by the mod), its turn runs at the menu's level.
export async function send($: Engine, s: Stand, text: string) {
  const before = s.submitted.length
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
  await settle()
  if (s.submitted.length === before) return
  const turnId = `t${s.submitted.length}`
  for await (const _ of $.turn.step({ turnId, index: 0, model: s.model, effort: s.menu, messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ turnId, answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
  await settle()
}

export async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}
