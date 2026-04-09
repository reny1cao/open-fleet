import { writeFileSync, renameSync, mkdirSync } from "fs"
import { dirname } from "path"

/**
 * Atomic file write using temp file + rename pattern.
 * Prevents data corruption if the process crashes mid-write.
 *
 * Pattern from Hermes agent: temp file → fsync → atomic rename.
 * The rename operation is atomic on POSIX filesystems.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp.${Date.now()}`
  writeFileSync(tmpPath, data, "utf8")
  renameSync(tmpPath, filePath)
}

/**
 * Atomic JSON write — serializes object and writes atomically.
 */
export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  atomicWriteFileSync(filePath, JSON.stringify(data, null, 2) + "\n")
}
