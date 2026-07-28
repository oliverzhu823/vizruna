import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, RotateCcw, TerminalSquare, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { TerminalDataEvent, TerminalExitEvent } from '@shared/terminal'
import { ipcClient, onTerminalData, onTerminalExit } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import '@xterm/xterm/css/xterm.css'

type TerminalTab = {
  id: string
  title: string
  cwd: string
  exited: boolean
}

let preservedTabs: TerminalTab[] = []
let preservedActiveId: string | null = null
let preservedWorkspace: string | null = null

const TERMINAL_ERROR_KEYS = [
  'TERMINAL_WORKSPACE_REQUIRED',
  'TERMINAL_CWD_NOT_TRUSTED',
  'TERMINAL_CWD_NOT_DIRECTORY',
  'TERMINAL_LIMIT_REACHED',
  'TERMINAL_INPUT_TOO_LONG',
  'TERMINAL_PROCESS_EXITED',
  'TERMINAL_CLOSED',
  'TERMINAL_WORKSPACE_CHANGED',
] as const

function terminalErrorMessage(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = TERMINAL_ERROR_KEYS.find((candidate) =>
    message.includes(candidate),
  )
  return code ? t(`common:terminal.errors.${code}`) : message
}

function TerminalView({
  tab,
  active,
  onExit,
}: {
  tab: TerminalTab
  active: boolean
  onExit: (id: string) => void
}) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let disposed = false
    let terminal: import('@xterm/xterm').Terminal | null = null
    let resizeObserver: ResizeObserver | null = null
    let removeData = () => {}
    let removeExit = () => {}
    let inputDisposable: { dispose(): void } | null = null
    let attached = false
    const pendingData: TerminalDataEvent[] = []

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      async ([{ Terminal }, { FitAddon }]) => {
        if (disposed || !hostRef.current) return
        const fitAddon = new FitAddon()
        terminal = new Terminal({
          cursorBlink: true,
          convertEol: true,
          disableStdin: tab.exited,
          fontFamily: '"Geist Mono", "SFMono-Regular", Menlo, monospace',
          fontSize: 12,
          scrollback: 10_000,
          allowProposedApi: false,
          theme: {
            background: '#00000000',
            foreground: '#d4d4d8',
            cursor: '#a1a1aa',
            selectionBackground: '#3f3f4680',
          },
        })
        terminal.loadAddon(fitAddon)
        terminal.open(hostRef.current)
        const fit = () => {
          if (!terminal || disposed || !hostRef.current?.offsetParent) return
          try {
            fitAddon.fit()
            void ipcClient.invoke('terminal.resize', {
              id: tab.id,
              cols: terminal.cols,
              rows: terminal.rows,
            })
          } catch {
            // Hidden panel or terminal already closed.
          }
        }
        fitRef.current = fit
        removeData = onTerminalData((event: TerminalDataEvent) => {
          if (event.id !== tab.id) return
          if (!attached) {
            pendingData.push(event)
            return
          }
          terminal?.write(event.data)
        })
        removeExit = onTerminalExit((event: TerminalExitEvent) => {
          if (event.id !== tab.id) return
          if (terminal) terminal.options.disableStdin = true
          onExit(tab.id)
        })
        inputDisposable = terminal.onData((data) => {
          void ipcClient.invoke('terminal.write', { id: tab.id, data })
        })
        resizeObserver = new ResizeObserver(() => fit())
        resizeObserver.observe(hostRef.current)
        const snapshot = await ipcClient.invoke('terminal.attach', { id: tab.id })
        if (snapshot?.data) terminal.write(snapshot.data)
        attached = true
        for (const event of pendingData) {
          if (event.sequence > (snapshot?.sequence || 0)) {
            terminal.write(event.data)
          }
        }
        pendingData.length = 0
        requestAnimationFrame(fit)
        terminal.focus()
      },
    ).catch((error) => {
      if (!disposed) {
        toast.error(terminalErrorMessage(error, t))
      }
    })

    return () => {
      disposed = true
      fitRef.current = null
      resizeObserver?.disconnect()
      removeData()
      removeExit()
      inputDisposable?.dispose()
      terminal?.dispose()
    }
  }, [onExit, t, tab.id])

  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(() => fitRef.current?.())
    return () => cancelAnimationFrame(frame)
  }, [active])

  return (
    <div
      ref={hostRef}
      data-terminal-id={tab.id}
      className={cn('h-full min-h-0 w-full px-2 py-1', !active && 'hidden')}
    />
  )
}

