<p align="center">
  <img src="resources/icon.svg" width="180" alt="Vizruna" />
</p>

<p align="center">
  A visible, controllable, local-first browser workspace for Pi-powered AI Agents.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English
</p>

# Vizruna

Vizruna turns the Pi Agent runtime into a practical local Agent workspace.
**Vizruna-web** runs in your browser. You can chat with an Agent, watch its
reasoning and tool activity, switch models and thinking levels, inspect changed
files, run a terminal, and coordinate parallel work without leaving one workspace.

Status: **Public Alpha**. Vizruna-web is the only user edition currently
maintained and distributed. Desktop-client development and distribution are
paused. Avoid mission-critical work while the product is still in Alpha.

![Vizruna-web workspace](docs/images/vizruna-web.png)

## Highlights in v0.1.0-alpha.5

- **Vizruna-web** is now the only distributed entry point, providing the complete Agent
  Studio, model login, conversations, files, terminal, Review, Worktree, and
  multi-Agent features in the default browser without a desktop installer.
- `Start-Vizruna-web.command` provides a double-click launcher. Git clones update
  only from the official repository when `main` is clean and fast-forwardable.
- The service binds only to `127.0.0.1` and uses a one-time random startup token,
  an HttpOnly session, origin and CSRF checks, an RPC allowlist, and schema validation.
- Conversations, Pi authentication, provider settings, Agent Profiles, prompts,
  and cases live outside the source folder. Updating Vizruna-web does not delete
  this user data.
- Browser-native project path validation, controlled attachment storage, and
  direct diagnostics/audit downloads replace fragile native-window interactions.
- Browser end-to-end coverage now exercises provider events, model capability,
  workspace switching, Review, Worktree, orchestration, exports, media APIs, and
  critical security rejection paths.

See [CHANGELOG.md](CHANGELOG.md) for the complete release notes.

## Complete feature set

### Conversations, models, and execution

- **Native Pi model workflow**: choose provider, model, and thinking level;
  authenticate with `/login`, `/logout`, OAuth, or an API key.
- **Effective defaults for new conversations**: reuse the last valid model and
  thinking level and show them immediately.
- **Provider-specific routing**: send overseas providers through a V2Ray-style
  proxy while domestic providers stay direct, without changing the macOS
  system proxy.
- **Visible Agent execution**: chronological user messages, reasoning state,
  tool calls, streaming output, statistics, context usage, and conversation tree.
- **Session operations**: project sessions, temporary chats, rename, Fork,
  Clone, rewind, and history recovery.

### Agent Studio

- **Agent Profile Library**: create, edit, duplicate, and archive named Agents
  with scenario-specific System Prompts.
- **System Prompt Library**: manage reusable prompts or enter a temporary prompt
  for the next conversation without saving it.
- **One prompt source per conversation**: General Pi, one System Prompt, or one
  Agent Profile; the choice is fixed after the first message.
- **Agent Case Library**: archive useful conversations with name, description,
  tags, source project/session, model, thinking level, and validation status.
  Cases reference the original Pi history and never copy credentials.

### Workspace and review

- Integrated file browser and interactive project terminal.
- Right-side Review for changed files, diffs, Markdown, and code, with an option
  to open files in their default macOS app.
- Run, Context, and Tree panels for evidence-based inspection.
- Image paste, file/line references, and browser previews for common tool results.

### Multi-Agent and extensibility

- Managed Git worktrees for isolated branches and parallel work.
- Child-Agent orchestration with task status and validation evidence.
- Management for Pi Skills, Extensions, project context, and native prompt resources.
- Configurable voice transcription and local system alerts.

### Interface, data, and reliability

- Chinese and English UI with Light, Dark, System, and Sage eye-care themes.
- Local-first storage for conversations, authentication, Agent Profiles,
  prompts, and cases.
- Database migration backup plus reliability, recovery, and redacted audit tools.
- Safe source updates for official, clean, fast-forwardable Git clones; ZIP
  upgrades keep user data outside the source folder.

## Install and run Vizruna-web

Vizruna-web opens its interface in your default browser while the Pi Runtime,
terminal, files, and credentials remain on your computer. The current public
Alpha has been accepted on macOS and runs from a source bundle, with no `.app`
or DMG installation.

### Option 1: Download the Release source bundle (recommended for users)

