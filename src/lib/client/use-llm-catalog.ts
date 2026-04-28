'use client'

import { useCallback, useEffect, useState } from 'react'
import type { LlmMode } from '@/types/run'
import {
  EMPTY_LLM_CATALOG,
  mergeLlmCatalog,
  type LlmCatalog,
  type LlmCatalogProvider,
} from '@/lib/llm/catalog'

export function useLlmCatalog(activeMode?: LlmMode | null) {
  const [catalog, setCatalog] = useState<LlmCatalog>(EMPTY_LLM_CATALOG)
  const [refreshingProvider, setRefreshingProvider] = useState<LlmCatalogProvider | null>(null)

  const refreshCatalog = useCallback(async (provider: LlmCatalogProvider = 'all', force = false) => {
    setRefreshingProvider(provider)

    try {
      const params = new URLSearchParams()
      if (provider !== 'all') params.set('provider', provider)
      if (force) params.set('force', '1')

      const query = params.toString()
      const res = await fetch(`/api/llm/models${query ? `?${query}` : ''}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.data) {
        setCatalog((current) => mergeLlmCatalog(current, json.data as Partial<LlmCatalog>))
      }
    } catch {
      setCatalog((current) => mergeLlmCatalog(current, {
        localError: provider === 'local' || provider === 'all'
          ? 'Catalogue LLM indisponible'
          : current.localError,
        openRouterError: provider === 'openrouter' || provider === 'all'
          ? 'Catalogue OpenRouter indisponible'
          : current.openRouterError,
      }))
    } finally {
      setRefreshingProvider(null)
    }
  }, [])

  useEffect(() => {
    void refreshCatalog('all')
  }, [refreshCatalog])

  useEffect(() => {
    if (activeMode !== 'local' && activeMode !== 'openrouter') return
    void refreshCatalog(activeMode)
  }, [activeMode, refreshCatalog])

  useEffect(() => {
    if (activeMode !== 'local') return

    const interval = window.setInterval(() => {
      void refreshCatalog('local')
    }, 15000)

    return () => window.clearInterval(interval)
  }, [activeMode, refreshCatalog])

  return {
    catalog,
    refreshCatalog,
    refreshingProvider,
  }
}