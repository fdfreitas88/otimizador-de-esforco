import type { ConfigRow, EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Band, Level } from '../types'

const BAND = { plugin: 'otimizador-de-esforco', key: 'band' } as const
const OVERRIDE = { plugin: 'otimizador-de-esforco', key: 'override' } as const
// Fits the footer slot (about 14 cells).
const SHORT = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'X-Alto', max: 'Máx' } as const

const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
const NAMES: Record<Level, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo' }

const APPLIED_MS = 15000
const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'

type Mode = 'suggest' | 'auto'
// A model the task could move to, from the strongest down.
type Target = 'fable' | 'opus' | 'sonnet' | 'haiku'
// level null: keep the chat's level. move null: stay on this model.
type Pick = { level: Level | null; move: Target | null; why: string }

const TARGETS: readonly Target[] = ['fable', 'opus', 'sonnet', 'haiku']
const MODEL_IDS: Record<Target, string> = {
  fable: 'claude-fable-5-2',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}
const MODEL_NAMES: Record<Target, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }
// Marks the prompt the mod sends in place of a handed-off task, so it is never picked again.
const HANDOFF_TAG = '[Otimizador de esforço: repasse]'

// Models the person turned down this session: not offered again until a reload.
const declined = new Set<Target>()
// Whether the mod also advises a model move (/otimizador-de-esforco models on|off).
let models = true

// Module variables reset on a reload; the band and the override live in $.state.
let home = ''
let enabled = true
let mode: Mode = 'suggest'
// Bumped on every prompt, so a slow pick for an older prompt is dropped.
let gen = 0
let nextId = 1
// The level the main chat's last request ran at, before this mod touched it.
let seen: Level | '' = ''
// The level for the rest of the running turn, set by a Switch or by auto mode.
let turnLevel: Level | null = null
// The /config row that holds the effort setting, found at session start.
let rowKey = ''
// A /effort run waiting for the turn to end.
// The level the mod puts on requests, and the picker level it saw when it took over.
let hold: { level: Level; base: string } | null = null
let lastEffort = ''
// The prompt's pick, made before it went in, waiting for the turn's first request to set the level.
// decided: 'apply' when the person already chose to switch level, 'skip' when they chose to keep it.
let held: { text: string; mine: number; pick: Pick | null; decided: 'apply' | 'skip' | null } | null = null
// The model the main chat's last request named (e.g. claude-fable-5-2).
let model = ''
// The level the app's effort menu should move to once the running reply ends, and how often that was tried.
let pendingMenu: { level: Level; tries: number } | null = null

// Model families tune effort differently, so the pick is told which one runs the chat.
type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

function targetOf(f: Family): Target | null {
  return f === 'other' ? null : f
}

function familyOf(id: string): Family {
  const m = id.toLowerCase()
  if (/fable|mythos/.test(m)) return 'fable'
  if (/opus/.test(m)) return 'opus'
  if (/sonnet/.test(m)) return 'sonnet'
  if (/haiku/.test(m)) return 'haiku'
  return 'other'
}

// What each family's effort levels mean, from Anthropic's model guidance.
const FAMILY_NOTES: Record<Family, string> = {
  fable:
    'The chat runs on Claude Fable (or Mythos), the most capable model. Its high is the normal top level: gains above high are uneven, so answer xhigh only for a long, hard, critical handoff, and max only when the prompt explicitly asks for the deepest possible work. Low and medium are strong on this model for routine work.',
  opus: 'The chat runs on Claude Opus. Its default effort is medium.',
  sonnet: 'The chat runs on Claude Sonnet. Low suits chat and quick questions; medium suits everyday coding and multistep work.',
  haiku: 'The chat runs on Claude Haiku, a small fast model. Its default effort is medium.',
  other: '',
}

// Fable and Mythos rarely gain from max: keep max for prompts that ask for it in words.
const ASKS_FOR_MAX = /\b(max(imum)?\s+effort|deepest|as\s+(deep|thorough)\s+as\s+possible|leave\s+no\s+stone)\b/i

