import { useEffect, useRef, useCallback } from "react"
import { fetchEventSource } from "@microsoft/fetch-event-source"
import { useFleetStore } from "./use-fleet-store"
import { getToken } from "../lib/api"

type ConnectionState = "connected" | "silent" | "degraded" | "offline"

const SILENT_THRESHOLD = 40_000   // 30s ping + 10s grace
const DEGRADED_THRESHOLD = 120_000

export function useConnection(enabled: boolean) {
  const store = useFleetStore()
  const abortRef = useRef<AbortController | null>(null)
  const lastEventRef = useRef<number>(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const updateConnectionState = useCallback(() => {
    const elapsed = Date.now() - lastEventRef.current
    let state: ConnectionState
    if (elapsed < SILENT_THRESHOLD) state = "connected"
    else if (elapsed < DEGRADED_THRESHOLD) state = "degraded"
    else state = "offline"

    store.setConnectionState(state)
    store.setLastUpdatedTs(new Date(lastEventRef.current).toISOString())
  }, [store])

  useEffect(() => {
    if (!enabled) return

    const token = getToken()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // Connection state ticker
    timerRef.current = setInterval(updateConnectionState, 1_000)

    const connect = () => {
      fetchEventSource("/events", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: ctrl.signal,

        onopen: async (res) => {
          if (res.ok) {
            lastEventRef.current = Date.now()
            store.setConnected(true)
            store.setConnectionState("connected")
            await store.fetchAll()
          }
        },

        onmessage: (ev) => {
          lastEventRef.current = Date.now()
          if (!ev.event || !ev.data) return

          try {
            const data = JSON.parse(ev.data)

            switch (ev.event) {
              case "task:created":
              case "task:updated":
                store.updateTask(data.task)
                break
              case "task:status":
                store.pushActivity({
                  timestamp: new Date().toISOString(),
                  agent: data.agent,
                  taskId: data.taskId,
                  taskTitle: "",
                  type: "status_change",
                  text: `${data.from} \u2192 ${data.to}`,
                })
                break
              case "task:assigned":
                store.pushActivity({
                  timestamp: new Date().toISOString(),
                  agent: "",
                  taskId: data.taskId,
                  taskTitle: "",
                  type: "assignment",
                  text: `Assigned to ${data.to}`,
                })
                break
              case "agent:heartbeat":
                store.updateAgent({
                  name: data.agent,
                  status: data.state,
                  heartbeat: { state: data.state, lastSeen: null, ageSec: data.ageSec },
                } as never)
                break
              case "agent:status":
                store.updateAgent({ name: data.agent, status: data.status })
                break
              case "agent:error":
                store.pushAlert({ ...data.error, affectedAgent: data.agent })
                break
              case "agent:restart":
                store.pushActivity({
                  timestamp: new Date().toISOString(),
                  agent: data.agent,
                  taskId: "",
                  taskTitle: "",
                  type: "comment",
                  text: "Agent restarted",
                })
                break
              case "system:ping":
                break
            }
          } catch {
            // Ignore malformed events
          }
        },

        onerror: () => {
          store.setConnected(false)
          // fetch-event-source handles reconnect with backoff automatically
        },

        openWhenHidden: true,
      })
    }

    connect()

    return () => {
      ctrl.abort()
      abortRef.current = null
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
}
