'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const LANGUAGES = [
  { code: 'fr', label: 'Français', flag: 'FR' },
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'de', label: 'Deutsch', flag: 'DE' },
  { code: 'pt', label: 'Português', flag: 'PT' },
  { code: 'es', label: 'Español', flag: 'ES' },
  { code: 'it', label: 'Italiano', flag: 'IT' },
]

const COST_PER_LANG = 0.18

export default function LocalizePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<{ lang: string; status: string; costEur: number }[] | null>(null)

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function handleLaunch() {
    if (selected.size === 0) return
    setRunning(true)
    setResults(null)

    const res = await fetch(`/api/runs/${id}/localize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ languages: [...selected] }),
    })
    const json = await res.json()
    if (json.data) setResults(json.data.results)
    setRunning(false)
  }

  const estimatedCost = selected.size * COST_PER_LANG

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Localisation</h1>

      <div className="grid grid-cols-2 gap-2">
        {LANGUAGES.map((lang) => {
          const isSelected = selected.has(lang.code)
          return (
            <button
              key={lang.code}
              onClick={() => toggle(lang.code)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{lang.flag} {lang.label}</span>
                {isSelected && <Badge variant="default" className="text-[10px]">Sélectionné</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">~{COST_PER_LANG.toFixed(2)} €</span>
            </button>
          )
        })}
      </div>

      {selected.size > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {selected.size} langue{selected.size > 1 ? 's' : ''} — {estimatedCost.toFixed(2)} € estimé
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      <Button onClick={handleLaunch} disabled={running || selected.size === 0}>
        {running ? 'Localisation en cours...' : `Lancer (${selected.size} langue${selected.size > 1 ? 's' : ''})`}
      </Button>

      {results && (
        <div className="space-y-1">
          {results.map((r) => (
            <div key={r.lang} className="flex items-center justify-between text-sm">
              <span>{LANGUAGES.find((l) => l.code === r.lang)?.label ?? r.lang}</span>
              <Badge variant={r.status === 'completed' ? 'default' : 'destructive'}>
                {r.status === 'completed' ? 'OK' : 'Échec'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
