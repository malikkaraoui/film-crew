'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { PublishManifest, PublishManifestEntry, PublishStatus } from '@/lib/publishers/platform-types'

/**
 * PublishPanel — Lot 13C
 *
 * Panneau de diffusion contextualisé pour preview/export d'un run.
 * Affiche les plateformes liées à la chaîne, leur statut réel (depuis publish-manifest),
 * et des actions de publication honnêtes selon les publishers réellement disponibles.
 */

// Mapping account DB platform → factory PublishPlatform
const ACCOUNT_TO_FACTORY: Record<string, string | null> = {
  tiktok: 'tiktok',
  youtube: 'youtube_shorts',
  instagram: null,  // pas de publisher réel dans cette version
  facebook: null,
  x: null,
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube Shorts',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X (Twitter)',
  youtube_shorts: 'YouTube Shorts',
}

const STATUS_LABELS: Record<PublishStatus, string> = {
  SUCCESS: 'Publié',
  PROCESSING: 'En cours',
  FAILED: 'Échec',
  NO_CREDENTIALS: 'Credentials manquants',
  NO_MEDIA: 'Pas de média',
}

const STATUS_BADGE_VARIANTS: Record<PublishStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  SUCCESS: 'default',
  PROCESSING: 'secondary',
  FAILED: 'destructive',
  NO_CREDENTIALS: 'outline',
  NO_MEDIA: 'destructive',
}

export type PublicationAccount = {
  id: string
  chainId: string
  platform: string
  isActive: number
}

export type PublishContext = {
  chainId: string | null
  chainName: string | null
  accounts: PublicationAccount[]
  manifest: PublishManifest | null
}

type Props = {
  runId: string
  context: PublishContext
  hasPlayable: boolean
  onPublish: (platform: string) => Promise<void>
  publishing: boolean
}

export function PublishPanel({ runId, context, hasPlayable, onPublish, publishing }: Props) {
  const [publishingPlatform, setPublishingPlatform] = useState<string | null>(null)

  const { chainId, chainName, accounts, manifest } = context

  async function handlePublish(platform: string) {
    setPublishingPlatform(platform)
    await onPublish(platform)
    setPublishingPlatform(null)
  }

  // Manifest par plateforme factory pour lookup rapide
  const manifestByPlatform: Record<string, PublishManifestEntry> = {}
  if (manifest) {
    for (const entry of manifest.platforms) {
      manifestByPlatform[entry.platform] = entry
    }
  }

  const activeAccounts = accounts.filter((a) => a.isActive === 1)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Diffusion
          {chainName && chainId && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              via{' '}
              <Link href={`/chains/${chainId}`} className="hover:underline">
                {chainName}
              </Link>
            </span>
          )}
          {!chainName && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              sans chaîne liée
            </span>
          )}
        </p>
      </div>

      {activeAccounts.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/20">
          <p className="text-amber-700 dark:text-amber-300">
            {chainId
              ? 'Aucun compte de publication lié à cette chaîne.'
              : 'Aucune chaîne liée à ce run viral. La diffusion restera indisponible tant qu’aucune chaîne n’est associée.'}
          </p>
          {chainId && (
            <Link href={`/chains/${chainId}`} className="mt-1 inline-block text-xs text-amber-600 underline underline-offset-2 hover:text-amber-800 dark:text-amber-400">
              Configurer la diffusion →
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {activeAccounts.map((account) => {
            const factoryPlatform = ACCOUNT_TO_FACTORY[account.platform]
            const entry = factoryPlatform ? manifestByPlatform[factoryPlatform] : null
            const label = PLATFORM_LABELS[account.platform] ?? account.platform
            const hasPublisher = factoryPlatform !== null

            return (
              <div key={account.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    {entry ? (
                      <Badge variant={STATUS_BADGE_VARIANTS[entry.status]}>
                        {STATUS_LABELS[entry.status]}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Non tenté</Badge>
                    )}
                  </div>

                  {hasPublisher && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={publishing || !hasPlayable || publishingPlatform !== null}
                      onClick={() => void handlePublish(factoryPlatform!)}
                    >
                      {publishingPlatform === factoryPlatform
                        ? 'Publication...'
                        : entry?.status === 'SUCCESS'
                        ? 'Re-publier'
                        : 'Publier'}
                    </Button>
                  )}
                </div>

                {/* Détails si tentative présente */}
                {entry && (
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {entry.shareUrl && (
                      <p>
                        Lien :{' '}
                        <a href={entry.shareUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
                          ouvrir
                        </a>
                      </p>
                    )}
                    {!entry.shareUrl && entry.profileUrl && (
                      <p>
                        Profil :{' '}
                        <a href={entry.profileUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
                          ouvrir
                        </a>
                      </p>
                    )}
                    {entry.error && (
                      <p className="text-destructive">Erreur : {entry.error}</p>
                    )}
                    {entry.publishedAt && (
                      <p>Publié : {new Date(entry.publishedAt).toLocaleString('fr-FR')}</p>
                    )}
                  </div>
                )}

                {/* Pas de publisher réel : honnête */}
                {!hasPublisher && (
                  <p className="text-xs text-muted-foreground">
                    Publication automatique sur {label} — pas encore de publisher dans cette version.
                  </p>
                )}

                {/* Pas de média : honnête */}
                {hasPublisher && !hasPlayable && (
                  <p className="text-xs text-muted-foreground">
                    Aucun fichier vidéo disponible — le pipeline doit atteindre le step 8 (Preview).
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
