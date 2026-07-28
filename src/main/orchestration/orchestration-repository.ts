import type {
  AgentRelationship,
  OrchestrationEvidence,
} from '@shared/orchestration'
import { sqliteIndex } from '../sqlite-index'

export interface OrchestrationRepository {
  saveRelationship(relationship: AgentRelationship): void | Promise<void>
  getRelationship(id: string): AgentRelationship | null | Promise<AgentRelationship | null>
  getByChildSession(
    childSessionFile: string,
  ): AgentRelationship | null | Promise<AgentRelationship | null>
  listRelationships(options?: {
    parentSessionFile?: string
    rootWorkspacePath?: string
  }): AgentRelationship[] | Promise<AgentRelationship[]>
  addEvidence(evidence: OrchestrationEvidence): void | Promise<void>
  listEvidence(
    relationshipId: string,
  ): OrchestrationEvidence[] | Promise<OrchestrationEvidence[]>
}

export class SqliteOrchestrationRepository implements OrchestrationRepository {
  saveRelationship(relationship: AgentRelationship): void {
    sqliteIndex.upsertAgentRelationship(relationship)
  }

  getRelationship(id: string): AgentRelationship | null {
    return sqliteIndex.getAgentRelationship(id)
  }

  getByChildSession(childSessionFile: string): AgentRelationship | null {
    return sqliteIndex.getAgentRelationshipByChildSession(childSessionFile)
  }

  listRelationships(options?: {
    parentSessionFile?: string
    rootWorkspacePath?: string
  }): AgentRelationship[] {
    return sqliteIndex.listAgentRelationships(options)
  }

  addEvidence(evidence: OrchestrationEvidence): void {
    sqliteIndex.addOrchestrationEvidence(evidence)
  }

  listEvidence(relationshipId: string): OrchestrationEvidence[] {
    return sqliteIndex.listOrchestrationEvidence(relationshipId)
  }
}

export class MemoryOrchestrationRepository implements OrchestrationRepository {
  private readonly relationships = new Map<string, AgentRelationship>()
  private readonly evidence = new Map<string, OrchestrationEvidence>()

  saveRelationship(relationship: AgentRelationship): void {
    this.relationships.set(relationship.id, structuredClone(relationship))
  }

  getRelationship(id: string): AgentRelationship | null {
    const value = this.relationships.get(id)
    return value ? structuredClone(value) : null
  }

  getByChildSession(childSessionFile: string): AgentRelationship | null {
    const value = [...this.relationships.values()].find(
      (relationship) => relationship.childSessionFile === childSessionFile,
    )
    return value ? structuredClone(value) : null
  }

  listRelationships(options?: {
    parentSessionFile?: string
    rootWorkspacePath?: string
  }): AgentRelationship[] {
    return [...this.relationships.values()]
      .filter(
        (relationship) =>
          (!options?.parentSessionFile ||
            relationship.parentSessionFile === options.parentSessionFile) &&
          (!options?.rootWorkspacePath ||
            relationship.rootWorkspacePath === options.rootWorkspacePath),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((relationship) => structuredClone(relationship))
  }

  addEvidence(evidence: OrchestrationEvidence): void {
    if (!this.evidence.has(evidence.id)) {
      this.evidence.set(evidence.id, structuredClone(evidence))
    }
  }

  listEvidence(relationshipId: string): OrchestrationEvidence[] {
    return [...this.evidence.values()]
      .filter((evidence) => evidence.relationshipId === relationshipId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((evidence) => structuredClone(evidence))
  }
}
