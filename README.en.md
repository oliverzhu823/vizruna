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

Vizruna is a visual, composable, local-first Agent Harness built specifically for Pi Agent.
It turns the Pi Agent runtime into a practical local workspace and makes Pi models,
authentication, Skills, Extensions, prompts, tools, and session behavior easier to understand
and debug.
**Vizruna-web** runs in your browser. You can chat with an Agent, watch its
reasoning and tool activity, switch models and thinking levels, inspect changed
files, run a terminal, and coordinate parallel work without leaving one workspace.

Status: **Public Alpha**. Vizruna-web is the only user edition currently
maintained and distributed. Desktop-client development and distribution are
paused. Avoid mission-critical work while the product is still in Alpha.

![Vizruna-web workspace](docs/images/vizruna-web.png)

## Highlights in v0.1.0-alpha.6

- Agent Profiles are now a complete Pi-native Agent workspace that composes models,
  thinking levels, System Prompts, tools, Skills, Extensions, Prompt Templates,
  Packages, and project context with an effective-configuration preview.
- Immutable Agent Versions, fixed-task evaluations, version comparisons, and a
  validation gate connect improvements and releases to real Pi evidence and human review.
- Pi Package Studio and Package import can export, install, and reproduce mature Agents
  while preserving provenance, target-readiness checks, and credential isolation.
- Pi Inspector, the Resource Center, and Run Debugger expose Runtime, authorization,
  loaded resources, tool calls, context, tokens, cost, compaction, errors, and per-turn evidence.
- The embedded Pi Runtime is upgraded to verified `0.84.1`, with Runtime contracts,
  production SBOM coverage, and zero known production dependency vulnerabilities.
- The right-side tool navigation is grouped into session/runtime, project workspace,
  and extension sections with three compact items per row and direct switching.

See [CHANGELOG.md](CHANGELOG.md) for the complete release notes.

## Complete feature set

### Conversations, models, and execution

- **Native Pi model workflow**: choose provider, model, and thinking level;
  authenticate with `/login`, `/logout`, OAuth, or an API key. The embedded and
  tested Pi Runtime is currently `0.84.1`.
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

- **Agent Composer**: create, edit, duplicate, and archive named Agents that
  combine a System Prompt, model, thinking level, base tools, Pi Packages,
  Skills, Extensions, Prompt Templates, and project context; declare reasoning,
  image-input, and minimum-context requirements; and grant Extension-registered
  tools individually, with an effective preview before starting a conversation.
- **Immutable runtime snapshots**: each new conversation stores the Pi resources
  actually resolved at creation time. Later profile edits cannot change existing
  conversations, and Pi Inspector shows the resource policy and resolved count.
- **Agent Versions**: every effective configuration change creates a stable,
  immutable version. Compare changes, run historical versions, and promote a version
  only after its complete fixed-task evaluation passes. When a validated version already
  exists, the candidate must also improve on or match that latest baseline; regressions,
  mixed results, and insufficient evidence are explained and blocked.
- **Agent Asset Catalog**: summarize and filter In-development, Validated, and Delivery
  assets without forcing them into mutually exclusive labels. A newer candidate does not
  hide an older mature version, and the delivery view verifies that the managed Pi Package
  still exists and matches the immutable Agent/version identity in the active project.
- **Pi Run Debugger**: inspect the actual per-turn tool order, Pi-base versus
  Extension origin, duration, context compaction, and errors, with an initial
  failure-layer diagnosis across authentication, provider, context, tools, and Runtime.
  Each turn also keeps before/after context deltas and evidence of the Pi resources
  actually exposed by the live session.
- **Pi Package Studio**: generate a standard local Pi Package from a validated
  Agent Version, enforcing the evaluation gate before portability and dependency
  checks, then export it or install it through Pi's native PackageManager. A target-
  environment manifest separately checks Runtime, model, Provider authorization, Pi
  resources, project context, and tool policy; its `DELIVERY_CHECKLIST.md` never contains credentials.
- **Package import and local reproduction**: inspect immutable package identity and
  this machine's real Pi environment inside a trusted project, then independently
  confirm dependency installation, Agent Package installation, and configuration import.
  Imported configurations preserve source provenance but start as local candidates for
  re-evaluation; source maturity, machine paths, and credentials are never copied.
- **Agent lifecycle workspace**: open one Agent as a continuous working context,
  inspect its Pi configuration, immutable version, bound cases, current fixed tasks,
  latest evaluation verdicts, validation blockers, and local Package evidence. Vizruna
  derives one contextual primary action and opens the exact run, review, validation,
  or delivery workflow without bypassing its confirmation gates.
- **Local run preflight**: recompute Pi Runtime, model authorization, Provider capabilities,
  Pi resources, project context, and tool policy before launch. Missing explicit dependencies
  block a false-success start and route to per-check repair. OAuth completion triggers an
  automatic recheck, manual retry remains available, and settings navigation preserves the Agent context.
