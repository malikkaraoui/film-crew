import { mkdir, open, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'

const STALE_LOCK_MS = 30 * 60_000

type MeetingLockPayload = {
  runId: string
  createdAt: string
  pid: number
}

export class MeetingLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeetingLockError'
  }
}

function getMeetingLockPath(storagePath: string): string {
  return join(storagePath, 'meeting.lock')
}

async function readLockPayload(lockPath: string): Promise<MeetingLockPayload | null> {
  try {
    return JSON.parse(await readFile(lockPath, 'utf-8')) as MeetingLockPayload
  } catch {
    return null
  }
}

export async function acquireMeetingLock(runId: string, storagePath: string): Promise<() => Promise<void>> {
  await mkdir(storagePath, { recursive: true })
  const lockPath = getMeetingLockPath(storagePath)
  const payload: MeetingLockPayload = {
    runId,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  }

  try {
    const handle = await open(lockPath, 'wx')
    await handle.writeFile(JSON.stringify(payload, null, 2))
    await handle.close()
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== 'EEXIST') throw error

    try {
      const info = await stat(lockPath)
      const ageMs = Date.now() - info.mtimeMs
      if (ageMs > STALE_LOCK_MS) {
        await rm(lockPath, { force: true })
        return acquireMeetingLock(runId, storagePath)
      }
    } catch {
      // Si le lock disparaît entre temps, on retente normalement.
      return acquireMeetingLock(runId, storagePath)
    }

    const existing = await readLockPayload(lockPath)
    const startedAt = existing?.createdAt ? new Date(existing.createdAt).toLocaleTimeString('fr-FR') : 'inconnue'
    throw new MeetingLockError(`Une réunion est déjà en cours pour ce projet (lock depuis ${startedAt}).`)
  }

  return async () => {
    await rm(lockPath, { force: true })
  }
}
