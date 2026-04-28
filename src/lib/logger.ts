import { persistDebugLog, type DebugLogEntry } from '@/lib/debug-log'

type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, data: Record<string, unknown>) {
  const entry: DebugLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    pid: process.pid,
    ...data,
  }

  void persistDebugLog(entry).catch(() => {})

  if (level === 'error') {
    console.error(JSON.stringify(entry))
  } else {
    console.log(JSON.stringify(entry))
  }
}

export const logger = {
  info: (data: Record<string, unknown>) => log('info', data),
  warn: (data: Record<string, unknown>) => log('warn', data),
  error: (data: Record<string, unknown>) => log('error', data),
}
