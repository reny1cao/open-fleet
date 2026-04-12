/**
 * Server-Sent Events (SSE) broadcast module.
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

// Active SSE client connections
interface SSEClient {
  controller: ReadableStreamDefaultController
  id: number
}

let nextClientId = 1
const clients = new Set<SSEClient>()

const encoder = new TextEncoder()

// Monotonic event counter — enables Last-Event-ID reconnect
let nextEventId = 1

function formatSSE(event: string, data: unknown): Uint8Array {
  const id = nextEventId++
  return encoder.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** Current event ID (for debugging/monitoring) */
export function currentEventId(): number {
  return nextEventId - 1
}

/** Broadcast an event to all connected SSE clients */
export function broadcast(event: string, data: unknown): void {
  const payload = formatSSE(event, data)
  for (const client of clients) {
    try {
      client.controller.enqueue(payload)
    } catch {
      // Client disconnected — remove it
      clients.delete(client)
    }
  }
}

/** Number of connected SSE clients */
export function clientCount(): number {
  return clients.size
}

/** Handle a new SSE connection — returns a streaming Response */
export function handleSSE(_req: Request): Response {
  const clientId = nextClientId++

  const stream = new ReadableStream({
    start(controller) {
      const client: SSEClient = { controller, id: clientId }
      clients.add(client)

      // Send initial connection event (with id for consistency)
      controller.enqueue(
        formatSSE("system:connected", { clientId, ts: new Date().toISOString() })
      )
    },
    cancel() {
      // Client disconnected
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
      "X-Accel-Buffering": "no",  // Prevent Nginx/Caddy from buffering SSE
    },
  })
}

// --- Periodic broadcasts ---

// Keepalive ping every 30s — keeps connections alive through proxies
const PING_INTERVAL = 30_000

setInterval(() => {
  if (clients.size === 0) return
  broadcast("system:ping", { ts: new Date().toISOString(), clients: clients.size })
}, PING_INTERVAL)
