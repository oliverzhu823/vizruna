<p align="center">
  <img src="resources/icon.svg" width="180" alt="Vizruna" />
</p>

<p align="center">
  A visible, controllable, local-first desktop workspace for Pi-powered AI Agents.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> · English
</p>

# Vizruna

Vizruna turns the Pi Agent runtime into a practical desktop product. You can
chat with an Agent, watch its reasoning and tool activity, switch models and
thinking levels, inspect changed files, run a terminal, and coordinate parallel
work without leaving one workspace.

Status: **Public Alpha**. Everyone is welcome to download and use Vizruna. The
current build supports **Apple-silicon Macs (M1/M2/M3/M4 and later)**. We are
actively looking for early users and feedback; avoid mission-critical work while
the product is still in Alpha.

![Vizruna desktop workspace](docs/images/vizruna-desktop.png)

## Main features

- **Chinese and English UI** with Light, Dark, System, and Sage eye-care themes.
- **Native Pi model workflow**: choose a provider/model and thinking level;
  use `/login` and `/logout`, OAuth, or an API key where the provider supports it.
- **Provider-specific network routing**: let overseas providers use a proxy while
  domestic providers connect directly, without changing the operating-system proxy.
- **Visible Agent execution**: streamed responses, reasoning status, tool calls,
  run statistics, context usage, and conversation tree.
- **Workspace tools**: integrated file browser and terminal, plus project-based sessions.
- **Review workflow**: inspect changed files and Markdown in the right panel, or
  open a file in its default macOS application.
- **Parallel Agent work**: managed Git worktrees, child Agents, task state, and
  recovery controls share the existing application architecture.
- **Local-first data**: Pi sessions and authentication remain on the user's
  computer; build packages do not contain the developer's history or credentials.

## Download and install

1. Open the repository's [Releases](https://github.com/oliverzhu823/vizruna/releases).
2. Download `Vizruna-*-arm64.dmg` from the newest prerelease.
3. Open the DMG and drag **Vizruna** into **Applications**.
4. Launch Vizruna. If macOS blocks this unsigned Alpha build, Control-click the
   app and choose **Open**, or allow it in **System Settings → Privacy & Security**.

The DMG is currently for Apple-silicon Macs only. Windows, Linux, and Intel Mac
packages have not completed release acceptance.

## Quick start

1. Choose **Open folder** for project work, or start with **New chat** for a
   temporary conversation.
2. Click the model control beside the composer and select a provider, model, and
   thinking level.
3. Authenticate by typing `/login`, or open **Settings → Models**. Use `/logout`
   when you want to disconnect a provider account.
4. Type the outcome you want. Vizruna will show the request immediately and then
   display thinking, tool, and response activity in chronological order.
5. Use the right-side **Review**, **Run**, **Context**, and **Tree** panels to
   inspect the result. Click a changed Markdown file to preview it; use the
   external-open action when you prefer the default macOS app.

### Proxy and direct connections

Open **Settings → Provider routing** to create a proxy profile and assign a route
per provider. For example, OpenAI Codex can use the V2Ray profile while a Chinese
model provider remains on **Direct**. Vizruna applies the route to that Agent
worker only; it does not rewrite the global system proxy.

## User data and privacy

- Pi sessions and authentication are stored under `~/.pi/agent` on each user's Mac.
- Vizruna preferences and product metadata use the separate Electron user-data
  directory named `Vizruna`.
- The published package is built from a sanitized checkout and does not include
  conversations, recent projects, tokens, proxy passwords, or local paths from
  the maintainer's computer.
- Users should still avoid placing secrets in prompts or committing credentials
  to a project repository.

## Feedback

Vizruna welcomes early users. Use [GitHub Issues](https://github.com/oliverzhu823/vizruna/issues)
to report a bug, suggest an improvement, or describe a workflow you want the Agent
to support. Include the Vizruna version, macOS version, Mac model, and model provider
when relevant, but never post API keys, OAuth tokens, or private conversation content.

## Development

Requirements: Node.js 22.19.x, npm, Git, and macOS Apple Silicon for the current
packaging target.

```bash
nvm use
npm ci
npm run dev
```

Run the complete local quality suite:

```bash
npm run verify
```

Build an internal macOS package:

```bash
npm run package -- --mac
```

Signing and notarization require release credentials and are intentionally not
stored in this repository.

## Architecture and project documents

- Product base: [`justhil/pi-app`](https://github.com/justhil/pi-app), pinned at
  `bcef920e3900a858b305c67c42a34e61779f977c`
- Behavior reference: [`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui)
- Agent runtime: `@earendil-works/pi-coding-agent@0.82.1`
- [Development startup package](docs/startup/README.md)
- [PRD v0.1](docs/startup/01-PRD-v0.1.md)
- [Architecture RFC-001](docs/startup/02-Architecture-RFC-001.md)
- [Roadmap](docs/startup/03-Development-Roadmap.md)
- [Acceptance criteria](docs/startup/04-Acceptance-Criteria.md)
- [User guide](docs/startup/12-User-Guide.md)
- [macOS release runbook](docs/startup/13-macOS-Release-Runbook.md)
- [Upstream strategy](UPSTREAM.md)
- [Third-party notices](NOTICE.md)

The application keeps the Electron Main, Preload, React Renderer, and Utility
Worker boundaries. It does not merge two GUI repositories or introduce a second
global state model.