- **Agent run evidence chain**: the workspace lists real Pi sessions bound to this exact Agent
  snapshot, including immutable version, live/failure status, error evidence, message count,
  generated files, and saved cases. Reopen the source or promote a real run into a case and
  the current version's evaluation evidence. Its object-focused run desk uses a left-side run
  list and right-side detail view; file artifacts open in Review and two runs can be compared.
- **Pi Capability Manifest**: move beyond resource counts by grouping built-in tools,
  Pi Packages, Extensions, Skills, Prompt Templates, and project context. Each item exposes
  provenance, scope, Extension-registered tools, inherited state, and missing/disabled blockers,
  with a direct repair route to the Pi Resource Center.
- **Runtime capability evidence and drift diagnosis**: new runs persist what Pi AgentSession
  actually loaded—tools, Skills, Extensions, Prompts, Context files, System Prompt sources,
  and before/after context usage. The run desk compares it with the session's immutable Agent
  snapshot and explains missing, additional, inherited, or exact capabilities. Older runs
  without evidence are explicitly unknown rather than inferred.
- **Pi run health**: the Run Desk aggregates tokens, cache usage, cost, tool calls, and failures
  from the active Pi branch timeline, then combines run-boundary Context snapshots to flag high
  pressure, material growth, and compaction. Loaded capabilities remain distinct from capabilities
  actually invoked; long sessions explicitly disclose the latest-500-record sample boundary.
- **Per-turn Pi evidence**: every Agent run persists start/end Context, tokens, tools, compaction,
  files, and errors under its session/run identity. The Run Desk expands the latest 50 turns to
  locate where a problem began; later runs never overwrite earlier evidence and legacy history is
  never inferred from the current environment.
- **Evidence-based run comparison**: select another run to compare version, model, thinking,
  actual capabilities, tokens, cost, tool failures, Context, and compaction. Deterministic rules
  flag notable changes without model-generated causal claims, and missing or sampled evidence is
  disclosed explicitly.
- **Evidence-to-action diagnosis**: the Run Desk applies fixed rules to run failures, capability
  drift, Context pressure, tool failures, compaction, and sampling boundaries, then offers one
  precise route to the source run, rerun, Pi Resource Center, or Agent configuration. It neither
  edits the Agent automatically nor asks a model to invent a root cause.
- **System Prompt Library**: manage reusable prompts or enter a temporary prompt
  for the next conversation without saving it.
- **One prompt source per conversation**: General Pi, one System Prompt, or one
  Agent Profile; the choice is fixed after the first message.
- **Agent Case Library**: archive useful conversations with name, description,
  tags, source project/session, model, thinking level, and validation status.
  New cases also freeze the Agent snapshot fingerprint, Pi Runtime version, and
  dependent Package versions, and can verify whether the current environment still
  reproduces that evidence. Cases reference the original Pi history and never copy credentials.
- **Agent Evaluation Studio**: define fixed tasks for one Agent and attach real
  case runs after each revision. Vizruna freezes the Agent snapshot version,
  actual input and output, model, latency, tokens, recorded cost, tool calls,
  and failures, while the user records a Passed, Failed, or Needs review verdict
  against explicit human criteria. Copy the exact task set to another immutable
  version, then compare human verdicts, prompt integrity, latency, tokens, cost,
  and tool failures task by task. Vizruna conservatively reports improvement,
  equivalence, regression, mixed results, or insufficient evidence. After explicit
  confirmation of API usage and tool side effects, a full suite can also run
  sequentially in isolated background Pi sessions, with durable progress,
  cancellation, per-task failure isolation, and no test-only case-library clutter.
  Version comparisons can be exported as privacy-aware Markdown reports; task
  content and model outputs remain excluded unless explicitly enabled.
- **Pi Effective Configuration Inspector**: inspect the active Pi Runtime,
  model, authentication, network route, final System Prompt sources, tools,
  Skills, Extensions, Prompt Templates, and Packages for the current session,
  with configured and runtime-loaded resources shown separately.

### Workspace and review

- Integrated file browser and interactive project terminal.
- Right-side Review for changed files, diffs, Markdown, and code, with an option
  to open files in their default macOS app.
- Run, Context, and Tree panels for evidence-based inspection.
- Image paste, file/line references, and browser previews for common tool results.

### Multi-Agent and extensibility

- Managed Git worktrees for isolated branches and parallel work.
- Child-Agent orchestration with task status and validation evidence.
- Management for Pi Skills, Extensions, project context, and native prompt resources,
  including Pi 0.84 same-directory `AGENTS.override.md` precedence.
- A unified **Pi Resource Center** for user/project Packages, Skills, Extensions,
  Prompt Templates, and Themes, with Package install/repair, update checks,
  update, removal, and per-resource controls native to Pi directories and `settings.json`.
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
