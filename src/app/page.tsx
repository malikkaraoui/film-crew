'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { Chain } from '@/types/chain'

export default function Dashboard() {
  const [chains, setChains] = useState<Chain[]>([])

  useEffect(() => {
    fetch('/api/chains')
      .then((r) => r.json())
      .then((json) => { if (json.data) setChains(json.data) })
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tableau de bord</h1>
        <Link href="/chains">
          <Button>Nouvelle chaîne</Button>
        </Link>
      </div>

      {chains.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aucune chaîne. Créez-en une pour commencer.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {chains.map((c) => (
            <Link key={c.id} href={`/chains/${c.id}`}>
              <Card className="cursor-pointer transition-colors hover:bg-accent/50">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {c.langSource.toUpperCase()} {c.audience && `· ${c.audience}`}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold">Derniers runs</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Aucun run pour le moment. Lancez votre première production depuis une chaîne.
        </p>
      </div>
    </div>
  )
}
