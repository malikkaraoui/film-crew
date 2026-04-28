import { appendFile, mkdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'

export type DebugLogLevel = 'info' | 'warn' | 'error'

export type DebugLogEntry = {
  timestamp: string
  level: DebugLogLevel
  pid: number
  runId?: string
  [key: string]: unknown
}

const GLOBAL_DEBUG_LOG_DIR = join(process.cwd(), 'storage', 'system')
const GLOBAL_DEBUG_LOG_PATH = join(GLOBAL_DEBUG_LOG_DIR, 'app-log.jsonl')

function getRunDebugLogPath(runId: string) {
  return join(process.cwd(), 'storage', 'runs', runId, 'debug-log.jsonl')
}

function safeStringify(entry: DebugLogEntry): string {
  const seen = new WeakSet<object>()

  return JSON.stringify(entry, (_key, value) => {
    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }

    return value
  })
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${line}\n`, 'utf-8')
}

export async function persistDebugLog(entry: DebugLogEntry): Promise<void> {
  const line = safeStringify(entry)

  await appendLine(GLOBAL_DEBUG_LOG_PATH, line)

  if (typeof entry.runId === 'string' && entry.runId.trim().length > 0) {
    await appendLine(getRunDebugLogPath(entry.runId), line)
  }
}

export async function readRunDebugLog(runId: string, limit = 300): Promise<DebugLogEntry[]> {
  try {
    const raw = await readFile(getRunDebugLogPath(runId), 'utf-8')
    const entries = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DebugLogEntry)

    if (limit <= 0) {
      return entries
    }

    return entries.slice(-limit)
  } catch {
    return []
  }
}

export function getRunDebugLogFilePath(runId: string): string {
  return getRunDebugLogPath(runId)
}

export function getGlobalDebugLogFilePath(): string {
  return GLOBAL_DEBUG_LOG_PATH
}