function fitToModel(p: Pick, text: string): Pick {
  if (familyOf(model) === 'fable' && p.level === 'max' && !ASKS_FOR_MAX.test(text)) return { ...p, level: 'xhigh' }
  return p
}

// The /mods switchboard turns this mod off in every chat with switches.json.
const NAME = 'otimizador-de-esforco'
let off = false

// The person's home folder, from where the mod is loaded: an installed copy sits under ~/.claude/,
// a folder-sourced one anywhere under /Users/<name> or /home/<name>.
function homeOf(root: string) {
  const i = root.indexOf('/.claude/')
  if (i > 0) return root.slice(0, i)
  const m = /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(root)
  return m ? m[1]! : root
}

async function readSwitch($: EngineInterface) {
  let now = false
  try {
    const path = `${homeOf($.plugin.root)}/.claude/mods/switches.json`
    if (await $.fs.exists(path)) {
      const json = JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>
      now = json[NAME] === false
    }
  } catch {
    now = off
  }
  if (now === off) return
  off = now
  if (off) turnLevel = null
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

async function log($: EngineInterface, what: string, err: unknown) {
  try {
    const path = `${home}/.claude/mods-logs/otimizador-de-esforco.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const msg = err instanceof Error ? err.message : String(err)
    await $.fs.write(path, `${old.slice(-20_000)}${new Date(await $.clock.now()).toISOString()} ${what}: ${msg}\n`)
  } catch {
    // Nowhere left to report it.
  }
}

async function getBand($: EngineInterface): Promise<Band | null> {
  const { value } = await $.state.get(BAND)
  return value ?? null
}

async function setBand($: EngineInterface, b: Band | null) {
  await $.state.set(BAND, b)
}

// "Extra high", "x-high" and "xhigh" all read as xhigh.
function norm(s: string) {
  const t = s.toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'extrahigh' || t === 'xhigh') return 'xhigh'
  return t
}

function asLevel(v: unknown): Level | '' {
  if (typeof v !== 'string') return ''
  const t = norm(v)
  return (LEVELS as readonly string[]).includes(t) ? (t as Level) : ''
}

function isEffortRow(r: ConfigRow) {
  if (!/effort/i.test(`${r.key} ${r.label}`)) return false
  if (r.kind !== 'choice') return false
  return (r.options ?? []).some(o => norm(o) === 'high')
}

async function findRow($: EngineInterface) {
  const rows = await $.config.list()
  return rows.find(isEffortRow) ?? null
}

// The level the chat runs at now: the last request's, else the setting's.
async function currentLevel($: EngineInterface): Promise<Level | ''> {
  if (seen) return seen
  try {
    const row = await findRow($)
    return row ? asLevel(row.value) : ''
  } catch {
    return ''
  }
}

// Sets the chat's effort setting, or, when no setting takes it, has this mod put the level on every request
// until the person moves the picker. No /effort command is run.
async function applyLevel($: EngineInterface, level: Level) {
  turnLevel = level
  let note = ''
  try {
    const row = await findRow($)
    const option = row?.options?.find(o => norm(o) === level)
    if (row && option && !row.isLocked) {
      const r = await $.config.set({ key: row.key, value: option })
      if (!r.deny) {
        await $.state.set(OVERRIDE, null)
        return ''
      }
      note = r.deny
    } else {
      note = row ? (row.isLocked ? 'the effort setting is locked' : 'the effort setting has no such level') : 'no effort setting found'
    }
  } catch (err) {
    note = err instanceof Error ? err.message : String(err)
  }
  await log($, 'set effort', note)
  hold = { level, base: lastEffort }
  await $.state.set(OVERRIDE, level)
  redraw($)
  // The app's menu follows once this reply ends (turn.complete runs /effort).
  pendingMenu = { level, tries: 0 }
  return ''
}

// The app's effort menu follows /effort. Queued while the reply runs, the app drops it, so it runs once the
// main turn has ended: this reply went out at the level by the override, and from the next one on the menu
// itself shows it, the hold lets go and the footer label goes away. A timer, as a slash command cannot be
// run from inside a hook the turn waits on. A dropped run is tried again after the next reply, 3 times at most.
function syncMenu($: EngineInterface) {
  const p = pendingMenu
  if (!p || p.tries >= 3) {
    pendingMenu = null
    return
  }
  p.tries += 1
  try {
    $.clock.after(300, () => {
      void $.command
        .run({ command: 'effort', args: p.level })
        .then(async r => {
          if (pendingMenu === p) pendingMenu = null
          await log($, 'menu', `/effort ${p.level}: ${r.text ?? 'ok'}`)
        })
        .catch(err => log($, 'menu', `try ${p.tries}: ${err instanceof Error ? err.message : String(err)}`))
    })
  } catch (err) {
    void log($, 'menu', err)
  }
}

function redraw($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

// Plain text: no em or en dashes, never the banned word, one short line.
function cleanWhy(raw: string) {
  const r = raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\bship(s|ped|ping)?\b/gi, 'publish')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`\s]+|["'`\s.]+$/g, '')
  return r.slice(0, 90)
}

function lastAssistantText(messages: readonly SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.trim()) return m.text
  }
  return ''
}

