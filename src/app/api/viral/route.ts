import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { mkdir, readdir, readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import { createViralStatus, updateViralStatus } from '@/lib/viral/status'
import { parseViralSegmentsFromLlm } from '@/lib/viral/segment-parser'
import {
  buildYouTubeSourceContext,
  parseVttToTranscript,
  selectPreferredSubtitleLanguage,
} from '@/lib/viral/source-context'

function getProviderMode(providerName: string): 'local' | 'external' {
  return providerName === 'ollama' ? 'local' : 'external'
}

async function fetchYouTubeInfo(url: string, cwd: string): Promise<Record<string, unknown>> {
  const result = await runCommand('yt-dlp', [
    '--dump-single-json',
    '--no-playlist',
    '--skip-download',
    '--js-runtime', 'node',
    url,
  ], cwd)

  if (result.code !== 0) {
    throw new Error(`Impossible de lire les métadonnées YouTube : ${result.stderr.slice(0, 300)}`)
  }

  return JSON.parse(result.stdout) as Record<string, unknown>
}

async function downloadPreferredSubtitles(url: string, viralDir: string, language: string): Promise<string | undefined> {
  const result = await runCommand('yt-dlp', [
    '--skip-download',
    '--write-auto-sub',
    '--write-sub',
    '--sub-langs', language,
    '--sub-format', 'vtt',
    '-o', join(viralDir, 'captions.%(ext)s'),
    '--no-playlist',
    '--js-runtime', 'node',
    url,
  ], process.cwd())

  if (result.code !== 0) return undefined

  const files = await readdir(viralDir)
  const vttFile = files.find((file) => file.startsWith('captions') && file.endsWith('.vtt'))
  if (!vttFile) return undefined

  return readFile(join(viralDir, vttFile), 'utf-8')
}

async function processViralSession(id: string, url: string, instruction?: string): Promise<void> {
  const viralDir = join(process.cwd(), 'storage', 'viral', id)

  try {
    const videoInfo = await fetchYouTubeInfo(url, process.cwd())
    await writeFile(join(viralDir, 'video-info.json'), JSON.stringify(videoInfo, null, 2))

    await updateViralStatus(id, {
      state: 'running',
      currentStep: 'downloading',
      scope: 'local',
      message: 'Téléchargement de la vidéo YouTube via yt-dlp sur cette machine',
      details: 'Commande locale : yt-dlp → storage/viral/{id}/source.mp4',
    })

    const dlResult = await runCommand('yt-dlp', [
      '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '--merge-output-format', 'mp4',
      '-o', join(viralDir, 'source.mp4'),
      '--no-playlist',
      '--js-runtime', 'node',
      url,
    ], process.cwd())

    if (dlResult.code !== 0) {
      logger.error({ event: 'viral_download_failed', id, stderr: dlResult.stderr })
      await updateViralStatus(id, {
        state: 'error',
        currentStep: 'error',
        scope: 'local',
        message: 'Échec du téléchargement YouTube',
        details: dlResult.stderr.slice(0, 500),
        error: dlResult.stderr.slice(0, 500),
        completedAt: new Date().toISOString(),
      })
      return
    }

    await updateViralStatus(id, {
      state: 'running',
      currentStep: 'transcribing',
      scope: 'local',
      message: 'Préparation de la transcription',
      details: 'Tentative de récupération des sous-titres YouTube avant fallback métadonnées',
    })

    const subtitleLanguage = selectPreferredSubtitleLanguage(videoInfo)
    const subtitleVtt = subtitleLanguage
      ? await downloadPreferredSubtitles(url, viralDir, subtitleLanguage)
      : undefined
    const transcriptText = subtitleVtt ? parseVttToTranscript(subtitleVtt) : undefined
    const sourceContext = buildYouTubeSourceContext({
      info: videoInfo,
      transcript: transcriptText,
      subtitleLanguage,
    })

    const transcriptPath = join(viralDir, 'transcript.txt')
    await writeFile(transcriptPath, sourceContext.transcript)

    await updateViralStatus(id, {
      state: 'running',
      currentStep: 'transcribing',
      scope: 'local',
      message: sourceContext.transcriptSource === 'youtube-subtitles'
        ? 'Sous-titres YouTube récupérés pour l’analyse'
        : 'Aucun sous-titre récupéré — fallback sur les métadonnées YouTube',
      details: sourceContext.transcriptSource === 'youtube-subtitles'
        ? `Langue détectée : ${sourceContext.subtitleLanguage ?? 'inconnue'}`
        : 'Analyse bridée aux métadonnées ; pas d’invention autorisée hors contexte',
    })

    await updateViralStatus(id, {
      state: 'running',
      currentStep: 'analyzing',
      scope: 'local',
      message: 'Analyse des segments viraux',
      details: sourceContext.transcriptSource === 'youtube-subtitles'
        ? 'LLM appelé sur les sous-titres YouTube + métadonnées'
        : 'LLM appelé uniquement sur les métadonnées YouTube, avec consigne anti-hallucination',
    })

    const { result, provider, failover } = await executeWithFailover(
      'llm',
      async (p) => {
        const llm = p as LLMProvider
        return llm.chat(
          [
            {
              role: 'system',
              content: `Tu es un analyste vidéo ultra rigoureux.
Tu travailles UNIQUEMENT à partir du contexte fourni (métadonnées YouTube + sous-titres éventuels).
Tu dois répondre EXCLUSIVEMENT EN FRANÇAIS.
Interdictions absolues :
- ne pas inventer des scènes, animaux, objets ou dialogues absents du contexte,
- ne pas halluciner un sujet générique à partir de l'URL,
- ne pas privilégier un pre-roll publicitaire ou une auto-promo si le contexte principal parle d'autre chose,
- si le contexte est insuffisant ou douteux, retourner un tableau segments vide.

Objectif : proposer 3-5 segments de 30 à 60 secondes maximum qui feraient de bons shorts TikTok/Reels.
${instruction ? `Consigne spéciale : ${instruction}` : ''}
Retourne un JSON :
{
  "segments": [
    {
      "index": 1,
      "start_s": 0,
      "end_s": 45,
      "title": "titre accrocheur",
      "reason": "pourquoi ce segment est viral",
      "excerpt": "extrait du texte"
    }
  ]
}
Retourne UNIQUEMENT le JSON.`,
            },
            {
              role: 'user',
              content: `URL YouTube : ${url}
Titre : ${sourceContext.title || 'inconnu'}
Chaîne : ${sourceContext.channel || 'inconnue'}
Durée : ${sourceContext.durationSeconds ?? 'inconnue'} secondes
Source de transcription : ${sourceContext.transcriptSource}${sourceContext.subtitleLanguage ? ` (${sourceContext.subtitleLanguage})` : ''}

Contexte à analyser :
${sourceContext.transcript}

Analyse et propose les meilleurs segments sans rien inventer. Si le contexte n'est pas assez fiable, retourne {"segments": []}.`,
            },
          ],
          { temperature: 0.7, maxTokens: 1500 },
        )
      },
    )

    const parsedSegments = parseViralSegmentsFromLlm(result.content)
    const segments = {
      segments: parsedSegments.segments,
      ...(parsedSegments.parseError ? { parseError: parsedSegments.parseError } : {}),
      ...(parsedSegments.raw ? { raw: parsedSegments.raw } : {}),
    }

    await writeFile(join(viralDir, 'segments.json'), JSON.stringify(segments, null, 2))

    let sourceSizeBytes: number | undefined
    try {
      const s = await stat(join(viralDir, 'source.mp4'))
      sourceSizeBytes = s.size
    } catch {}

    const segmentsArr = parsedSegments.segments

    const viralManifest = {
      id,
      version: 1 as const,
      url,
      sourceDownloaded: true,
      sourceSizeBytes,
      segmentsCount: segmentsArr.length,
      runsCreated: [] as string[],
      generatedAt: new Date().toISOString(),
    }
    await writeFile(join(viralDir, 'viral-manifest.json'), JSON.stringify(viralManifest, null, 2))

    const providerMode = getProviderMode(provider.name)
    await updateViralStatus(id, {
      state: 'completed',
      currentStep: 'completed',
      scope: providerMode,
      message: `${segmentsArr.length} segment(s) généré(s) — analyse terminée`,
      details: providerMode === 'local'
        ? `Analyse effectuée en local via ${provider.name} (${sourceContext.transcriptSource})`
        : `Analyse effectuée via provider externe : ${provider.name} (${sourceContext.transcriptSource})`,
      providerUsed: provider.name,
      providerMode,
      failover: failover
        ? { original: failover.original, fallback: failover.fallback, reason: failover.reason }
        : undefined,
      completedAt: new Date().toISOString(),
      ...(parsedSegments.parseError
        ? { error: `Réponse LLM partiellement invalide : ${parsedSegments.parseError}` }
        : {}),
    })

    logger.info({ event: 'viral_segments_detected', id, segmentsCount: segmentsArr.length, provider: provider.name })
  } catch (e) {
    const message = (e as Error).message
    logger.error({ event: 'viral_error', id, error: message })
    await updateViralStatus(id, {
      state: 'error',
      currentStep: 'error',
      scope: 'mixed',
      message: 'Analyse virale interrompue',
      details: message,
      error: message,
      completedAt: new Date().toISOString(),
    })
  }
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { url, instruction } = body as { url: string; instruction?: string }

    if (!url?.includes('youtube.com') && !url?.includes('youtu.be')) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'URL YouTube invalide' } },
        { status: 400 },
      )
    }

    const id = crypto.randomUUID()
    const viralDir = join(process.cwd(), 'storage', 'viral', id)
    await mkdir(viralDir, { recursive: true })
    await createViralStatus(id, url)

    logger.info({ event: 'viral_start', id, url })

    void processViralSession(id, url, instruction)

    return NextResponse.json({
      data: {
        id,
        url,
        storagePath: viralDir,
        status: 'queued',
        message: 'Session créée — suivi disponible immédiatement',
      },
    }, { status: 202 })
  } catch (e) {
    logger.error({ event: 'viral_error', error: (e as Error).message })
    return NextResponse.json(
      { error: { code: 'VIRAL_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
