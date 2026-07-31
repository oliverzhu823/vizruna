<p align="center">
  <img src="resources/icon.svg" width="180" alt="Vizruna" />
</p>

<p align="center">
  A visible, controllable, local-first desktop workspace for Pi-powered AI Agents.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English
</p>

# Vizruna

Vizruna turns the Pi Agent runtime into a practical desktop product. You can
chat with an Agent, watch its reasoning and tool activity, switch models and
thinking levels, inspect changed files, run a terminal, and coordinate parallel
work without leaving one workspace.

Status: **Public Alpha**. Everyone is welcome to download and use Vizruna. The
current package supports **Apple-silicon Macs (M1/M2/M3/M4 and later)**. Avoid
mission-critical work while the product is still in Alpha.

![Vizruna desktop workspace](docs/images/vizruna-desktop.png)

## Highlights in v0.1.0-alpha.4

- **Agent Profile Library** for named, scenario-specific Agents with a fixed
  System Prompt.
- **Session System Prompt Library** with create, edit, duplicate, archive, and
  one-session temporary prompt workflows.
- A new conversation selects exactly one of General Pi, a saved System Prompt,
  or an Agent Profile. The first message stores an immutable snapshot.
- **Agent Case Library** for turning successful conversations into indexed,
  testable assets with model, thinking level, tags, and validation status.
- Fixes for model discovery, provider configuration import, and prerelease
  version comparison.
- Improved message action spacing, composer typography, and immediate
  “Thinking…” feedback.
- Complete isolation between source development and the installed product.
- Hardened unsigned-build updates: Vizruna accepts only assets from the matching
  official Release, verifies `SHA256SUMS.txt`, and handles quarantine only for
  that downloaded DMG before the user manually replaces the application.

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
- Image paste, file/line references, and desktop previews for common tool results.

### Multi-Agent and extensibility

- Managed Git worktrees for isolated branches and parallel work.
- Child-Agent orchestration with task status and validation evidence.
- Management for Pi Skills, Extensions, project context, and native prompt resources.
- Configurable voice transcription and desktop alerts.

### Interface, data, and reliability

- Chinese and English UI with Light, Dark, System, and Sage eye-care themes.
- Local-first storage for conversations, authentication, Agent Profiles,
  prompts, and cases.
- Database migration backup plus reliability, recovery, and redacted audit tools.
- Automatic or manual checks for new GitHub Releases.

## Download and install

1. Open the repository's [Releases](https://github.com/oliverzhu823/vizruna/releases).
2. Download `Vizruna-*-arm64.dmg` from the newest prerelease.
3. Download `SHA256SUMS.txt` and verify the package.
4. Open the DMG and drag **Vizruna** into **Applications**.
5. Launch Vizruna.

Current Alpha packages are **not Developer ID-signed or Apple-notarized**.
After confirming the file came from this repository and its SHA-256 matches:

1. Try opening Vizruna once.
2. Open **System Settings → Privacy & Security** and choose **Open Anyway**.
3. If macOS reports that the app is damaged, remove the download quarantine
   attribute for this application only:

```bash
xattr -dr com.apple.quarantine /Applications/Vizruna.app
```

Never use this command for software from an untrusted source, and do not disable
Gatekeeper globally.

The DMG is currently for Apple-silicon Macs only. Windows, Linux, and Intel Mac
packages have not completed release acceptance.

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

Unsigned Alpha builds use an assisted update flow:

1. Vizruna checks for releases after launch, or check under
   **Settings → General → App version**.
2. Choose **Download and open installer**. Vizruna requires the installer and
   `SHA256SUMS.txt` to come from the same official Release, then verifies the
   downloaded file locally.
3. After verification, Vizruna handles quarantine only for that DMG in its own
   temporary update directory and opens it. It never disables or changes system
   Gatekeeper and does not touch other files.
4. Quit the old Vizruna completely.
5. Drag the new app to Applications and choose **Replace**.

The **first installation** still requires the manual approval described above;
an unsigned Alpha cannot bypass that macOS boundary from inside the app. Once
alpha.4 or later is installed, use Vizruna's in-app updater for future versions
instead of downloading them in a browser. This enables automatic verification
and avoids a browser adding download quarantine again. If verification metadata
is absent, Vizruna stops the assisted flow and opens the official Release page.

Replacing `/Applications/Vizruna.app` preserves data stored outside the app:

- `~/Library/Application Support/Vizruna` — settings, Agent Profiles, prompts,
  case index, and database.
- `~/.pi/agent` — Pi sessions, OAuth, and provider configuration.
- `~/.vizruna/worktrees` — managed worktrees.

Do not remove those directories with an uninstall cleaner. Back them up before
early Alpha upgrades, and avoid downgrading after a database migration.

## User data and privacy

- The release package is produced from a clean checkout and never contains the
  maintainer's conversations, recent projects, tokens, proxy passwords, or paths.
- Users should still avoid putting secrets in prompts or committing credentials.
- Source and binary redistribution terms are described in [NOTICE.md](NOTICE.md).

## Feedback

Use [GitHub Issues](https://github.com/oliverzhu823/vizruna/issues) to report a
bug or request a workflow. Include the Vizruna version, macOS version, Mac model,
and provider when relevant, but never post API keys, OAuth tokens, or private
conversation content.

## Development

Requirements: Node.js 22.19.x, npm, Git, and macOS Apple Silicon for packaging.

Source development runs as **Vizruna Dev** and stores both application state and
Pi state under `~/Library/Application Support/Vizruna Dev`. It does not inherit
the installed product's `~/.pi/agent` credentials or sessions.

```bash
nvm use
npm ci
npm run dev
```

Run the complete local quality suite:

```bash
npm run verify
```

Build the current unsigned Apple Silicon prerelease:

```bash
npm run package:mac:unsigned
```

The command disables Developer ID identity discovery, verifies that the result
has no Developer ID signature, and confirms the documented Gatekeeper rejection.
The GitHub prerelease workflow also launches the package with isolated data and
generates SHA-256 checksums, an SBOM, and build provenance.

Future stable releases use `npm run package:mac:release`, which fails unless
Developer ID signing, notarization, stapling, and Gatekeeper verification succeed.
