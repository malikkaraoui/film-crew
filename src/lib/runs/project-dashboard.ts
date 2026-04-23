import type { RunStep } from '@/types/run'

export type DashboardCheckTone = 'pass' | 'warn' | 'fail' | 'info'

export type DashboardCheck = {
  label: string
  detail: string
  tone: DashboardCheckTone
}

export type DashboardContextItem = {
  label: string
  value: string
  tone?: DashboardCheckTone
}

export type DashboardContextSection = {
  title: string
  description?: string
  body?: string
  items?: DashboardContextItem[]
}

export type DashboardAgentTrace = {
  id?: string
  agentName: string
  messageType: string
  content: unknown
  createdAt?: string | Date | null
}

export type DashboardFailoverEntry = {
  timestamp?: string
  type?: string
  original?: string
  fallback?: string
  providerUsed?: string
  success?: boolean
  error?: string
  reason?: string
  failoverOccurred?: boolean
  failoverChain?: { original: string; fallback: string; reason: string }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function short(value: unknown, max = 140): string {
  const text = readText(value)
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function basename(value: unknown): string {
  const text = readText(value)
  if (!text) return '—'
  const parts = text.split('/')
  return parts[parts.length - 1] || text
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function parseDeliverableContent(content: string | null | undefined): Record<string, unknown> | null {
  if (!content?.trim()) return null
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractTraceText(content: unknown): string {
  const record = asRecord(content)
  if (!record) return short(stringifyUnknown(content), 180)
  const directText = readText(record.text)
  if (directText) return short(directText, 180)
  const nested = asRecord(record.content)
  const nestedText = readText(nested?.text)
  if (nestedText) return short(nestedText, 180)
  return short(stringifyUnknown(content), 180)
}

export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '—'

  const diffMs = Date.now() - timestamp
  const diffMinutes = Math.round(diffMs / 60_000)

  if (Math.abs(diffMinutes) < 1) return 'à l’instant'
  if (Math.abs(diffMinutes) < 60) return `il y a ${diffMinutes} min`

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return `il y a ${diffHours} h`

  const diffDays = Math.round(diffHours / 24)
  return `il y a ${diffDays} j`
}

export function formatStepDuration(step: Pick<RunStep, 'startedAt' | 'completedAt' | 'status'> | null | undefined): string {
  if (!step?.startedAt) return '—'
  const start = new Date(step.startedAt).getTime()
  if (!Number.isFinite(start)) return '—'

  const end = step.completedAt
    ? new Date(step.completedAt).getTime()
    : Date.now()

  if (!Number.isFinite(end) || end < start) return '—'

  const durationMs = end - start
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remSeconds = seconds % 60
  return remSeconds > 0 ? `${minutes}m ${remSeconds}s` : `${minutes}m`
}

export function buildValidationChecks(args: {
  stepNumber: number
  runStep: RunStep | undefined
  deliverable: Record<string, unknown> | null
}): DashboardCheck[] {
  const { stepNumber, runStep, deliverable } = args
  const output = asRecord(runStep?.outputData)
  const checks: DashboardCheck[] = []

  switch (stepNumber) {
    case 1: {
      const idea = readText(deliverable?.idea ?? output?.idea)
      const answeredCount = readNumber(deliverable?.answeredCount ?? output?.answeredCount) ?? 0
      checks.push({
        label: 'Idée de travail',
        detail: idea ? 'Une idée enrichie est disponible pour lancer la suite.' : 'Aucune idée exploitable visible.',
        tone: idea ? 'pass' : 'fail',
      })
      checks.push({
        label: 'Questionnaire amont',
        detail: answeredCount > 0 ? `${answeredCount} réponse(s) ont enrichi l’idée.` : 'Aucun questionnaire utilisé, idée brute seulement.',
        tone: answeredCount > 0 ? 'pass' : 'info',
      })
      break
    }
    case 2: {
      const sections = asArray(deliverable?.sections ?? output?.sections)
      const summary = readText(deliverable?.summary ?? output?.summary)
      const sceneOutline = asArray(deliverable?.sceneOutline ?? output?.sceneOutline)
      checks.push({
        label: 'Résumé de réunion',
        detail: summary ? 'Un résumé exécutif a bien été produit.' : 'Résumé absent ou vide.',
        tone: summary ? 'pass' : 'fail',
      })
      checks.push({
        label: 'Sections agents',
        detail: sections.length >= 5 ? `${sections.length} sections agents disponibles.` : `${sections.length} section(s) détectée(s), réunion incomplète ou faible.`,
        tone: sections.length >= 5 ? 'pass' : sections.length > 0 ? 'warn' : 'fail',
      })
      checks.push({
        label: 'Découpage scène par scène',
        detail: sceneOutline.length > 0 ? `${sceneOutline.length} scène(s) issues de la réunion.` : 'Aucun sceneOutline visible dans le brief.',
        tone: sceneOutline.length > 0 ? 'pass' : 'warn',
      })
      break
    }
    case 3: {
      const scenes = asArray(deliverable?.scenes)
      const targetDuration = readNumber(deliverable?.target_duration_s)
      const sceneOutlineUsed = Boolean(output?.sceneOutlineUsed)
      checks.push({
        label: 'Structure canonique',
        detail: scenes.length > 0 ? `${scenes.length} scène(s) structurée(s).` : 'Aucune scène visible dans structure.json.',
        tone: scenes.length > 0 ? 'pass' : 'fail',
      })
      checks.push({
        label: 'Ancrage au brief',
        detail: sceneOutlineUsed ? 'La structure réutilise explicitement le découpage réunion.' : 'Aucune preuve explicite de réancrage au brief dans les métadonnées.',
        tone: sceneOutlineUsed ? 'pass' : 'warn',
      })
      checks.push({
        label: 'Durée cible',
        detail: targetDuration ? `${targetDuration}s visées au total.` : 'Durée cible absente ou illisible.',
        tone: targetDuration ? 'info' : 'warn',
      })
      break
    }
    case 4: {
      const scenes = asArray(deliverable?.scenes)
      const source = readText(deliverable?.source ?? output?.source)
      const providerUsed = readText(deliverable?.providerUsed ?? output?.providerUsed)
      checks.push({
        label: 'Blueprint scène par scène',
        detail: scenes.length > 0 ? `${scenes.length} panneau(x) prêts pour le rough.` : 'Aucun panneau blueprint visible.',
        tone: scenes.length > 0 ? 'pass' : 'fail',
      })
      checks.push({
        label: 'Source de génération',
        detail: providerUsed ? `${source || 'llm'} via ${providerUsed}.` : source ? `Source ${source}.` : 'Source/provider non documenté.',
        tone: providerUsed || source ? 'info' : 'warn',
      })
      checks.push({
        label: 'Captions lisibles',
        detail: scenes.some((scene) => readText(asRecord(scene)?.childCaption)) ? 'Au moins une caption enfant est présente.' : 'Les captions enfant sont absentes du blueprint.',
        tone: scenes.some((scene) => readText(asRecord(scene)?.childCaption)) ? 'pass' : 'warn',
      })
      break
    }
    case 5: {
      const images = asArray(deliverable?.images)
      const generatedCount = images.filter((image) => readText(asRecord(image)?.status) === 'generated').length
      const placeholderCount = images.filter((image) => Boolean(asRecord(image)?.isPlaceholder)).length
      checks.push({
        label: 'Vignettes storyboard',
        detail: images.length > 0 ? `${images.length} vignette(s) listée(s) dans le manifest.` : 'Aucune vignette storyboard visible.',
        tone: images.length > 0 ? 'pass' : 'fail',
      })
      checks.push({
        label: 'Images réellement générées',
        detail: generatedCount > 0 ? `${generatedCount} vignette(s) générée(s).` : 'Aucune vignette marquée générée.',
        tone: generatedCount > 0 ? 'pass' : 'warn',
      })
      checks.push({
        label: 'Placeholders',
        detail: placeholderCount > 0 ? `${placeholderCount} placeholder(s) présents : validation prudente.` : 'Aucun placeholder détecté.',
        tone: placeholderCount > 0 ? 'warn' : 'pass',
      })
      break
    }
    case 6: {
      const prompts = asArray(deliverable?.prompts)
      const directorPlanUsed = Boolean(deliverable?.directorPlanUsed ?? asRecord(output?.manifest)?.directorPlanUsed)
      const brandKitUsed = Boolean(deliverable?.brandKitUsed ?? asRecord(output?.manifest)?.brandKitUsed)
      checks.push({
        label: 'Prompts prêts',
        detail: prompts.length > 0 ? `${prompts.length} prompt(s) scène par scène disponibles.` : 'Aucun prompt visible.',
        tone: prompts.length > 0 ? 'pass' : 'fail',
      })
      checks.push({
        label: 'Director plan injecté',
        detail: directorPlanUsed ? 'Les prompts mentionnent la direction créative.' : 'Aucune preuve d’injection du director plan.',
        tone: directorPlanUsed ? 'pass' : 'warn',
      })
      checks.push({
        label: 'Brand kit',
        detail: brandKitUsed ? 'Le brand kit a servi au prompting.' : 'Pas de brand kit injecté dans ce prompt manifest.',
        tone: brandKitUsed ? 'info' : 'info',
      })
      break
    }
    case 7: {
      const clips = asArray(deliverable?.clips)
      const clipCount = clips.length || (readNumber(output?.clipCount) ?? 0)
      const totalPrompts = readNumber(output?.totalPrompts) ?? clipCount
      const hasAudio = Boolean(deliverable?.audioPath) || Boolean(output?.hasAudio)
      checks.push({
        label: 'Clips générés',
        detail: totalPrompts > 0
          ? `${clipCount}/${totalPrompts} clip(s) généré(s).`
          : `${clipCount} clip(s) listé(s).`,
        tone: clipCount > 0 ? 'pass' : 'warn',
      })
      checks.push({
        label: 'Audio narratif',
        detail: hasAudio ? 'Une piste audio est disponible.' : 'Aucune piste audio générée pour ce run.',
        tone: hasAudio ? 'pass' : 'info',
      })
      checks.push({
        label: 'Providers vidéo',
        detail: clips.some((clip) => readText(asRecord(clip)?.providerUsed))
          ? 'Le manifest trace les providers réellement utilisés.'
          : 'Le manifest ne documente pas clairement les providers.',
        tone: clips.some((clip) => readText(asRecord(clip)?.providerUsed)) ? 'info' : 'warn',
      })
      break
    }
    case 8: {
      const mode = readText(deliverable?.mode)
      const playable = Boolean(deliverable?.playableFilePath)
      const hasStoryboard = Boolean(deliverable?.hasStoryboard)
      const assemblyError = readText(deliverable?.assemblyError)
      checks.push({
        label: 'Mode de preview',
        detail: mode ? `Preview en mode ${mode}.` : 'Mode preview absent.',
        tone: mode && mode !== 'none' ? 'pass' : 'fail',
      })
      checks.push({
        label: 'Média exploitable',
        detail: playable ? 'Un fichier playable est disponible.' : hasStoryboard ? 'Pas de média playable, mais un fallback storyboard existe.' : 'Aucun média preview exploitable.',
        tone: playable ? 'pass' : hasStoryboard ? 'warn' : 'fail',
      })
      checks.push({
        label: 'Assemblage',
        detail: assemblyError ? short(assemblyError, 140) : 'Aucune erreur d’assemblage remontée.',
        tone: assemblyError ? 'warn' : 'pass',
      })
      break
    }
    case 9: {
      const platforms = asArray(deliverable?.platforms)
      const statuses = platforms.map((platform) => readText(asRecord(platform)?.status)).filter(Boolean)
      checks.push({
        label: 'Tentatives de publication',
        detail: platforms.length > 0 ? `${platforms.length} plateforme(s) renseignée(s).` : 'Aucune tentative de publication visible.',
        tone: platforms.length > 0 ? 'pass' : 'warn',
      })
      checks.push({
        label: 'Statut plateforme',
        detail: statuses.length > 0 ? statuses.join(' · ') : 'Aucun statut de publication.',
        tone: statuses.includes('SUCCESS') ? 'pass' : statuses.includes('FAILED') ? 'warn' : 'info',
      })
      checks.push({
        label: 'Traçabilité publication',
        detail: platforms.some((platform) => readText(asRecord(platform)?.error) || readText(asRecord(platform)?.publishId))
          ? 'Le manifest contient soit un identifiant de publication, soit une erreur traçable.'
          : 'Manifest publication très pauvre, sans trace exploitable.',
        tone: platforms.some((platform) => readText(asRecord(platform)?.error) || readText(asRecord(platform)?.publishId)) ? 'pass' : 'warn',
      })
      break
    }
    default:
      break
  }

  return checks
}

export function buildContextSections(args: {
  stepNumber: number
  deliverable: Record<string, unknown> | null
  runStep: RunStep | undefined
  traces: DashboardAgentTrace[]
}): DashboardContextSection[] {
  const { stepNumber, deliverable, runStep, traces } = args
  const output = asRecord(runStep?.outputData)

  switch (stepNumber) {
    case 1:
      return [
        {
          title: 'Intention de départ',
          body: short(deliverable?.idea ?? output?.idea, 240),
          items: [
            { label: 'Questionnaire', value: readNumber(deliverable?.answeredCount ?? output?.answeredCount) ? `${readNumber(deliverable?.answeredCount ?? output?.answeredCount)} réponse(s)` : 'non utilisé' },
            { label: 'Idée originale', value: short(deliverable?.originalIdea ?? output?.originalIdea, 120) },
          ],
        },
      ]
    case 2: {
      const sections = asArray(deliverable?.sections ?? output?.sections)
      const lastTraces = traces.slice(-5)
      return [
        {
          title: 'Résumé exécutif',
          body: short(deliverable?.summary ?? output?.summary, 320),
          items: [
            { label: 'Sections', value: `${sections.length}` },
            { label: 'Scene outline', value: `${asArray(deliverable?.sceneOutline ?? output?.sceneOutline).length}` },
          ],
        },
        {
          title: 'Sections du brief',
          description: 'Chaque agent doit laisser une section utile à la suite du pipeline.',
          items: sections.slice(0, 6).map((section) => {
            const record = asRecord(section)
            return {
              label: `${readText(record?.agent).toUpperCase() || 'AGENT'} · ${readText(record?.title) || 'Section'}`,
              value: short(record?.content, 140),
            }
          }),
        },
        {
          title: 'Derniers échanges réunion',
          description: 'Vue condensée des dernières traces agents.',
          items: lastTraces.map((trace) => ({
            label: `${trace.agentName} · ${trace.messageType}`,
            value: extractTraceText(trace.content),
          })),
        },
      ]
    }
    case 3: {
      const scenes = asArray(deliverable?.scenes)
      return [
        {
          title: 'Structure canonique',
          items: [
            { label: 'Titre', value: short(deliverable?.title, 120) },
            { label: 'Hook', value: short(deliverable?.hook, 120) },
            { label: 'Ton', value: short(deliverable?.tone, 80) },
            { label: 'Style', value: short(deliverable?.style, 80) },
            { label: 'Durée cible', value: readNumber(deliverable?.target_duration_s) ? `${readNumber(deliverable?.target_duration_s)}s` : '—' },
          ],
        },
        {
          title: 'Scènes structurées',
          description: 'Le dashboard doit montrer si la structure reste lisible scène par scène.',
          items: scenes.map((scene) => {
            const record = asRecord(scene)
            return {
              label: `S${readNumber(record?.index) ?? '?'} · ${readNumber(record?.duration_s) ?? '?'}s`,
              value: `${short(record?.description, 100)} · caméra ${short(record?.camera, 60)}`,
            }
          }),
        },
      ]
    }
    case 4: {
      const scenes = asArray(deliverable?.scenes)
      return [
        {
          title: 'Direction visuelle',
          body: short(deliverable?.creativeDirection ?? output?.creativeDirection, 260),
          items: [
            { label: 'Source', value: short(deliverable?.source ?? output?.source, 80) },
            { label: 'Provider', value: short(deliverable?.providerUsed ?? output?.providerUsed, 80) },
            { label: 'Scènes', value: `${scenes.length || readNumber(output?.sceneCount) || 0}` },
          ],
        },
        {
          title: 'Panneaux blueprint',
          items: scenes.map((scene) => {
            const record = asRecord(scene)
            return {
              label: `S${readNumber(record?.sceneIndex) ?? '?'} · ${short(record?.panelTitle, 40)}`,
              value: short(record?.childCaption ?? record?.action, 120),
            }
          }),
        },
      ]
    }
    case 5: {
      const images = asArray(deliverable?.images)
      return [
        {
          title: 'Storyboard rough',
          items: [
            { label: 'Board layout', value: short(deliverable?.boardLayout, 40) },
            { label: 'Board file', value: basename(deliverable?.boardFilePath) },
            { label: 'Images', value: `${images.length}` },
          ],
        },
        {
          title: 'Vignettes',
          items: images.map((image) => {
            const record = asRecord(image)
            return {
              label: `S${readNumber(record?.sceneIndex) ?? '?'} · ${readText(record?.status) || 'n/a'}`,
              value: short(record?.description ?? record?.prompt, 120),
              tone: Boolean(record?.isPlaceholder) ? 'warn' : readText(record?.status) === 'generated' ? 'pass' : 'info',
            }
          }),
        },
      ]
    }
    case 6: {
      const prompts = asArray(deliverable?.prompts)
      return [
        {
          title: 'Prompting',
          items: [
            { label: 'Ton', value: short(deliverable?.tone, 80) },
            { label: 'Style', value: short(deliverable?.style, 80) },
            { label: 'Director plan', value: Boolean(deliverable?.directorPlanUsed) ? 'oui' : 'non' },
            { label: 'Brand kit', value: Boolean(deliverable?.brandKitUsed) ? 'oui' : 'non' },
          ],
        },
        {
          title: 'Prompts scène par scène',
          items: prompts.map((prompt) => {
            const record = asRecord(prompt)
            return {
              label: `S${readNumber(record?.sceneIndex) ?? '?'}`,
              value: short(record?.prompt, 140),
            }
          }),
        },
      ]
    }
    case 7: {
      const clips = asArray(deliverable?.clips)
      return [
        {
          title: 'Génération clips',
          items: [
            { label: 'Clips', value: `${clips.length || readNumber(output?.clipCount) || 0}` },
            { label: 'Audio', value: readText(deliverable?.audioPath) ? basename(deliverable?.audioPath) : Boolean(output?.hasAudio) ? 'présent' : 'absent' },
            { label: 'Généré le', value: short(deliverable?.generatedAt, 80) },
          ],
        },
        {
          title: 'Clips disponibles',
          items: clips.map((clip) => {
            const record = asRecord(clip)
            return {
              label: `S${readNumber(record?.sceneIndex) ?? '?'} · ${short(record?.providerUsed, 40)}`,
              value: `${basename(record?.filePath)} · ${readNumber(record?.costEur) ?? 0} €`,
            }
          }),
        },
      ]
    }
    case 8:
      return [
        {
          title: 'Preview',
          items: [
            { label: 'Mode', value: short(deliverable?.mode, 40) },
            { label: 'Playable', value: readText(deliverable?.playableFilePath) ? basename(deliverable?.playableFilePath) : 'non' },
            { label: 'Audio', value: Boolean(deliverable?.hasAudio) ? 'oui' : 'non' },
            { label: 'Assembly', value: readText(deliverable?.assemblyError) ? short(deliverable?.assemblyError, 100) : 'OK' },
          ],
        },
        {
          title: 'Sources assemblées',
          items: [
            { label: 'Clips source', value: `${asArray(deliverable?.clips).length}` },
            { label: 'Storyboard source', value: `${asArray(deliverable?.storyboardImages).length}` },
            { label: 'Ready for assembly', value: Boolean(deliverable?.readyForAssembly) ? 'oui' : 'non' },
          ],
        },
      ]
    case 9: {
      const platforms = asArray(deliverable?.platforms)
      return [
        {
          title: 'Publication',
          items: [
            { label: 'Titre', value: short(deliverable?.title, 120) },
            { label: 'Hashtags', value: `${asArray(deliverable?.hashtags).length}` },
            { label: 'Plateformes', value: `${platforms.length}` },
          ],
        },
        {
          title: 'Plateformes',
          items: platforms.map((platform) => {
            const record = asRecord(platform)
            return {
              label: `${readText(record?.platform) || 'plateforme'} · ${readText(record?.status) || 'n/a'}`,
              value: short(record?.shareUrl ?? record?.publishId ?? record?.error, 140),
              tone: readText(record?.status) === 'SUCCESS' ? 'pass' : readText(record?.status) === 'FAILED' ? 'warn' : 'info',
            }
          }),
        },
      ]
    }
    default:
      return []
  }
}

export function summarizeTechnicalLog(entry: DashboardFailoverEntry): { title: string; detail: string } {
  const chain = entry.failoverChain
  const title = chain
    ? `${chain.original} → ${chain.fallback}`
    : entry.providerUsed
      ? `${entry.type || 'provider'} · ${entry.providerUsed}`
      : `${entry.type || 'événement'} technique`

  const detail = short(entry.error || entry.reason || chain?.reason || 'Pas de détail fourni', 180)
  return { title, detail }
}
