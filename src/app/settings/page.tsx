'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const CONFIG_KEYS = [
  { key: 'cost_alert_per_run', label: 'Seuil d\'alerte par run (€)', defaultValue: '8' },
  { key: 'cost_monthly_cap', label: 'Plafond mensuel global (€)', defaultValue: '200' },
  { key: 'cost_per_chain_cap', label: 'Plafond par chaîne (€)', defaultValue: '50' },
  { key: 'max_regen_per_run', label: 'Re-générations max par run', defaultValue: '5' },
]

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          const map: Record<string, string> = {}
          for (const item of json.data) {
            map[item.key] = item.value
          }
          // Remplir les valeurs par défaut si absentes
          for (const cfg of CONFIG_KEYS) {
            if (!map[cfg.key]) map[cfg.key] = cfg.defaultValue
          }
          setValues(map)
        }
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage('')

    for (const cfg of CONFIG_KEYS) {
      const value = values[cfg.key]
      if (value !== undefined) {
        await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: cfg.key, value }),
        })
      }
    }

    setSaving(false)
    setMessage('Réglages sauvegardés')
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold">Réglages</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Limites de coûts et seuils d&apos;alerte.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {CONFIG_KEYS.map((cfg) => (
          <div key={cfg.key}>
            <Label htmlFor={cfg.key}>{cfg.label}</Label>
            <Input
              id={cfg.key}
              type="number"
              value={values[cfg.key] ?? cfg.defaultValue}
              onChange={(e) => setValues({ ...values, [cfg.key]: e.target.value })}
            />
          </div>
        ))}

        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </Button>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  )
}
