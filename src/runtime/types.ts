export interface StartOpts {
  session: string
  env: Record<string, string>
  workDir: string
  command: string
}

export interface RuntimeAdapter {
  start(opts: StartOpts): Promise<void>
  stop(session: string): Promise<void>
  isRunning(session: string): Promise<boolean>
  sendKeys(session: string, text: string): Promise<void>
  captureOutput(session: string, lines?: number): Promise<string>
  waitFor(session: string, pattern: RegExp, timeoutMs?: number): Promise<boolean>
}
