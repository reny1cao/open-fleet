import type { Agent, AgentStatus } from "./types"

/**
 * Derive display status from heartbeat ageSec thresholds.
 *
 * Thresholds:
 *   < 60s  → alive (green)
 *   < 300s → stale (amber)
 *   ≥ 300s → dead (red)
 *   no data → off or unknown (gray)
 */
export function deriveAgentStatus(agent: Agent): AgentStatus {
  const ageSec = agent.heartbeat?.ageSec
  if (ageSec == null || agent.heartbeat?.lastSeen == null) {
    return agent.status === "off" ? "off" : "unknown"
  }
  if (ageSec < 60) return "alive"
  if (ageSec < 300) return "stale"
  return "dead"
}
