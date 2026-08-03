import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/geist-mono.css'
import './styles/globals.css'
import './styles/scrollbar-overlay.css'
import { hydrateLanguageFromSettings } from './lib/i18n'
import './lib/startup-toast-guard'
import { ensureExtensionUIChannel } from './lib/extension-ui-channel'
import { ensureAppUpdateNotify } from './lib/app-update-notify'
import { syncChatContentMaxWidths } from './lib/chat-content-width'
import { initializeRuntimeTransport } from './lib/ipc-client'

const App = React.lazy(() => import('./app/app'))

async function bootstrapRenderer(): Promise<void> {
  try {
    await initializeRuntimeTransport()
    ensureExtensionUIChannel()
    ensureAppUpdateNotify()
    syncChatContentMaxWidths()
    await hydrateLanguageFromSettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[startup] Unable to initialize Vizruna:', error)
    document.getElementById('root')!.innerHTML =
      `<main style="font:16px/1.6 system-ui;padding:48px;max-width:720px;margin:auto">` +
      `<h1>Vizruna-web could not start</h1><p>${message.replace(/[&<>"']/g, '')}</p>` +
      `<p>Close this page and restart Vizruna-web.</p></main>`
    return
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </React.StrictMode>,
  )
}

void bootstrapRenderer()
