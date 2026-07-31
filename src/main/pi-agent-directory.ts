import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const PI_AGENT_DIRECTORY_ENV = 'PI_CODING_AGENT_DIR'

export function getLegacyPiAgentDirectory(): string {
  return join(homedir(), '.pi', 'agent')
}

/**
 * Pi resolves its user configuration from PI_CODING_AGENT_DIR when present.
 * Every Main-process feature must use the same directory as the SDK/Worker;
 * otherwise the UI can advertise models from one profile while inference reads
 * credentials from another.
 */
export function getPiAgentDirectory(): string {
  const explicit = process.env[PI_AGENT_DIRECTORY_ENV]?.trim()
  return explicit ? resolve(explicit) : getLegacyPiAgentDirectory()
}
