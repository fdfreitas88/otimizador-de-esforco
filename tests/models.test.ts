import { expect, test } from 'claude-code/testing'

import { engine, send, start } from './engine'

test('on Fable 5.2 a max pick the prompt did not ask for runs at xhigh', async ($, on) => {
  const s = engine(on, { pick: '{"level":"max","why":"critical handoff"}', model: 'claude-fable-5-2' })
  await start($)
  await send($, s, 'Write the full due diligence report on this acquisition.')
  expect(s.commands).toEqual(['/effort xhigh'])
  expect(s.sent).toEqual(['xhigh'])
  expect(s.prompts[0]).toContain('Claude Fable')
})

test('on Fable 5.2 a prompt that asks for max effort gets max', async ($, on) => {
  const s = engine(on, { pick: '{"level":"max","why":"asked for it"}', model: 'claude-fable-5-2' })
  await start($)
  await send($, s, 'Use maximum effort: review this 50 page agreement, it is critical.')
  expect(s.commands).toEqual(['/effort max'])
  expect(s.sent).toEqual(['max'])
})

test('on Opus 5.5 the pick is used as is and the prompt names Opus', async ($, on) => {
  const s = engine(on, { pick: '{"level":"low","why":"quick rewrite"}' })
  await start($)
  await send($, s, 'Make this sentence friendlier.')
  expect(s.commands).toEqual(['/effort low'])
  expect(s.sent).toEqual(['low'])
  expect(s.prompts[0]).toContain('Claude Opus')
})
