'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Chain } from '@/types/chain'

export default function NewRunPage() {
  const router = useRouter()
  const [chains, setChains] = useState<Chain[]>([])
  const [chainId, setChainId] = useState('')
  const [idea, setIdea] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/chains')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          setChains(json.data)
          if (json.data.length > 0) setChainId(json.data[0].id)
        }
      })
  }, [])

  async function handleLaunch() {
    if (!chainId || !idea.trim()) return
    setLaunching(true)
    setError('')

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId, idea: idea.trim() }),
    })
    const json = await res.json()

    if (json.error) {
      setError(json.error.message)
      setLaunching(false)
      return
    }

    router.push(`/runs/${json.data.id}`)
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold">Nouveau run</h1>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <Label htmlFor="chain">Chaîne</Label>
          <select
            id="chain"
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            {chains.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="idea">Idée</Label>
          <Input
            id="idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="La polémique Mbappé expliquée en 90 secondes"
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button onClick={handleLaunch} disabled={launching || !chainId || !idea.trim()}>
          {launching ? 'Lancement...' : 'Lancer'}
        </Button>
      </div>
    </div>
  )
}
