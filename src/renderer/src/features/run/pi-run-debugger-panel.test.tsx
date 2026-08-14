import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { PiRunDebuggerPanel } from './pi-run-debugger-panel'

describe('PiRunDebuggerPanel', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the fixed configuration, ordered tool trace, and likely failure layer', () => {
    render(
      <PiRunDebuggerPanel
        running={false}
        model="provider/model"
        contextTokens={32_000}
        contextWindow={128_000}
        snapshot={{
          runId: 'run-1',
          config: { kind: 'agent', name: 'Research Agent', capturedAt: 100 },
          toolCount: 2,
          failureCount: 1,
          compactionCount: 0,
          context: {
            before: {
              tokens: 30_000,
              contextWindow: 128_000,
              percent: 23.4,
              messageCount: 4,
              capturedAt: 1,
            },
            after: {
              tokens: 32_000,
              contextWindow: 128_000,
              percent: 25,
              messageCount: 7,
              capturedAt: 2,
            },
            deltaTokens: 2_000,
            deltaMessages: 3,
          },
          resources: {
            capturedAt: 1,
            activeTools: [{ name: 'read' }, { name: 'web_search' }],
            skills: [{ name: 'research' }],
            promptTemplates: [],
            extensions: [{ name: 'web.ts', path: '/ext/web.ts' }],
            contextFiles: [],
            systemPromptSources: [],
          },
          primaryFailure: {
            id: 'tool-2',
            kind: 'tool',
            label: 'web_search',
            status: 'failed',
            origin: 'extension',
            timestamp: 2,
            failureLayer: 'extension',
            summary: 'network request failed',
          },
          entries: [
            {
              id: 'tool-1',
              kind: 'tool',
              label: 'read',
              status: 'success',
              origin: 'pi-base',
              timestamp: 1,
              durationMs: 120,
            },
            {
              id: 'tool-2',
              kind: 'tool',
              label: 'web_search',
              status: 'failed',
              origin: 'extension',
              timestamp: 2,
              failureLayer: 'extension',
              summary: 'network request failed',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Research Agent')).toBeVisible()
    expect(screen.getByText('Likely failure layer: Extension')).toBeVisible()
    expect(screen.getAllByText('read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('web_search').length).toBeGreaterThan(0)
    expect(screen.getByText(/30.*32/)).toBeVisible()
    expect(screen.getByText('Loaded Pi resources')).toBeVisible()
  })
})
