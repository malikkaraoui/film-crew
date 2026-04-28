'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandKitForm } from '@/components/brand-kit/brand-kit-form'
import type { Chain } from '@/types/chain'
import type { Run } from '@/types/run'
import { getCurrentProject, getProjectStatusClass, getProjectStatusLabel, getRunLandingHref, getRunStepLabel } from '@/lib/runs/presentation'

type PublicationAccount = {
  id: string
  chainId: string
  platform: string
  isActive: number
  createdAt: string | null
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X (Twitter)',
}

const ALLOWED_PLATFORMS = ['tiktok', 'youtube', 'instagram', 'facebook', 'x']

export default function ChainDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [chain, setChain] = useState<Chain | null>(null)
  const [name, setName] = useState('')
  const [langSource, setLangSource] = useState('')
  const [audience, setAudience] = useState('')
  const [saving, setSaving] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [publicationAccounts, setPublicationAccounts] = useState<PublicationAccount[]>([])
  const [addingPlatform, setAddingPlatform] = useState('tiktok')
  const [addingAccount, setAddingAccount] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    void loadChain()
    void loadRuns()
    void loadPublicationAccounts()
  }, [id])

  async function loadChain() {
    const res = await fetch(`/api/chains/${id}`)
    const json = await res.json()
    if (json.data) {
      setChain(json.data)
      setName(json.data.name)
      setLangSource(json.data.langSource)
      setAudience(json.data.audience || '')
    }
  }

  async function loadRuns() {
    const res = await fetch('/api/runs')
    const json = await res.json()
    if (json.data) {
      setRuns((json.data as Run[]).filter((run) => run.chainId === id))
    }
  }

  async function loadPublicationAccounts() {
    const res = await fetch(`/api/chains/${id}/publication-accounts`)
    const json = await res.json()
    if (json.data) setPublicationAccounts(json.data)
  }

  async function handleAddAccount() {
    setActionError('')
    setAddingAccount(true)
    const res = await fetch(`/api/chains/${id}/publication-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: addingPlatform }),
    })
    const json = await res.json()
    if (json.data) setPublicationAccounts((prev) => [...prev, json.data])
    setAddingAccount(false)
  }

  async function handleDeleteAccount(accountId: string) {
    setActionError('')
    await fetch(`/api/chains/${id}/publication-accounts/${accountId}`, { method: 'DELETE' })
    setPublicationAccounts((prev) => prev.filter((a) => a.id !== accountId))
  }

  async function handleSave() {
    setActionError('')
    setSaving(true)
    await fetch(`/api/chains/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, langSource, audience }),
    })
    setSaving(false)
    await loadChain()
  }

  async function handleDuplicate() {
    setActionError('')
    const res = await fetch(`/api/chains/${id}/duplicate`, { method: 'POST' })
    const json = await res.json()
    if (json.data) {
      router.push(`/chains/${json.data.id}`)
    }
  }

  async function handleArchive() {
    if (!confirm('Archiver cette chaîne ? Tu pourras la restaurer depuis la vue Archivées.')) return
    setArchiving(true)
    setActionError('')

    try {
      const res = await fetch(`/api/chains/${id}`, { method: 'DELETE' })
      const json = await res.json()

      if (!res.ok) {
        setActionError(json.error?.message ?? 'Archivage impossible')
        return
      }

      router.push('/chains')
      router.refresh()
    } catch (error) {
      setActionError((error as Error).message)
    } finally {
      setArchiving(false)
    }
  }

  const currentProject = useMemo(() => getCurrentProject(runs), [runs])
  const history = useMemo(
    () => (currentProject ? runs.filter((run) => run.id !== currentProject.id) : runs),
    [runs, currentProject],
  )

  if (!chain) return <p className="text-sm text-muted-foreground">Chargement...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{chain.name}</h1>
          <p className="text-sm text-muted-foreground">
            {chain.langSource.toUpperCase()}
            {chain.audience ? ` · ${chain.audience}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/runs/new?chainId=${id}`}>
            <Button>Nouveau projet</Button>
          </Link>
          <Button
            variant={settingsOpen ? 'secondary' : 'outline'}
            size="icon-sm"
            onClick={() => setSettingsOpen((value) => !value)}
            aria-label="Réglages de la chaîne"
          >
            ⚙︎
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Projet courant</CardTitle>
            <CardDescription>
              Le projet actif est isolé ici. Tout le reste reste dans l’historique juste en dessous.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentProject ? (
              <Link href={getRunLandingHref(currentProject)} className="block rounded-lg border p-4 transition hover:bg-accent/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{currentProject.idea}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{getRunStepLabel(currentProject)}</div>
                  </div>
                  <div className={`shrink-0 text-right text-xs font-medium ${getProjectStatusClass(currentProject.status)}`}>
                    {getProjectStatusLabel(currentProject)}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>Coût : {(currentProject.costEur ?? 0).toFixed(2)} €</span>
                  <span>
                    Créé le {currentProject.createdAt ? new Date(currentProject.createdAt).toLocaleDateString('fr-FR') : '-'}
                  </span>
                </div>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Aucun projet en cours sur cette chaîne. Tu peux lancer un nouveau projet quand tu veux.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vue rapide</CardTitle>
            <CardDescription>Résumé utile avant d’entrer dans un projet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">Total projets</span>
              <span className="font-medium">{runs.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">Projets ouverts</span>
              <span className="font-medium">{runs.filter((run) => ['pending', 'running', 'paused', 'failed'].includes(run.status)).length}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">Projets terminés</span>
              <span className="font-medium">{runs.filter((run) => run.status === 'completed').length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {settingsOpen && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle>Réglages de la chaîne</CardTitle>
            <CardDescription>
              Nom, audience, Brand Kit, comptes de publication et actions sensibles restent derrière la roue crantée.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <Label htmlFor="name">Nom</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lang">Langue source</Label>
                <Input id="lang" value={langSource} onChange={(e) => setLangSource(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="audience">Audience cible</Label>
                <Input id="audience" value={audience} onChange={(e) => setAudience(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              <Button variant="outline" onClick={handleDuplicate}>
                Dupliquer
              </Button>
              <Button variant="outline" onClick={handleArchive} disabled={archiving}>
                {archiving ? 'Archivage...' : 'Archiver la chaîne'}
              </Button>
            </div>

            {actionError && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {actionError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">Brand Kit</h2>
                <p className="text-sm text-muted-foreground">
                  Réglages de style de la chaîne, séparés du flux projet.
                </p>
              </div>
              <BrandKitForm chainId={id} />
            </div>

            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">Publication</h2>
                <p className="text-sm text-muted-foreground">
                  Les credentials restent côté environnement ; ici tu gères seulement les rattachements.
                </p>
              </div>

              {publicationAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun compte de publication lié à cette chaîne.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {publicationAccounts.map((account) => (
                    <div key={account.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span className="font-medium">{PLATFORM_LABELS[account.platform] ?? account.platform}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-destructive"
                        onClick={() => handleDeleteAccount(account.id)}
                      >
                        Retirer
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={addingPlatform}
                  onChange={(e) => setAddingPlatform(e.target.value)}
                  className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                >
                  {ALLOWED_PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={handleAddAccount} disabled={addingAccount}>
                  {addingAccount ? 'Ajout...' : 'Lier ce compte'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Historique des projets</CardTitle>
            <CardDescription>
              Les anciens projets restent ici. Le projet courant reste mis en avant tout en haut.
            </CardDescription>
          </div>
          <Badge variant="outline">{history.length} entrée(s)</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pas d’historique supplémentaire pour l’instant.</p>
          ) : (
            history.map((project) => (
              <Link
                key={project.id}
                href={getRunLandingHref(project)}
                className="flex items-center justify-between rounded-lg border px-3 py-3 text-sm transition hover:bg-accent/20"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{project.idea}</div>
                  <div className="text-xs text-muted-foreground">{getRunStepLabel(project)}</div>
                </div>
                <div className="ml-3 flex shrink-0 flex-wrap items-center gap-3 text-xs">
                  <span className={`font-medium ${getProjectStatusClass(project.status)}`}>
                    {getProjectStatusLabel(project)}
                  </span>
                  <span className="font-mono text-muted-foreground">{(project.costEur ?? 0).toFixed(2)} €</span>
                  <span className="text-muted-foreground">
                    {project.createdAt ? new Date(project.createdAt).toLocaleDateString('fr-FR') : '-'}
                  </span>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
