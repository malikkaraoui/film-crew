import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ViralSessionStatus, ViralSessionStep, ViralExecutionScope } from './viral-types'

function getViralDir(id: string): string {
  return join(process.cwd(), 'storage', 'viral', id)
}

function getStatusPath(id: string): string {
  return join(getViralDir(id), 'status.json')
}

export async function createViralStatus(id: string, url: string): Promise<ViralSessionStatus> {
  const now = new Date().toISOString()
  const status: ViralSessionStatus = {
    id,
    url,
    state: 'queued',
    currentStep: 'queued',
    message: 'Session créée — en attente de traitement',
    logs: [
      {
        at: now,
        step: 'queued',
        scope: 'local',
        message: 'Session virale créée sur cette machine',
      },
    ],
    startedAt: now,
    updatedAt: now,
  }
  await persistViralStatus(status)
  return status
}

export async function readViralStatus(id: string): Promise<ViralSessionStatus | null> {
  try {
    return JSON.parse(await readFile(getStatusPath(id), 'utf-8')) as ViralSessionStatus
  } catch {
    return null
  }
}

export async function persistViralStatus(status: ViralSessionStatus): Promise<void> {
  await mkdir(getViralDir(status.id), { recursive: true })
  await writeFile(getStatusPath(status.id), JSON.stringify(status, null, 2))
}

export async function updateViralStatus(
  id: string,
  input: {
    state?: ViralSessionStatus['state']
    currentStep: ViralSessionStep
    message: string
    scope: ViralExecutionScope
    details?: string
    providerUsed?: string
    providerMode?: ViralExecutionScope
    error?: string
    failover?: ViralSessionStatus['failover']
    completedAt?: string
  },
): Promise<ViralSessionStatus> {
  const previous = await readViralStatus(id)
  const now = new Date().toISOString()

  const status: ViralSessionStatus = {
    id,
    url: previous?.url ?? '',
    state: input.state ?? previous?.state ?? 'running',
    currentStep: input.currentStep,
    message: input.message,
    logs: [
      ...(previous?.logs ?? []),
      {
        at: now,
        step: input.currentStep,
        scope: input.scope,
        message: input.message,
        details: input.details,
      },
    ],
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    providerUsed: input.providerUsed ?? previous?.providerUsed,
    providerMode: input.providerMode ?? previous?.providerMode,
    failover: input.failover ?? previous?.failover,
    completedAt: input.completedAt ?? previous?.completedAt,
    error: input.error ?? previous?.error,
  }

  await persistViralStatus(status)
  return status
}