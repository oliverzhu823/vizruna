<p align="center">
  <img src="resources/vizruna-lockup.svg" width="520" alt="Vizruna" />
</p>

# Vizruna

Vizruna is a local AI Agent workspace built on the Pi SDK. It makes agent
execution visible, controllable, and reviewable. It keeps Pi JSONL sessions as
the conversation source of truth and adds a
product layer for safe parallel Agents, managed Git worktrees, provider-specific
network routing, recovery, audit evidence, and bilingual operation.

Status: friends-and-family Alpha. The current download target is macOS on Apple
Silicon and test builds are delivered through GitHub Releases.

## Download

1. Open **Releases** on this repository.
2. Download the file named `Vizruna-*-arm64.dmg`.
3. Open the DMG and drag Vizruna to Applications.

Test packages do not contain the developer's conversations, credentials,
recent-project list, or local machine paths.

## Architecture

- Product base: [`justhil/pi-app`](https://github.com/justhil/pi-app)
- Pinned base commit: `bcef920e3900a858b305c67c42a34e61779f977c`
- Behavior reference: [`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui)
- Agent runtime: `@earendil-works/pi-coding-agent@0.82.1`

The application retains the Electron Main, Preload, React Renderer, and Utility
Worker boundaries. It does not merge the two GUI projects or add a second global
application store.

## Development

Requirements:

- macOS Apple Silicon for the v0.1 release target
- Node.js 22.19.x
- npm
- Git

```bash
nvm use
npm ci
npm run dev
```

Quality checks:

```bash
npm run verify
```

Package an internal macOS build:

```bash
npm run package -- --mac
```

Signing and notarization require the company release credentials and are not
configured in the repository.

## Documentation

- [Development startup package](docs/startup/README.md)
- [PRD v0.1](docs/startup/01-PRD-v0.1.md)
- [Architecture RFC-001](docs/startup/02-Architecture-RFC-001.md)
- [Roadmap](docs/startup/03-Development-Roadmap.md)
- [Acceptance criteria](docs/startup/04-Acceptance-Criteria.md)
- [Risk register](docs/startup/05-Risk-Register.md)
- [M0 baseline evidence](docs/startup/06-M0-Baseline-Report.md)
- [M1 session lease evidence](docs/startup/07-M1-Session-Lease-Report.md)
- [M2 managed Worktree evidence](docs/startup/08-M2-Managed-Worktree-Report.md)
- [M3 multi-Agent orchestration evidence](docs/startup/09-M3-Multi-Agent-Orchestration-Report.md)
- [M4 stability and diagnostics evidence](docs/startup/10-M4-Stability-Audit-Diagnostics-Report.md)
- [M5 productization status](docs/startup/11-M5-Productization-Report.md)
- [Pilot user guide](docs/startup/12-User-Guide.md)
- [macOS release runbook](docs/startup/13-macOS-Release-Runbook.md)
- [Pilot kit](docs/startup/14-Pilot-Kit.md)
- [Upstream strategy](UPSTREAM.md)
- [Third-party notices](NOTICE.md)

## Data boundaries

- Existing Pi sessions and authentication remain under `~/.pi/agent`.
- Product configuration and metadata use the dedicated Electron user-data
  directory `Vizruna`.
- The application must not modify the operating-system global proxy.
- A Provider route is resolved for an individual Worker.