export function TerminalPanel() {
  const { t } = useTranslation()
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [tabs, setTabs] = useState<TerminalTab[]>(() =>
    preservedWorkspace === currentWorkspace ? preservedTabs : [],
  )
  const [activeId, setActiveId] = useState<string | null>(
    () => (preservedWorkspace === currentWorkspace ? preservedActiveId : null),
  )
  const [autoCreatePending, setAutoCreatePending] = useState(
    () => Boolean(currentWorkspace && preservedWorkspace !== currentWorkspace),
  )
  const creatingRef = useRef(false)
  const previousWorkspaceRef = useRef(currentWorkspace)
  const latestWorkspaceRef = useRef(currentWorkspace)
  latestWorkspaceRef.current = currentWorkspace

  const createTerminal = useCallback(async () => {
    if (creatingRef.current || !currentWorkspace) return
    creatingRef.current = true
    const requestedWorkspace = currentWorkspace
    try {
      const response = await ipcClient.invoke('terminal.create', {
        cwd: requestedWorkspace,
        cols: 80,
        rows: 24,
      })
      if (latestWorkspaceRef.current !== requestedWorkspace) {
        await ipcClient.invoke('terminal.close', { id: response.id })
        setAutoCreatePending(true)
        return
      }
      setTabs((current) => [
        ...current,
        {
          id: response.id,
          title: t('common:terminal.tab', { count: current.length + 1 }),
          cwd: response.cwd,
          exited: false,
        },
      ])
      setActiveId(response.id)
    } catch (error) {
      toast.error(t('common:terminal.createFailed'), {
        description: terminalErrorMessage(error, t),
      })
    } finally {
      creatingRef.current = false
    }
  }, [currentWorkspace, t])

  useEffect(() => {
    preservedTabs = tabs
    preservedWorkspace = currentWorkspace
  }, [currentWorkspace, tabs])

  useEffect(() => {
    preservedActiveId = activeId
  }, [activeId])

  useEffect(() => {
    if (previousWorkspaceRef.current === currentWorkspace) return
    for (const tab of tabs) {
      void ipcClient.invoke('terminal.close', { id: tab.id })
    }
    previousWorkspaceRef.current = currentWorkspace
    preservedWorkspace = currentWorkspace
    preservedTabs = []
    preservedActiveId = null
    setTabs([])
    setActiveId(null)
    setAutoCreatePending(Boolean(currentWorkspace))
  }, [currentWorkspace, tabs])

  useEffect(() => {
    if (!autoCreatePending || !currentWorkspace || tabs.length > 0) return
    setAutoCreatePending(false)
    void createTerminal()
  }, [autoCreatePending, createTerminal, currentWorkspace, tabs.length])

  const closeTab = (id: string) => {
    void ipcClient.invoke('terminal.close', { id })
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      if (activeId === id) {
        setActiveId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null)
      }
      return next
    })
  }

  const markExited = useCallback((id: string) => {
    setTabs((current) =>
      current.map((tab) => (tab.id === id ? { ...tab, exited: true } : tab)),
    )
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0d] text-zinc-200">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 bg-black/20 px-1 py-1">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'group flex shrink-0 items-center rounded text-[10px]',
                activeId === tab.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5',
              )}
            >
              <button
                type="button"
                onClick={() => setActiveId(tab.id)}
                className="flex items-center gap-1.5 py-1 pl-2"
                title={tab.cwd}
              >
                <TerminalSquare className="h-3 w-3" />
                <span>{tab.title}</span>
                {tab.exited ? <span className="text-amber-400">●</span> : null}
              </button>
              <button
                type="button"
                onClick={() => closeTab(tab.id)}
                aria-label={t('common:terminal.close', { title: tab.title })}
                className="mx-1 rounded p-0.5 opacity-0 hover:bg-white/10 focus:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void createTerminal()}
          className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label={t('common:terminal.new')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 ? (
          <button
            type="button"
            onClick={() => void createTerminal()}
            disabled={!currentWorkspace}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[11px] text-zinc-500"
          >
            <RotateCcw className="h-4 w-4" />
            {currentWorkspace
              ? t('common:terminal.reopen')
              : t('common:terminal.openProject')}
          </button>
        ) : null}
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onExit={markExited}
          />
        ))}
      </div>
    </div>
  )
}
