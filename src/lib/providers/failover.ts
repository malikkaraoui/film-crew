import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { registry } from './registry'
import { bootstrapProviders } from './bootstrap'
import { createProviderLog } from '@/lib/db/queries/logs'
import { logger } from '@/lib/logger'
import type { BaseProvider } from './types'

// Garantit que les providers sont enregistrés avant toute utilisation
bootstrapProviders()

export type FailoverEvent = {
  original: string
  fallback: string
  type: string
  reason: string
  timestamp: string
}

export type RegenerationAttempt = {
  type: 'storyboard' | 'video' | 'audio'
  sceneIndex?: number
  providerUsed: string
  failoverOccurred: boolean
  failoverChain?: { original: string; fallback: string; reason: string }
  success: boolean
  artefactPath?: string | null
  error?: string
  timestamp: string
}

/**
 * Erreur levée quand executeWithFailover a épuisé tous les providers.
 * Expose le dernier provider tenté et si un failover a eu lieu,
 * pour que l'appelant puisse retourner une réponse honnête (non "none").
 */
export class FailoverError extends Error {
  constructor(
    message: string,
    public readonly providerUsed: string,
    public readonly failoverOccurred: boolean,
    public readonly failoverChain?: { original: string; fallback: string; reason: string },
  ) {
    super(message)
    this.name = 'FailoverError'
  }
}

// In-memory buffer des derniers failovers (consultable via API)
const recentFailovers: FailoverEvent[] = []
const MAX_FAILOVER_HISTORY = 50

export function getRecentFailovers(): FailoverEvent[] {
  return [...recentFailovers]
}

export function clearDismissedFailovers(): void {
  recentFailovers.length = 0
}

/**
 * Persiste un événement de failover dans storage/runs/{runId}/failover-log.json.
 * Non bloquant — les erreurs d'I/O sont silencieuses.
 */
async function persistFailoverEvent(runId: string, event: FailoverEvent): Promise<void> {
  try {
    const storagePath = join(process.cwd(), 'storage', 'runs', runId)
    const logPath = join(storagePath, 'failover-log.json')

    let log: FailoverEvent[] = []
    try {
      log = JSON.parse(await readFile(logPath, 'utf-8'))
    } catch { /* fichier absent, on repart de zéro */ }

    log.unshift(event)
    await writeFile(logPath, JSON.stringify(log, null, 2))
  } catch { /* persistance non bloquante */ }
}

/**
 * Persiste une tentative de régénération dans storage/runs/{runId}/failover-log.json.
 */
export async function persistRegenerationAttempt(
  runId: string,
  attempt: RegenerationAttempt,
): Promise<void> {
  try {
    const storagePath = join(process.cwd(), 'storage', 'runs', runId)
    await mkdir(storagePath, { recursive: true })
    const logPath = join(storagePath, 'failover-log.json')

    let log: (FailoverEvent | RegenerationAttempt)[] = []
    try {
      log = JSON.parse(await readFile(logPath, 'utf-8'))
    } catch { /* fichier absent */ }

    log.unshift(attempt)
    await writeFile(logPath, JSON.stringify(log, null, 2))
  } catch { /* non bloquant */ }
}

/**
 * Lit le failover-log.json d'un run.
 */
export async function readFailoverLog(runId: string): Promise<(FailoverEvent | RegenerationAttempt)[]> {
  try {
    const logPath = join(process.cwd(), 'storage', 'runs', runId, 'failover-log.json')
    return JSON.parse(await readFile(logPath, 'utf-8'))
  } catch {
    return []
  }
}

/**
 * Exécute une opération sur un provider avec cascade de failover automatique.
 *
 * Comportement :
 * 1. Tente le provider principal (getBest).
 * 2. En cas d'échec, cascade vers le suivant sain (getFallbackExcluding).
 * 3. Chaque bascule est persistée dans failover-log.json (si runId fourni).
 * 4. Si tous les providers échouent, lève FailoverError avec :
 *    - providerUsed : dernier provider tenté (jamais 'none' si un a été tenté)
 *    - failoverOccurred : true si au moins une bascule a eu lieu
 *    - failoverChain : première bascule de la chaîne
 */
export async function executeWithFailover<T>(
  type: string,
  operation: (provider: BaseProvider) => Promise<T>,
  runId?: string,
): Promise<{ result: T; provider: BaseProvider; failover?: FailoverEvent }> {
  const primary = await registry.getBest(type)
  if (!primary) {
    throw new FailoverError(
      `Aucun provider disponible pour le type "${type}"`,
      'none',
      false,
    )
  }

  try {
    const result = await operation(primary)
    return { result, provider: primary }
  } catch (primaryError) {
    const primaryReason = primaryError instanceof Error ? primaryError.message : String(primaryError)

    logger.warn({
      event: 'provider_failover_triggered',
      provider: primary.name,
      type,
      reason: primaryReason,
    })

    await createProviderLog({
      id: crypto.randomUUID(),
      runId,
      provider: primary.name,
      endpoint: `${type}/execute`,
      responseStatus: 500,
      responseData: { error: primaryReason },
      latencyMs: 0,
      costEur: 0,
    }).catch(() => {})

    // Cascade : tente tous les fallbacks dans l'ordre jusqu'au succès
    const tried = new Set([primary.name])
    let lastErrorMsg = primaryReason
    let lastProvider: BaseProvider = primary
    let firstFailoverEvent: FailoverEvent | undefined

    while (true) {
      const next = await registry.getFallbackExcluding(type, tried)
      if (!next) {
        // Tous les providers épuisés — erreur honnête avec le vrai dernier provider tenté
        throw new FailoverError(
          tried.size > 1
            ? `Provider "${primary.name}" en échec, fallback "${lastProvider.name}" aussi en échec: ${lastErrorMsg}`
            : `Provider "${primary.name}" en échec et aucun fallback disponible pour "${type}": ${lastErrorMsg}`,
          lastProvider.name,
          tried.size > 1,
          firstFailoverEvent
            ? { original: firstFailoverEvent.original, fallback: firstFailoverEvent.fallback, reason: primaryReason }
            : undefined,
        )
      }

      const failoverEvent: FailoverEvent = {
        original: lastProvider.name,
        fallback: next.name,
        type,
        reason: lastErrorMsg,
        timestamp: new Date().toISOString(),
      }
      if (!firstFailoverEvent) firstFailoverEvent = failoverEvent

      // Enregistrer l'événement en mémoire
      recentFailovers.unshift(failoverEvent)
      if (recentFailovers.length > MAX_FAILOVER_HISTORY) {
        recentFailovers.pop()
      }

      // Persister sur disque si runId fourni (non bloquant)
      if (runId) {
        persistFailoverEvent(runId, failoverEvent).catch(() => {})
      }

      logger.info({
        event: 'provider_failover_attempt',
        original: lastProvider.name,
        fallback: next.name,
        type,
      })

      await createProviderLog({
        id: crypto.randomUUID(),
        runId,
        provider: next.name,
        endpoint: `${type}/failover`,
        requestData: { failedProvider: lastProvider.name, reason: lastErrorMsg },
        responseStatus: 200,
        costEur: 0,
      }).catch(() => {})

      tried.add(next.name)

      try {
        const result = await operation(next)
        logger.info({
          event: 'provider_failover_success',
          original: primary.name,
          fallback: next.name,
          type,
        })
        return { result, provider: next, failover: firstFailoverEvent }
      } catch (nextError) {
        lastErrorMsg = nextError instanceof Error ? nextError.message : String(nextError)
        lastProvider = next
      }
    }
  }
}
