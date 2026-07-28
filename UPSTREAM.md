# Upstream strategy

Vizruna has one code upstream:

- Remote: <https://github.com/justhil/pi-app>
- Git remote name: `upstream`
- Pinned starting commit: `bcef920e3900a858b305c67c42a34e61779f977c`

`minghinmatthewlam/pi-gui` is a behavior reference, not a Git merge upstream.
Worktree, orchestration, session lease, terminal, and provider-auth behavior must
be implemented against the architecture in `docs/startup/02-Architecture-RFC-001.md`.

Before taking an upstream update:

1. Fetch without merging.
2. Review session, Worker, IPC, SQLite, packaging, and Pi SDK changes.
3. Run `npm run verify`.
4. Run the Electron smoke suite on the supported macOS target.
5. Record the accepted upstream commit and compatibility evidence.
