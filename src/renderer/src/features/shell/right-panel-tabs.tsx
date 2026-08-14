import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

type PanelTab = {
  key: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const SESSION_PANEL_IDS = new Set(['run', 'pi', 'context', 'tree', 'agents'])
const WORKSPACE_PANEL_IDS = new Set(['review', 'files', 'terminal', 'worktrees'])

function PanelGroup({
  label,
  panels,
  activePanel,
  setActivePanel,
}: {
  label: string
  panels: PanelTab[]
  activePanel: string
  setActivePanel: (panel: string) => void
}) {
  if (panels.length === 0) return null

  return (
    <section aria-label={label}>
      <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-foreground-tertiary">
        {label}
      </div>
      <div className="grid grid-cols-3 gap-1" role="tablist" aria-label={label}>
        {panels.map((panel) => {
          const selected = activePanel === panel.key
          return (
            <button
              key={panel.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActivePanel(panel.key)}
              className={cn(
                'group flex min-w-0 touch-manipulation items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1',
                selected
                  ? 'border-border bg-[var(--bg-1)] text-foreground shadow-sm'
                  : 'border-transparent text-foreground-secondary hover:border-border/50 hover:bg-[var(--bg-hover)] hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors duration-150',
                  selected
                    ? 'bg-[var(--bg-active)] text-foreground'
                    : 'bg-[var(--bg-2)] text-foreground-tertiary group-hover:text-foreground-secondary',
                )}
              >
                <panel.icon className="h-3 w-3" aria-hidden="true" />
              </span>
              <span className="min-w-0 truncate text-[11px] font-medium">{panel.label}</span>
              {selected ? (
                <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function RightPanelTabs({
  panels,
  activePanel,
  setActivePanel,
}: {
  panels: PanelTab[]
  activePanel: string
  setActivePanel: (panel: string) => void
}) {
  const { t } = useTranslation()
  const active = panels.find((panel) => panel.key === activePanel) ?? panels[0]
  if (!active) return null

  const sessionPanels = panels.filter((panel) => SESSION_PANEL_IDS.has(panel.key))
  const workspacePanels = panels.filter((panel) => WORKSPACE_PANEL_IDS.has(panel.key))
  const extensionPanels = panels.filter(
    (panel) => !SESSION_PANEL_IDS.has(panel.key) && !WORKSPACE_PANEL_IDS.has(panel.key),
  )
  const ActiveIcon = active.icon

  return (
    <div className="shrink-0 border-b border-border/60 bg-[var(--bg-1)]">
      <div className="flex h-9 items-center gap-2 border-b border-border/40 px-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-active)] text-foreground shadow-sm">
          <ActiveIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-foreground-tertiary">
            {t('common:panelNav.current')}
          </div>
          <div className="truncate text-xs font-semibold text-foreground">{active.label}</div>
        </div>
      </div>

      <nav className="grid gap-1.5 bg-[var(--bg-2)]/45 p-2" aria-label={t('common:panelNav.allPanels')}>
        <PanelGroup
          label={t('common:panelNav.sessionTools')}
          panels={sessionPanels}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
        />
        <PanelGroup
          label={t('common:panelNav.workspaceTools')}
          panels={workspacePanels}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
        />
        <PanelGroup
          label={t('common:panelNav.extensions')}
          panels={extensionPanels}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
        />
      </nav>
    </div>
  )
}