// Four questions, asked in order: stop at the first yes.
function pickPrompt(text: string, lastReply: string, now: Level | '') {
  return `You pick the effort level an AI assistant (Claude) should use for one prompt. Effort sets how much time, reading and checking Claude spends, and how many decisions it makes alone. It is not how smart Claude is.

Ask these four questions in this order and stop at the first yes:

1. Will the person go back and forth with Claude on this, or is it a simple task? Then low.
   Examples: brainstorming options, quick rewrites (friendlier, shorter), sorting or tagging items, short summaries, rough first drafts or outlines, small tweaks to something already made, simple questions.
2. Would a hidden mistake cost money, a client, trust or a wrong decision? Then high.
   Examples: checking numbers across sources, open-ended analysis with no set path (why did churn go up), reviewing a contract for risk, fact-checking, going through long documents, verifying and testing work made at a lower level, building or fixing a skill.
3. Is the person handing off a long, hard and critical job and walking away, with no time to answer questions? All three must be true. Then xhigh.
   Examples: a full research report from a year of calls and tickets, reviewing a 50 page agreement before signing, an investor pitch deck as the best one shot. Answer max only when the prompt asks for the deepest possible work and says it is critical; otherwise xhigh.
4. Everything else is medium: everyday writing, repurposing content, meeting summaries with decisions and next steps, standard reports in a set format, quick research before a call. If you are not sure, medium.

A task being long does not make it high. Rule-following work stays low or medium.
If the prompt only approves, answers a question, or says to go on with earlier work (yes, go, ok, do it, option 2), answer keep.
${FAMILY_NOTES[familyOf(model)] ? `\n${FAMILY_NOTES[familyOf(model)]}\n` : ''}
The chat runs at: ${now || 'unknown'}

Then say which model should run this task. The chat runs on: ${familyOf(model) === 'other' ? 'unknown' : familyOf(model)}. From strongest and costliest down: fable, opus, sonnet, haiku.
- Answer a smaller model when the chat runs on fable or opus and the task is routine and low risk (question 1 or 4): sonnet for everyday coding, writing and research; haiku only for trivial formatting, sorting or lookups.
- Answer a bigger model when the chat runs on sonnet or haiku and the task is high or xhigh (question 2 or 3): opus for hard or risky work, fable for the hardest and most critical.
- Moving costs the person a new session, so answer keep when the gain is small, when the prompt builds on this chat's earlier work, when you answered keep for the level, or when unsure.

Claude's last reply (first 600 characters, for context):
<reply>
${lastReply || '(none, this is the first prompt)'}
</reply>

The new prompt:
<prompt>
${text}
</prompt>

Reply with JSON only: {"level": "low|medium|high|xhigh|max|keep", "model": "fable|opus|sonnet|haiku|keep", "why": "the reason in under 12 plain words, in Brazilian Portuguese"}`
}

