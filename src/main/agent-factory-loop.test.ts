import { describe, expect, it } from 'vitest'
import { parseFactoryRoundReport } from '../worker/agent-factory-loop'

describe('Agent Factory round contract', () => {
  it('accepts a bounded JSON handoff', () => {
    expect(parseFactoryRoundReport(JSON.stringify({
      status: 'complete',
      summary: 'Implemented and verified',
      evidence: ['npm test passed'],
      nextSteps: [],
    }))).toEqual({
      status: 'complete',
      summary: 'Implemented and verified',
      evidence: ['npm test passed'],
      nextSteps: [],
    })
  })

  it('fails loudly when the model does not follow the status contract', () => {
    expect(() => parseFactoryRoundReport('Looks good to me.')).toThrow('FACTORY_REPORT_INVALID')
  })
})
