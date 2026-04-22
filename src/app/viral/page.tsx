'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ViralSessionStatus } from '@/lib/viral/viral-types'

type Segment = {
  index: number
  start_s: number
  end_s: number
  title: string
  reason: string
  excerpt: string
}

export default function ViralPage() {
  const [url, setUrl] = useState('')
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [viralId, setViralId] = useState<string | null>(null)
  const [status, setStatus] = useState<ViralSessionStatus | null>(null)

  useEffect(() => {
    if (!viralId) return

    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/viral/${viralId}`, { cache: 'no-store' })
        const json = await res.json()
        if (cancelled || !json.data) return

        if (json.data.status) {
          setStatus(json.data.status)
          if (json.data.status.state === 'error' && json.data.status.error) {
            setError(json.data.status.error)
          }
        }

        if (Array.isArray(json.data.segments)) {
          setSegments(json.data.segments)
        }

        const state = json.data.status?.state
        if (state === 'completed' || state === 'error') {
          setRunning(false)
          return
        }

        window.setTimeout(poll, 1500)
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setRunning(false)
        }
      }
    }

    void poll()
    return () => { cancelled = true }
  }, [viralId])

  async function handleLaunch() {
    if (!url.trim()) return
    setRunning(true)
    setError('')
    setSegments([])
    setViralId(null)
    setStatus(null)

    try {
      const res = await fetch('/api/viral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), instruction: instruction.trim() || undefined }),
      })
      const json = await res.json()
      if (json.error) {
        setError(json.error.message)
        setRunning(false)
      } else if (json.data) {
        setViralId(json.data.id)
        setStatus({
          id: json.data.id,
          url: json.data.url,
          state: json.data.status,
          currentStep: 'queued',
          message: json.data.message,
          logs: [],
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
    } catch (e) {
      setError((e as Error).message)
      setRunning(false)
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const statusTone = status?.state === 'error'
    ? 'destructive'
    : status?.state === 'completed'
      ? 'default'
      : 'secondary'

  const isRunning = status?.state === 'running'
  const activeLogIndex = isRunning && status?.logs?.length ? status.logs.length - 1 : -1

  function getStepLabel(step: string): string {
    switch (step) {
      case 'queued':
        return 'file d’attente'
      case 'downloading':
        return 'téléchargement'
      case 'transcribing':
        return 'transcription'
      case 'analyzing':
        return 'analyse'
      case 'completed':
        return 'terminé'
      case 'error':
        return 'erreur'
      default:
        return step
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Découpage viral</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Collez une URL YouTube pour extraire des shorts viraux.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Ici, pas de boîte noire : on affiche chaque étape, le lieu d’exécution, et le provider réellement utilisé.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <Label htmlFor="url">URL YouTube</Label>
          <Input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </div>

        <div>
          <Label htmlFor="instruction">Consigne (optionnel)</Label>
          <Input
            id="instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Focus sur les clashs, les moments drôles..."
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button onClick={handleLaunch} disabled={running || !url.trim()}>
          {running ? 'Analyse en cours...' : 'Lancer'}
        </Button>
      </div>

      {(status || viralId) && (
        <Card className={`relative overflow-hidden ${isRunning ? 'border-lime-400/60 shadow-[0_0_0_1px_rgba(163,230,53,0.25),0_0_24px_rgba(132,204,22,0.18)]' : ''}`}>
          {isRunning && (
            <>
              <div className="pointer-events-none absolute inset-0 rounded-lg bg-[radial-gradient(circle_at_top,rgba(132,204,22,0.10),transparent_55%)]" />
              <div className="viral-electric-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3" />
            </>
          )}
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Suivi d’analyse</CardTitle>
                <CardDescription>
                  {status?.message ?? 'Initialisation du suivi...'}
                </CardDescription>
              </div>
              {status && <Badge variant={statusTone}>{status.state === 'running' ? 'en cours' : status.state}</Badge>}
            </div>

            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <span className="font-medium text-foreground">Session :</span>{' '}
                {viralId}
              </div>
              <div>
                <span className="font-medium text-foreground">Étape :</span>{' '}
                {status?.currentStep ?? 'queued'}
              </div>
              <div>
                <span className="font-medium text-foreground">Provider LLM :</span>{' '}
                {status?.providerUsed ?? 'pas encore déterminé'}
              </div>
              <div>
                <span className="font-medium text-foreground">Exécution :</span>{' '}
                {status?.providerMode === 'local'
                  ? 'analyse LLM en local'
                  : status?.providerMode === 'external'
                    ? 'analyse LLM via service externe'
                    : 'téléchargement/transcription en local sur cette machine'}
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div><span className="font-medium text-foreground">Téléchargement YouTube :</span> local via `yt-dlp`</div>
              <div><span className="font-medium text-foreground">Transcription actuelle :</span> placeholder local</div>
              <div><span className="font-medium text-foreground">Analyse segments :</span> {status?.providerUsed === 'ollama' ? 'locale via Ollama/Mistral sur ta machine' : 'provider affiché ci-dessus'}</div>
            </div>

            {status?.failover && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                Failover détecté : {status.failover.original} → {status.failover.fallback} ({status.failover.reason})
              </div>
            )}

            {status?.logs?.length ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Journal d’exécution</div>
                <div className="space-y-2">
                  {status.logs.map((entry, idx) => (
                    <div
                      key={`${entry.at}-${idx}`}
                      className={`relative overflow-hidden rounded-md border px-3 py-2 text-xs transition-all ${idx === activeLogIndex ? 'border-lime-400/60 bg-lime-500/5 shadow-[0_0_0_1px_rgba(163,230,53,0.18),0_0_18px_rgba(132,204,22,0.12)]' : 'bg-background/40'}`}
                    >
                      {idx === activeLogIndex && (
                        <>
                          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(163,230,53,0.10),transparent_60%)]" />
                          <div className="viral-electric-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3" />
                        </>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{entry.message}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={idx === activeLogIndex ? 'default' : 'outline'}>
                            {idx === activeLogIndex ? 'en cours' : status?.state === 'error' && idx === status.logs.length - 1 ? 'erreur' : 'terminé'}
                          </Badge>
                          <Badge variant="outline">{entry.scope}</Badge>
                        </div>
                      </div>
                      <div className="mt-1 text-muted-foreground">{getStepLabel(entry.step)} — {new Date(entry.at).toLocaleTimeString('fr-FR')}</div>
                      {entry.details && <div className="mt-1 text-muted-foreground">{entry.details}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardHeader>
        </Card>
      )}

      {/* Résultats */}
      {segments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            {segments.length} segment{segments.length > 1 ? 's' : ''} détecté{segments.length > 1 ? 's' : ''}
          </h2>

          {segments.map((seg) => (
            <Card key={seg.index}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{seg.title}</CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {formatTime(seg.start_s)} → {formatTime(seg.end_s)}
                    {' '}({seg.end_s - seg.start_s}s)
                  </Badge>
                </div>
                <CardDescription className="text-xs">{seg.reason}</CardDescription>
                {seg.excerpt && (
                  <p className="text-xs text-muted-foreground italic mt-1">
                    &laquo; {seg.excerpt} &raquo;
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" className="text-xs">
                    Recadrer 9:16
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs">
                    Ajouter sous-titres
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <style jsx>{`
        .viral-electric-sweep {
          background: linear-gradient(90deg, transparent 0%, rgba(163,230,53,0.00) 8%, rgba(163,230,53,0.18) 30%, rgba(187,247,208,0.95) 48%, rgba(163,230,53,0.20) 68%, rgba(163,230,53,0.00) 92%, transparent 100%);
          filter: blur(10px);
          animation: viral-electric-sweep 1.8s linear infinite;
        }

        @keyframes viral-electric-sweep {
          0% {
            transform: translateX(0%);
            opacity: 0;
          }
          12% {
            opacity: 1;
          }
          100% {
            transform: translateX(420%);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  )
}