function asTarget(v: unknown): Target | null {
  if (typeof v !== 'string') return null
  const t = v.toLowerCase().trim()
  return (TARGETS as readonly string[]).includes(t) ? (t as Target) : null
}

// "keep" is a valid answer for either field. Null only when the reply is not the JSON asked for.
function parsePick(text: string): Pick | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { level?: unknown; model?: unknown; why?: unknown }
    const isKeep = typeof j.level === 'string' && j.level.toLowerCase().trim() === 'keep'
    const level = asLevel(j.level) || null
    if (!level && !isKeep) return null
    return { level, move: asTarget(j.model), why: cleanWhy(typeof j.why === 'string' ? j.why : '') }
  } catch {
    return null
  }
}

// Only a real move, the person did not turn down this session, and one the guidance allows:
// down from Fable or Opus, up from Sonnet or Haiku.
function usableMove(p: Pick): Target | null {
  const from = targetOf(familyOf(model))
  const to = p.move
  if (!models || !from || !to || to === from || declined.has(to)) return null
  const rank: Record<Target, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 }
  const down = rank[to] < rank[from]
  if (down && (from === 'sonnet' || from === 'haiku')) return null
  if (!down && (from === 'fable' || from === 'opus')) return null
  return to
}

async function pick($: EngineInterface, text: string, now: Level | ''): Promise<Pick | null> {
  const messages = await $.session.messages()
  const lastReply = lastAssistantText(messages).slice(0, 600)
  const r = await $.model.complete({
    model: 'claude-sonnet-5-5',
    prompt: pickPrompt(text.slice(0, 4000), lastReply, now),
    // The 5.x models always think, and thinking counts against this cap: a small cap ends the reply before the JSON.
    maxTokens: 1024,
    effort: 'low',
    timeoutMs: 30_000,
  })
  if (!r.isAnswered) throw new Error(`pick failed: ${r.reason}`)
  const p = parsePick(r.text)
  if (!p) {
    await log($, 'pick unreadable', r.text.slice(0, 200))
    return null
  }
  return fitToModel(p, text)
}

async function hideLater($: EngineInterface, id: number) {
  try {
    await $.clock.sleep(APPLIED_MS)
  } catch {
    // A reload or session end cancels the timer; the next band replaces this one anyway.
    return
  }
  const b = await getBand($)
  if (b && b.id === id && b.phase === 'applied') await setBand($, null)
}

async function showApplied($: EngineInterface, p: { level: Level; why: string }, from: Level | '', note: string) {
  const id = nextId++
  await setBand($, { phase: 'applied', id, level: p.level, from, why: p.why, note })
  void hideLater($, id).catch(err => log($, 'hide', err))
}

// Picks with a status line while it runs; a failed pick is logged and reads as no pick.
async function pickWithStatus($: EngineInterface, text: string, now: Level | ''): Promise<Pick | null> {
  try {
    await $.ui.status('avaliando o esforço…')
  } catch {
    // The status line is a nicety.
  }
  try {
    return await pick($, text, now)
  } catch (err) {
    await log($, 'pick', err)
    return null
  } finally {
    try {
      await $.ui.status(undefined)
    } catch {
      // Nothing to clear.
    }
  }
}