1. Install [Node.js](https://nodejs.org/en/download) 22.19.0 or newer; npm is included.
2. Open [Vizruna Releases](https://github.com/oliverzhu823/vizruna/releases),
   download `Vizruna-web-VERSION-source.zip`, and optionally verify it against
   `SHA256SUMS.txt`.
3. Extract the ZIP and open its `Vizruna-web-VERSION` folder.
4. Double-click `Start-Vizruna-web.command`. The first launch downloads local
   dependencies and builds the browser UI, which may take a few minutes.
5. Use Vizruna-web when the default browser opens. Keep the Terminal window open;
   press `Control+C` there to stop the local runtime.

To verify the download, place the ZIP and `SHA256SUMS.txt` in the same directory
and run:

```bash
grep 'Vizruna-web-.*-source.zip' SHA256SUMS.txt | shasum -a 256 -c -
```

Continue only when the source ZIP reports `OK`.

If macOS does not run the launcher directly, right-click it and choose **Open**.
If it still lacks execute permission, open Terminal in that folder and run:

```bash
chmod +x Start-Vizruna-web.command
./Start-Vizruna-web.command
```

Do not run these commands for a script from an untrusted source.

### Option 2: Clone with Git (recommended for ongoing testing and development)

Run:

```bash
git clone https://github.com/oliverzhu823/vizruna.git
cd vizruna
./Start-Vizruna-web.command
```

This option also requires Git. The launcher safely checks the official `main`
branch on every launch. It updates only
when origin points exactly to `oliverzhu823/vizruna`, the current branch is
`main`, the worktree is clean, and the update is a fast-forward. Offline,
untrusted, diverged, or locally modified copies are preserved and continue to
start normally. To skip one update check, run:

```bash
VIZRUNA_WEB_SKIP_UPDATE=1 ./Start-Vizruna-web.command
```

Each Release contains one Vizruna-web source ZIP plus SHA-256 checksums, an SBOM,
and GitHub build provenance. Desktop installers are no longer published.

The service binds only to `127.0.0.1`, so other devices on the LAN cannot reach
it. Every launch creates a new random access token, and the local API is further
protected by an HttpOnly session, same-origin validation, and CSRF checks. Do
not change the bind address to `0.0.0.0` or share the launch URL.

### Startup troubleshooting

- **Node.js is missing**: install Node.js 22.19.0 or newer, close Terminal, and retry.
- **The launcher is not executable**: use the `chmod +x` command above for this
  downloaded launcher only.
- **The browser did not open**: press `Control+C`, then restart the launcher. Do
  not reuse an old launch URL because its one-time token has expired.
- **Another instance is running**: close every other Vizruna-web launcher window
  and retry. Only one local runtime may write the product data at a time.
- **First-time dependency installation failed**: confirm npm has internet access
  and run the launcher again; it safely prepares the environment again.

## Quick start

1. Choose **Open folder** for project work, or start with **New chat** for a
   temporary conversation.
2. Select a provider, model, and thinking level beside the composer.
3. Authenticate with `/login`, or open **Settings → Models**. Use `/logout` to
   disconnect a provider account.
4. For a specialized role, select a **System Prompt** or **Agent Profile** from
   the lower-left composer control; otherwise use General Pi.
5. Type the outcome you want. Vizruna immediately shows your message and then
   displays thinking, tool, and response activity in chronological order.
6. Use **Review**, **Run**, **Context**, and **Tree** to inspect the result.

### Proxy and direct connections

Open **Settings → Provider routing** to create a proxy profile and assign a route
per provider. OpenAI Codex can use the V2Ray profile while a Chinese model
provider remains on **Direct**. The route applies only to that Agent worker and
does not rewrite the global system proxy.

## Choosing prompts, Agent Profiles, and cases

- For a one-off customized conversation, enter a temporary System Prompt from
  the new-conversation selector.
- For instructions you reuse while choosing model settings each time, save a
  Session System Prompt under **Settings → Prompts**.
- For a stable role or workflow, create a named entry in the **Agent Profile Library**.
- When a real task succeeds and deserves repeat testing, archive the current
  conversation as an **Agent Case**, add notes and tags, then mark it validated.

System Prompts define an Agent's role, goals, boundaries, and output contract.
Methods invoked dynamically during a run are better implemented as Skills.

## Updating without losing data

**Git clones**: launch normally. When the origin is official, `main` is clean,
and the remote update is fast-forwardable, the launcher safely updates source,
installs changed dependencies, and rebuilds before startup.

**Release ZIP copies**: stop the old version, download the new ZIP, extract it
into a new folder, and run the launcher from that folder. Delete the old source
folder only after the new version works. ZIP copies never overwrite themselves,
so a failed upgrade cannot damage the currently usable copy.

Both upgrade paths preserve data stored outside the source folder:

- `~/Library/Application Support/Vizruna` — settings, Agent Profiles, prompts,
  case index, and database.
- `~/.pi/agent` — Pi sessions, OAuth, and provider configuration.
- `~/.vizruna/worktrees` — managed worktrees.

Do not remove those directories manually or with a cleanup utility. Back them
up before early Alpha upgrades, and avoid downgrading after a database migration.

## User data and privacy

- GitHub produces the source bundle from a repository commit; it never contains the
  maintainer's conversations, recent projects, tokens, proxy passwords, or paths.
- Users should still avoid putting secrets in prompts or committing credentials.
- Source and binary redistribution terms are described in [NOTICE.md](NOTICE.md).

## Feedback

Use [GitHub Issues](https://github.com/oliverzhu823/vizruna/issues) to report a
bug or request a workflow. Include the Vizruna version, macOS version, Mac model,
and provider when relevant, but never post API keys, OAuth tokens, or private
conversation content.

## Development

Requirements: Node.js 22.19.0 or newer, npm, and Git. The current user release
flow has completed macOS acceptance; Windows and Linux support is not yet promised.

`npm run dev:web` uses the same local product data as public Vizruna-web so real
usage can be reproduced; back up data before changing persistence or credential
code. Automated E2E uses isolated temporary application and Pi directories and
never reads production OAuth tokens, API keys, or conversations.

```bash
nvm use
npm ci
npm run dev:web
```

Daily product development and acceptance use Vizruna-web. Desktop-client source
is retained temporarily as a shared runtime and rollback reference, but receives
no feature development and is excluded from prerelease artifacts.

Run the complete local quality suite:

```bash
npm run verify
```

Run browser end-to-end tests:

```bash
npm run test:e2e:install
npm run test:e2e:web
```

When a version tag is pushed, GitHub produces only the versioned Vizruna-web
source ZIP, SHA-256 checksums, an SBOM, and build provenance. It does not build
or upload a DMG, `.app`, or desktop ZIP.
