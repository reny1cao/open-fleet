const TURN_TIMEOUT_MS = 10 * 60 * 1000

interface JsonRpcErrorShape {
  message?: string
}

interface JsonRpcResponse<T> {
  id: number
  result?: T
  error?: JsonRpcErrorShape
}

interface ThreadResponse {
  thread: {
    id: string
  }
}

interface TurnResponse {
  turn: {
    id: string
    status: "completed" | "interrupted" | "failed" | "inProgress"
    error?: {
      message?: string
    } | null
  }
}

interface ActiveTurn {
  threadId: string
  turnId?: string
  reply: string
  resolve: (value: RunCodexTurnResult) => void
  reject: (reason?: unknown) => void
}

export interface RunCodexTurnParams {
  cwd: string
  developerInstructions: string
  prompt: string
  existingThreadId?: string
}

export interface RunCodexTurnResult {
  threadId: string
  turnId: string
  reply: string
}

class CodexAppServerClient {
  private readonly proc: ReturnType<typeof Bun.spawn>
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
  }>()
  private nextId = 1
  private activeTurn: ActiveTurn | null = null
  private stdoutBuffer = ""
  private stderrBuffer = ""
  private closed = false
  private exitCallback: (() => void) | null = null

  constructor(private readonly cwd: string) {
    this.proc = Bun.spawn(["codex", "app-server", "--listen", "stdio://"], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
  }

  async start(): Promise<void> {
    this.pump(this.proc.stdout, "stdout").catch((error) => this.failAll(error))
    this.pump(this.proc.stderr, "stderr").catch((error) => this.failAll(error))
    this.proc.exited.then((code) => {
      if (this.closed) {
        this.exitCallback?.()
        return
      }
      this.exitCallback?.()
      this.failAll(new Error(`codex app-server exited with code ${code}${this.stderrBuffer ? `: ${this.stderrBuffer.trim()}` : ""}`))
    })

    await this.request("initialize", {
      clientInfo: {
        name: "open-fleet",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    })
    this.notify("initialized")
  }

  async close(): Promise<void> {
    this.closed = true
    try {
      const stdin = this.proc.stdin as { end(): void } | number | null
      if (stdin && typeof stdin !== "number") {
        stdin.end()
      }
    } catch {}
    try {
      this.proc.kill()
    } catch {}
    await this.proc.exited.catch(() => undefined)
  }

  onExit(callback: () => void): void {
    this.exitCallback = callback
  }

  async runTurn(params: RunCodexTurnParams): Promise<RunCodexTurnResult> {
    const threadId = await this.ensureThread(params)

    const turnPromise = new Promise<RunCodexTurnResult>((resolve, reject) => {
      this.activeTurn = {
        threadId,
        reply: "",
        resolve,
        reject,
      }
    })

    const startResponse = await this.request<TurnResponse>("turn/start", {
      threadId,
      cwd: params.cwd,
      approvalPolicy: "never",
      input: [{
        type: "text",
        text: params.prompt,
        text_elements: [],
      }],
    })

    if (!this.activeTurn) {
      throw new Error("Codex turn state was lost before the turn started")
    }

    this.activeTurn.turnId = startResponse.turn.id

    if (startResponse.turn.status === "completed") {
      const result = {
        threadId,
        turnId: startResponse.turn.id,
        reply: this.activeTurn.reply.trim(),
      }
      this.activeTurn = null
      return result
    }

    if (startResponse.turn.status === "failed") {
      const errorMessage = startResponse.turn.error?.message ?? "Codex turn failed"
      this.activeTurn = null
      throw new Error(errorMessage)
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<RunCodexTurnResult>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Codex turn timed out after ${TURN_TIMEOUT_MS / 1000}s`)), TURN_TIMEOUT_MS)
    })
    try {
      return await Promise.race([turnPromise, timeout])
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }

  private async ensureThread(params: RunCodexTurnParams): Promise<string> {
    if (params.existingThreadId) {
      try {
        const resumed = await this.request<ThreadResponse>("thread/resume", {
          threadId: params.existingThreadId,
          cwd: params.cwd,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          developerInstructions: params.developerInstructions,
          persistExtendedHistory: false,
        })
        return resumed.thread.id
      } catch {}
    }

    const started = await this.request<ThreadResponse>("thread/start", {
      cwd: params.cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      developerInstructions: params.developerInstructions,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    })
    return started.thread.id
  }

  private notify(method: string, params?: unknown): void {
    this.write({
      method,
      ...(params !== undefined ? { params } : {}),
    })
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.write({ id, method, params })
    })
  }

  private write(message: Record<string, unknown>): void {
    const stdin = this.proc.stdin as { write(chunk: string): void } | number | null
    if (!stdin || typeof stdin === "number") {
      throw new Error("codex app-server stdin is not available")
    }
    stdin.write(`${JSON.stringify(message)}\n`)
  }

  private async pump(stream: ReadableStream<Uint8Array> | number | null, kind: "stdout" | "stderr"): Promise<void> {
    if (!stream || typeof stream === "number") return

    const reader = stream.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      if (kind === "stderr") {
        this.stderrBuffer += chunk
        continue
      }

      this.stdoutBuffer += chunk
      this.flushStdoutLines()
    }

    if (kind === "stdout" && this.stdoutBuffer.trim().length > 0) {
      this.handleStdoutLine(this.stdoutBuffer.trim())
      this.stdoutBuffer = ""
    }
  }

  private flushStdoutLines(): void {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n")
      if (newlineIndex < 0) break

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (line.length === 0) continue
      this.handleStdoutLine(line)
    }
  }

  private handleStdoutLine(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch (error) {
      this.failAll(new Error(`Failed to parse codex app-server output: ${line}\n${error instanceof Error ? error.message : error}`))
      return
    }

    if (typeof message.id === "number") {
      this.handleResponse(message as unknown as JsonRpcResponse<unknown>)
      return
    }

    if (typeof message.method === "string") {
      this.handleNotification(message.method, message.params as Record<string, unknown> | undefined)
    }
  }

  private handleResponse(message: JsonRpcResponse<unknown>): void {
    const pending = this.pending.get(message.id)
    if (!pending) return

    this.pending.delete(message.id)

    if (message.error) {
      pending.reject(new Error(message.error.message ?? "Unknown codex app-server error"))
      return
    }

    pending.resolve(message.result)
  }

  private handleNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.activeTurn || !params) return

    if (method === "item/agentMessage/delta") {
      if (params.threadId === this.activeTurn.threadId) {
        this.activeTurn.reply += typeof params.delta === "string" ? params.delta : ""
      }
      return
    }

    if (method === "turn/completed") {
      if (params.threadId !== this.activeTurn.threadId) return

      const turn = params.turn as Record<string, unknown> | undefined
      const turnId = typeof turn?.id === "string" ? turn.id : this.activeTurn.turnId
      const status = turn?.status
      const error = turn?.error as Record<string, unknown> | null | undefined
      const activeTurn = this.activeTurn
      this.activeTurn = null

      if (status === "failed" || status === "interrupted") {
        activeTurn.reject(new Error(typeof error?.message === "string" ? error.message : "Codex turn did not complete successfully"))
        return
      }

      activeTurn.resolve({
        threadId: activeTurn.threadId,
        turnId: turnId ?? "unknown",
        reply: activeTurn.reply.trim(),
      })
    }
  }

  private failAll(error: unknown): void {
    if (this.closed) return
    this.closed = true

    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()

    if (this.activeTurn) {
      this.activeTurn.reject(error)
      this.activeTurn = null
    }
  }
}

export async function runCodexTurn(params: RunCodexTurnParams): Promise<RunCodexTurnResult> {
  const client = new CodexAppServerClient(params.cwd)
  try {
    await client.start()
    return await client.runTurn(params)
  } finally {
    await client.close()
  }
}

/**
 * Long-lived wrapper around CodexAppServerClient.
 * Keeps one codex app-server process alive across turns.
 * Auto-restarts if the process dies between turns.
 */
export class PersistentCodexSession {
  private client: CodexAppServerClient | null = null
  private starting: Promise<void> | null = null

  constructor(private readonly cwd: string) {}

  async runTurn(params: RunCodexTurnParams): Promise<RunCodexTurnResult> {
    await this.ensureClient()
    try {
      return await this.client!.runTurn(params)
    } catch (error) {
      // If the turn failed because the process died, discard the client
      // so the next call creates a fresh one
      this.discardClient()
      throw error
    }
  }

  async close(): Promise<void> {
    this.starting = null
    if (this.client) {
      const c = this.client
      this.client = null
      await c.close()
    }
  }

  private async ensureClient(): Promise<void> {
    if (this.client) return
    if (this.starting) {
      await this.starting
      return
    }
    this.starting = this.createClient()
    await this.starting
    this.starting = null
  }

  private async createClient(): Promise<void> {
    const client = new CodexAppServerClient(this.cwd)
    await client.start()
    this.client = client

    // If the process dies unexpectedly between turns, discard the client
    client.onExit(() => {
      if (this.client === client) {
        this.client = null
      }
    })
  }

  private discardClient(): void {
    if (this.client) {
      const c = this.client
      this.client = null
      c.close().catch(() => {})
    }
  }
}