// The prompt sent in place of a handed-off task: Claude opens the new session and does not do the task here.
function handoffText(task: string, to: Target, level: Level | null) {
  const id = MODEL_IDS[to]
  const effort = level ? ` at ${level} effort` : ''
  return `${HANDOFF_TAG} The person chose to run the task below in a new session on Claude ${MODEL_NAMES[to]} (${id})${effort}, not in this one. Do not do the task here.

In the Claude desktop app: start one new session now with the start_session tool (initiation "user_asked", model "${id}", a short title). Use context "fork" when the task leans on this conversation; otherwise "fresh" with a complete brief: the task in the person's words, the files, decisions and facts from this chat it needs, and what done looks like.${level ? ` If a tool can set that session's effort (set_session_effort), set it to ${level}.` : ''} Then reply to the person in Brazilian Portuguese, in one line, with a link to the new session.

Where you cannot start sessions: write that brief in one fenced block for the person to paste, and give the command to open the session: claude --model ${id}

The task, in the person's words:
<task>
${task}
</task>`
}

// Asks before any model move, in every mode. Returns the prompt text to send (the handoff's when the person moved)
// and what was decided about the effort level.
async function offerMove(
  $: EngineInterface,
  p: Pick,
  to: Target,
  now: Level | '',
): Promise<{ moved: boolean; decided: 'apply' | 'skip' | null }> {
  const lvl = p.level ? ` com esforço ${NAMES[p.level]}` : ''
  const go = `Abrir nova sessão no ${MODEL_NAMES[to]}${lvl}`
  const levelDiffers = !!p.level && p.level !== now
  const stay = levelDiffers ? `Ficar aqui, mudar para ${NAMES[p.level!]}` : 'Ficar aqui'
  const keep = now ? `Ficar aqui em ${NAMES[now]}` : 'Ficar aqui como está'
  const from = targetOf(familyOf(model))
  const kind = from && ['haiku', 'sonnet', 'opus', 'fable'].indexOf(to) < ['haiku', 'sonnet', 'opus', 'fable'].indexOf(from) ? 'mais leve' : 'mais forte'
  let answer = ''
  try {
    answer = await $.ui.ask(
      `Esta tarefa cabe num modelo ${kind}: Claude ${MODEL_NAMES[to]}${lvl}${p.why ? ` (${p.why})` : ''}. O Claude escreve o prompt e abre a sessão; o resultado volta para cá. Mover?`,
      { options: levelDiffers ? [go, stay, keep] : [go, keep], header: 'Modelo' },
    )
  } catch {
    // A dismissed dialog keeps everything as it is.
    declined.add(to)
    return { moved: false, decided: 'skip' }
  }
  if (answer === go) return { moved: true, decided: null }
  declined.add(to)
  if (levelDiffers && answer === stay) return { moved: false, decided: 'apply' }
  return { moved: false, decided: 'skip' }
}

// Suggest mode: when the level differs, hold the prompt until the person answers.
async function suggest($: EngineInterface, p: Pick | null, mine: number) {
  const now = await currentLevel($)
  if (!p || !p.level || mine !== gen || p.level === now) return
  const go = `Mudar para ${NAMES[p.level]}`
  const auto = 'Mudar e ajustar sozinho daqui em diante'
  const keep = now ? `Manter ${NAMES[now]}` : 'Manter como está'
  let answer = ''
  try {
    answer = await $.ui.ask(`Parece uma tarefa de esforço ${NAMES[p.level]}${p.why ? `: ${p.why}` : ''}. Mudar antes de o Claude começar?`, {
      options: [go, auto, keep],
      header: 'Esforço',
    })
  } catch {
    // A dismissed dialog keeps the level and sends the prompt.
    return
  }
  if (answer !== go && answer !== auto) return
  if (answer === auto) {
    mode = 'auto'
    await $.store.set('mode', mode)
  }
  const note = await applyLevel($, p.level)
  await showApplied($, { level: p.level, why: p.why }, now, note)
}

// Auto mode: the first request already runs at the picked level.
async function autoAdjust($: EngineInterface, p: Pick | null, mine: number) {
  const now = await currentLevel($)
  if (!p || !p.level || mine !== gen) return
  if (p.level === now) {
    turnLevel = p.level
    return
  }
  const note = await applyLevel($, p.level)
  await showApplied($, { level: p.level, why: p.why }, now, note)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = homeOf($.plugin.root)
    await $.command.register({
      name: 'otimizador-de-esforco',
      description: 'Otimizador de esforço. auto: ajusta o esforço sozinho. suggest: sugere a troca. models on|off: sugere um modelo mais leve ou mais forte. off ou on',
      argumentHint: '[auto|suggest|off|on|models on|models off]',
    })
    enabled = (await $.store.get('enabled')) !== false
    mode = (await $.store.get('mode')) === 'auto' ? 'auto' : 'suggest'
    models = (await $.store.get('models')) !== false
    await readSwitch($).catch(() => undefined)
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    void (async () => {
      const row = await findRow($)
      rowKey = row?.key ?? ''
      await log($, 'effort row', row ? `${row.key} = ${String(row.value)} [${(row.options ?? []).join(', ')}]${row.isLocked ? ' locked' : ''}` : 'none found')
    })().catch(err => log($, 'find row', err))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (off || !enabled) return next(e)
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    const text = e.text.trim()
    if (!text || text.startsWith('/') || text.startsWith(HANDOFF_TAG)) return next(e)
    gen += 1
    turnLevel = null
    const mine = gen
    // A new prompt makes an unanswered offer stale.
    const b = await getBand($).catch(() => null)
    if (b?.phase === 'offer') await setBand($, null).catch(() => undefined)
    // Pick before the prompt goes in, so a model move is offered before Claude starts on the task.
    if (!model) model = await $.session.model().catch(() => '')
    const now = await currentLevel($)
    const p = await pickWithStatus($, text, now)
    const to = p ? usableMove(p) : null
    if (p && to && mine === gen) {
      const r = await offerMove($, p, to, now)
      if (r.moved) {
        // The handoff turn only opens a session: keep it light on this model.
        held = null
        turnLevel = 'low'
        void log($, 'handoff', `${model} -> ${MODEL_IDS[to]}${p.level ? ` at ${p.level}` : ''}`)
        return next({ ...e, text: handoffText(text, to, p.level) })
      }
      held = { text, mine, pick: p, decided: r.decided }
      return next(e)
    }
    // The level is set at the turn's first request, which carries the level the chat really runs at.
    held = { text, mine, pick: p, decided: null }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every main-chat request: note its level, and put the chosen one on it when the setting could not be changed.
  on('turn.step', async function* ($, e, next) {
    if (off || e.agentId !== undefined || typeof e.effort !== 'string') return yield* next(e)
    // Only a turn's first request counts: a later step may name a fallback model for that one request.
    if (e.index === 0 && e.model && e.model !== model) {
      // A new model has its own default level: the old hold no longer matches the picker.
      if (model) hold = null
      model = e.model
    }
    lastEffort = e.effort
    // The picker moved (by hand, or /effort landed): the mod lets go.
    if (hold && e.effort !== hold.base) { hold = null; turnLevel = null; pendingMenu = null }
    let value: Level | null = enabled && hold ? hold.level : null
    if (!hold && (await $.state.get(OVERRIDE)).value) {
      await $.state.set(OVERRIDE, null)
      redraw($)
    }
    // What the chat runs at now: the level the mod holds, else the picker's.
    seen = value ?? (asLevel(e.effort) || seen)
    if (held && e.index === 0 && enabled) {
      const h = held
      held = null
      if (h.decided === 'apply' && h.pick?.level && h.mine === gen) {
        const from = await currentLevel($)
        const note = await applyLevel($, h.pick.level)
        await showApplied($, { level: h.pick.level, why: h.pick.why }, from, note)
      } else if (h.decided === 'skip') {
        // The person kept the level when declining the move.
      } else if (mode === 'auto') await autoAdjust($, h.pick, h.mine).catch(err => log($, 'auto', err))
      else await suggest($, h.pick, h.mine).catch(err => log($, 'suggest', err))
      value = enabled && hold ? hold.level : null
    }
    const want = turnLevel ?? (enabled ? (value ?? null) : null)
    if (!want || want === e.effort) return yield* next(e)
    // On models that take effort per message (Fable 5.x, Opus 5.5, Sonnet 5.5, Haiku 5.5) the level set on the
    // turn's first request stands for its tool steps, so later rewrites are not sent: log the first one only.
    if (e.index === 0) void log($, 'request', `${e.model}: ${e.effort} -> ${want}`)
    return yield* next({ ...e, effort: want })
  })

  // The main reply ended: now the app runs a slash command at once, so the menu can follow the level.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && pendingMenu && !off && enabled) syncMenu($)
    return r
  })

  on('command.run', { command: 'otimizador-de-esforco' }, async ($, e) => {
    if (off) return { text: 'O Otimizador de esforço está desligado. Ligue-o com /mods.' }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'auto' || arg === 'suggest') {
      mode = arg
      enabled = true
      await $.store.set('mode', mode)
      await $.store.set('enabled', true)
      return {
        text:
          mode === 'auto'
            ? 'Otimizador de esforço: auto. Cada prompt agora recebe o nível de esforço de que precisa, ajustado sozinho.'
            : 'Otimizador de esforço: suggest. Quando um prompt pedir outro nível, ele pergunta antes de mudar.',
      }
    }
    if (arg === 'models off' || arg === 'models on') {
      models = arg === 'models on'
      await $.store.set('models', models)
      if (models) declined.clear()
      return {
        text: models
          ? 'Otimizador de esforço: sugestão de modelo ligada. Quando uma tarefa couber num modelo mais leve ou mais forte, ele oferece abrir uma nova sessão nele.'
          : 'Otimizador de esforço: sugestão de modelo desligada. Ele só ajusta o nível de esforço.',
      }
    }
    if (arg === 'off' || arg === 'on') {
      enabled = arg === 'on'
      await $.store.set('enabled', enabled)
      if (!enabled) {
        turnLevel = null
        await $.state.set(OVERRIDE, null)
        await setBand($, null)
      }
      return { text: enabled ? `O Otimizador de esforço está ligado (${mode}).` : 'O Otimizador de esforço está desligado. Digite /otimizador-de-esforco on para religar.' }
    }
    const now = await currentLevel($)
    const { value } = await $.state.get(OVERRIDE)
    return {
      text: [
        `O Otimizador de esforço está ${enabled ? 'ligado' : 'desligado'}, modo: ${mode}.`,
        `Modelo: ${model || 'desconhecido até a próxima mensagem'}.`,
        `Este chat roda em: ${now ? NAMES[now] : 'ainda desconhecido'}${value ? ` (mantido pelo mod: ${NAMES[value]})` : ''}.`,
        `Configuração de esforço: ${rowKey || 'não encontrada, o mod ajusta o nível em cada mensagem'}.`,
        `Sugestão de modelo: ${models ? 'ligada' : 'desligada'}${declined.size ? ` (sem oferecer ${[...declined].map(t => MODEL_NAMES[t]).join(', ')} de novo nesta sessão)` : ''}.`,
        'Digite /otimizador-de-esforco auto, suggest, off, on, models on ou models off.',
      ].join('\n'),
    }
  })

  on('ui.press', { plugin: 'otimizador-de-esforco', element: 'switch' }, async ($, e) => {
    const b = await getBand($)
    if (!b || b.phase !== 'offer') return { element: e.element }
    try {
      const note = await applyLevel($, b.level)
      await showApplied($, { level: b.level, why: b.why }, b.from, note)
    } catch (err) {
      await log($, 'switch', err)
      await setBand($, { ...b, note: `Não foi possível mudar: ${(err instanceof Error ? err.message : String(err)).slice(0, 100)}` })
    }
    return { element: e.element }
  })

  on('ui.press', { plugin: 'otimizador-de-esforco', element: 'auto' }, async ($, e) => {
    mode = 'auto'
    await $.store.set('mode', mode)
    const b = await getBand($)
    if (b?.phase === 'offer') {
      const note = await applyLevel($, b.level).catch(err => String(err))
      await showApplied($, { level: b.level, why: 'Ajuste automático ligado para todo prompt' }, b.from, note)
    }
    return { element: e.element }
  })

  on('ui.press', { plugin: 'otimizador-de-esforco', element: 'info' }, async ($, e) => {
    const b = await getBand($)
    if (b) await setBand($, { ...b, phase: 'info' })
    return { element: e.element }
  })

  on('ui.press', { plugin: 'otimizador-de-esforco', element: 'info-close' }, async ($, e) => {
    await setBand($, null)
    return { element: e.element }
  })

  on('ui.press', { plugin: 'otimizador-de-esforco', element: 'skip' }, async ($, e) => {
    await setBand($, null)
    return { element: e.element }
  })

  // The app's model menu belongs to the app: it refuses a chat that changes its own effort.
  // So the footer slot beside it names the level the mod really sends.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (off || !enabled) return next(e)
    const { value } = await $.state.get(OVERRIDE)
    if (!value) return next(e)
    const label = `Esforço ${SHORT[value]}`
    // The desktop app draws only a tree in this slot, not a rewritten `modes`: draw the label beside
    // the footer's own modes (focus, memory paused), never in their place.
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Box, Text } = $.ui.resolve(e)
      const rest = e.props.modes.length ? await next(e) : null
      return (
        <Box flexDirection="row" gap={1}>
          {rest}
          <Text color={ACCENT}>{label}</Text>
        </Box>
      )
    }
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes.filter(m => !m.startsWith('Esforço ')), label] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off || !enabled || e.props.hasSurvey) return next(e)
    const b = await getBand($)
    if (!b) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined

    if (b.phase === 'applied') {
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="row" gap={1}>
            <Text wrap="truncate-end">
              <Text color={GOOD}>✓</Text>
              <Text> Esforço ajustado para </Text>
              <Text bold>{NAMES[b.level]}</Text>
              {b.from ? <Text dimColor> (era {NAMES[b.from]})</Text> : null}
              {b.why ? <Text dimColor> · {b.why}</Text> : null}
            </Text>
            <Button key="info" label="ⓘ Saiba mais" variant="secondary" onPress={noop} />
          </Box>
        </Box>
      )
    }

    if (b.phase === 'info') {
      const was = b.from ? NAMES[b.from] : 'o seu nível anterior'
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="column">
            <Text>
              <Text color={ACCENT}>ⓘ</Text>
              <Text bold> O Claude agora trabalha com esforço {NAMES[b.level]}</Text>
            </Text>
            <Text dimColor>O mod ajusta o nível em cada mensagem antes de ela sair do seu computador.</Text>
            <Text dimColor>Esta resposta já sai com esforço {NAMES[b.level]}. O menu de esforço ao lado do nome do modelo ainda mostra {was} e passa para {NAMES[b.level]} quando esta resposta terminar.</Text>
            <Text dimColor>Enquanto isso, o rótulo "Esforço {SHORT[b.level]}" no canto inferior direito mostra o nível real.</Text>
            <Text dimColor>Se você mexer no menu, o mod segue o menu.</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="info-close" label="Entendi" role="dismiss" onPress={noop} />
            </Box>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column">
          <Text>
            <Text color={ACCENT}>●</Text>
            <Text bold> Parece uma tarefa de esforço {NAMES[b.level]}</Text>
            {b.from ? <Text dimColor> (você está em {NAMES[b.from]})</Text> : null}
          </Text>
          {b.why ? <Text dimColor>{b.why}</Text> : null}
          <Box flexDirection="row" gap={1}>
            <Button key="switch" label={`Mudar para ${NAMES[b.level]}`} variant="primary" onPress={noop} />
            <Button key="auto" label="Ajustar todo prompt sozinho" variant="secondary" onPress={noop} />
            <Button key="skip" label="Pular" role="dismiss" onPress={noop} />
          </Box>
          {b.note ? <Text color={BAD}>{b.note}</Text> : null}
        </Box>
      </Box>
    )
  })
}
