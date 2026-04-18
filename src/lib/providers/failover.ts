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
 * Exécute une opération sur un provider avec failover automatique.
 * Si le provider principal échoue, bascule sur le suivant et loggue l'événement.
 */
export async function executeWithFailover<T>(
  type: string,
  operation: (provider: BaseProvider) => Promise<T>,
  runId?: string,
): Promise<{ result: T; provider: BaseProvider; failover?: FailoverEvent }> {
  const primary = await registry.getBest(type)
  if (!primary) {
    throw new Error(`Aucun provider disponible pour le type "${type}"`)
  }

  try {
    const result = await operation(primary)
    return { result, provider: primary }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    logger.warn({
      event: 'provider_failover_triggered',
      provider: primary.name,
      type,
      reason,
    })

    // Log l'échec du provider principal
    await createProviderLog({
      id: crypto.randomUUID(),
      runId,
      provider: primary.name,
      endpoint: `${type}/execute`,
      responseStatus: 500,
      responseData: { error: reason },
      latencyMs: 0,
      costEur: 0,
    }).catch(() => {}) // silencieux si DB down

    // Tenter le fallback
    const fallback = await registry.getFallback(type, primary.name)
    if (!fallback) {
      throw new Error(
        `Provider "${primary.name}" en échec et aucun fallback disponible pour "${type}": ${reason}`,
      )
    }

    const failoverEvent: FailoverEvent = {
      original: primary.name,
      fallback: fallback.name,
      type,
      reason,
      timestamp: new Date().toISOString(),
    }

    // Enregistrer l'événement
    recentFailovers.unshift(failoverEvent)
    if (recentFailovers.length > MAX_FAILOVER_HISTORY) {
      recentFailovers.pop()
    }

    logger.info({
      event: 'provider_failover_success',
      original: primary.name,
      fallback: fallback.name,
      type,
    })

    // Log le failover dans provider_log
    await createProviderLog({
      id: crypto.randomUUID(),
      runId,
      provider: fallback.name,
      endpoint: `${type}/failover`,
      requestData: { failedProvider: primary.name, reason },
      responseStatus: 200,
      costEur: 0,
    }).catch(() => {})

    const result = await operation(fallback)
    return { result, provider: fallback, failover: failoverEvent }
  }
}
