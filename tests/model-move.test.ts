import { expect, test } from 'claude-code/testing'

import { engine, send, start } from './engine'

test('on Fable a routine task offers Sonnet, and a yes sends a handoff prompt at low effort', async ($, on) => {
  const s = engine(on, { pick: '{"level":"medium","model":"sonnet","why":"everyday rewrite"}', model: 'claude-fable-5-2', mode: 'suggest' })
  await start($)
  await send($, s, 'Rewrite the README intro to be friendlier.')
  expect(s.asked.length).toBe(1)
  expect(s.asked[0]!.options[0]).toBe('Abrir nova sessão no Sonnet com esforço Médio')
  expect(s.submitted[0]).toContain('[Otimizador de esforço: repasse]')
  expect(s.submitted[0]).toContain('claude-sonnet-5-5')
  expect(s.submitted[0]).toContain('Rewrite the README intro to be friendlier.')
  expect(s.sent).toEqual(['low'])
})

test('on Sonnet a critical task offers Opus; staying moves the menu to High before Claude starts', async ($, on) => {
  const s = engine(on, { pick: '{"level":"high","model":"opus","why":"contract risk review"}', model: 'claude-sonnet-5-5', mode: 'suggest', choose: o => o[1]! })
  await start($)
  await send($, s, 'Review this contract for risks before I sign.')
  expect(s.asked[0]!.options).toEqual(['Abrir nova sessão no Opus com esforço Alto', 'Ficar aqui, mudar para Alto', 'Ficar aqui como está'])
  expect(s.commands).toEqual(['/effort high'])
  expect(s.submitted).toEqual(['Review this contract for risks before I sign.'])
  expect(s.sent).toEqual(['high'])
})

test('a declined model is not offered again this session', async ($, on) => {
  const s = engine(on, { pick: '{"level":"medium","model":"sonnet","why":"routine"}', mode: 'suggest', choose: o => o[o.length - 1]! })
  await start($)
  await send($, s, 'Summarize this file.')
  await send($, s, 'Summarize that other file.')
  expect(s.asked.length).toBe(1)
})

test('a move the wrong way is never offered (Sonnet down to Haiku)', async ($, on) => {
  const s = engine(on, { pick: '{"level":"low","model":"haiku","why":"trivial"}', model: 'claude-sonnet-5-5', mode: 'suggest' })
  await start($)
  await send($, s, 'Sort this list.')
  expect(s.asked.some(a => a.options.some(o => o.startsWith('Abrir nova')))).toBe(false)
  expect(s.submitted).toEqual(['Sort this list.'])
})
