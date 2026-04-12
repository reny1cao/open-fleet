/**
 * Server-Sent Events (SSE) broadcast module with replay buffer.
 *
 * Features:
 *   - Monotonic event IDs (enables Last-Event-ID reconnect)
 *   - Ring buffer storing last REPLAY_BUFFER_SIZE events
 *   - On reconnect with Last-Event-ID, replays missed events
 *   - Keepalive ping every 30s
 *
 * Usage:
 *   import { handleSSE, broadcast } from "./sse"
 *
 *   // In request handler:
 *   if (path === "/events") return handleSSE(req)
 *
 *   // After any store write:
 *   broadcast("task:updated", { task })
 */

// --- Configuration ---
const REPLAY_BUFFER_SIZE = 500
const PING_INTERVAL = 30_000

// --- Types ---
interface SSEClient {
  controller: ReadableStreamDefaultController
  id: number
}

interface BufferedEvent {
  id: number
  encoded: Uint8Array
}

// --- State ---
let nextClientId = 1
let nextEventId = 1
const clients = new Set<SSEClient>()
const replayBuffer: BufferedEvent[] = []
const encoder = new TextEncoder()

// --- Formatting ---
function formatSSE(id: number, event: string, data: unknown): Uint8Array {
  return encoder.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// --- Public API ---

/** Broadcast an event to all connected SSE clients and buffer for replay */
export function broadcast(event: string, data: unknown): void {
  const id = nextEventId++
  const encoded = formatSSE(id, event, data)

  // Add to ring buffer
  replayBuffer.push({ id, encoded })
  if (replayBuffer.length > REPLAY_BUFFER_SIZE) {
    replayBuffer.shift()
  }

  // Send to all connected clients
  for (const client of clients) {
    try {
      client.controller.enqueue(encoded)
    } catch {
      clients.delete(client)
    }
  }
}

/** Number of connected SSE clients */
export function clientCount(): number {
  return clients.size
}

/** Current highest event ID (for monitoring) */
export function currentEventId(): number {
  return nextEventId - 1
}

/** Handle a new SSE connection — returns a streaming Response */
export function handleSSE(req: Request): Response {
  const clientId = nextClientId++

  // Check for Last-Event-ID (reconnect)
  const lastEventIdStr = req.headers.get("Last-Event-ID")
  const lastEventId = lastEventIdStr ? parseInt(lastEventIdStr, 10) : null

  const stream = new ReadableStream({
    start(controller) {
      const client: SSEClient = { controller, id: clientId }
      clients.add(client)

      // Send connection event
      const connectId = nextEventId++
      controller.enqueue(
        formatSSE(connectId, "system:connected", {
          clientId,
          ts: new Date().toISOString(),
          replayFrom: lastEventId,
        })
      )

      // Replay missed events if reconnecting with Last-Event-ID
      if (lastEventId !== null && !isNaN(lastEventId)) {
        const oldestBuffered = replayBuffer.length > 0 ? replayBuffer[0].id : null

        if (oldestBuffered !== null && lastEventId >= oldestBuffered) {
          // Replay events after lastEventId
          let replayed = 0
          for (const event of replayBuffer) {
            if (event.id > lastEventId) {
              try {
                controller.enqueue(event.encoded)
                replayed++
              } catch {
                clients.delete(client)
                return
              }
            }
          }
          if (replayed > 0) {
            const markerId = nextEventId++
            controller.enqueue(
              formatSSE(markerId, "system:replay_complete", { replayed, fromId: lastEventId })
            )
          }
        } else {
          // lastEventId is too old — not in buffer. Client should full refetch.
          const gapId = nextEventId++
          controller.enqueue(
            formatSSE(gapId, "system:replay_gap", {
              requestedId: lastEventId,
              oldestBuffered,
              message: "Requested event ID is no longer in the replay buffer. Full refetch recommended.",
            })
          )
        }
      }
    },
    cancel() {
      for (const client of clients) {
        if (client.id === clientId) {
          clients.delete(client)
          break
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    },
  })
}

// --- Keepalive ---
setInterval(() => {
  if (clients.size === 0) return
  broadcast("system:ping", { ts: new Date().toISOString(), clients: clients.size })
}, PING_INTERVAL)
