import { useEffect, useRef } from "react"
import { useFleetStore } from "./use-fleet-store"
import { api } from "../lib/api"

const INITIAL_RECONNECT_DELAY = 3000
const MAX_RECONNECT_DELAY = 30000

export function useSSE(enabled = true) {
  const store = useFleetStore()
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled) return

    let reconnectTimer: ReturnType<typeof setTimeout>
    let reconnectDelay = INITIAL_RECONNECT_DELAY

    function connect() {
      const es = new EventSource(api.eventsUrl())
      esRef.current = es

      es.onopen = () => {
        reconnectDelay = INITIAL_RECONNECT_DELAY // Reset backoff on success
        store.setConnected(true)
        // Re-fetch full state on reconnect to catch missed events
        store.fetchAll()
      }

      es.addEventListener("task:created", (e) => {
        const { task } = JSON.parse(e.data)
        store.updateTask(task)
      })

      es.addEventListener("task:updated", (e) => {
        const { task } = JSON.parse(e.data)
        store.updateTask(task)
      })

      es.addEventListener("task:status", (e) => {
        const { taskId, to, agent } = JSON.parse(e.data)
        store.pushActivity({
          timestamp: new Date().toISOString(),
          agent,
          taskId,
          taskTitle: "",
          type: "status_change",
          text: `Status changed to ${to}`,
        })
      })

      es.addEventListener("agent:heartbeat", (e) => {
        const { agent, state, ageSec } = JSON.parse(e.data)
        store.updateAgent({ name: agent, heartbeat: { state, lastSeen: null, ageSec } } as never)
      })

      es.addEventListener("agent:status", (e) => {
        const { agent, status } = JSON.parse(e.data)
        store.updateAgent({ name: agent, status })
      })

      es.addEventListener("agent:error", (e) => {
        const { agent, error } = JSON.parse(e.data)
        store.pushAlert({ ...error, affectedAgent: agent })
      })

      es.addEventListener("agent:restart", (e) => {
        const { agent } = JSON.parse(e.data)
        store.pushActivity({
          timestamp: new Date().toISOString(),
          agent,
          taskId: "",
          taskTitle: "",
          type: "comment",
          text: "Agent restarted",
        })
      })

      es.onerror = () => {
        store.setConnected(false)
        es.close()
        esRef.current = null
        reconnectTimer = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      esRef.current?.close()
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
}
