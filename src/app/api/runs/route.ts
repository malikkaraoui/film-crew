import { NextResponse } from 'next/server'
import { getRuns, createRun, getRunningRun } from '@/lib/db/queries/runs'
import { executePipeline } from '@/lib/pipeline/engine'
import { logger } from '@/lib/logger'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { buildIntentionPrefix } from '@/lib/intention/schema'
import { writeProjectConfig } from '@/lib/runs/project-config'

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeReferenceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 2)
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function GET() {
  try {
    const runs = await getRuns()
    return NextResponse.json({ data: runs })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    // Vérifier qu'aucun run n'est déjà en exécution
    const active = await getRunningRun()
    if (active) {
      return NextResponse.json(
        { error: { code: 'RUN_ACTIVE', message: 'Un run est déjà en cours — attendez qu\'il se termine ou arrêtez-le' } },
        { status: 409 }
      )
    }

    const body = await request.json()
    const { chainId, idea, template, type, intention, meetingLlmMode, meetingLlmModel, autoStart, outputConfig: rawOutputConfig, referenceImages: rawReferenceImages } = body

    if (!chainId || !idea) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Chaîne et idée requises' } },
        { status: 400 }
      )
    }

    const outputConfig = rawOutputConfig && typeof rawOutputConfig === 'object'
      ? {
          videoCount: parsePositiveInt((rawOutputConfig as Record<string, unknown>).videoCount, 1),
          fullVideoDurationS: parsePositiveInt((rawOutputConfig as Record<string, unknown>).fullVideoDurationS, 60),
          sceneDurationS: parsePositiveInt((rawOutputConfig as Record<string, unknown>).sceneDurationS, 10),
          sceneCount: 1,
        }
      : null

    if (outputConfig && outputConfig.fullVideoDurationS % outputConfig.sceneDurationS !== 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'La durée de la vidéo entière doit être un multiple exact de la durée par scène.' } },
        { status: 400 }
      )
    }

    if (outputConfig) {
      outputConfig.sceneCount = Math.max(1, outputConfig.fullVideoDurationS / outputConfig.sceneDurationS)
    }

    const referenceUrls = normalizeReferenceUrls((rawReferenceImages as Record<string, unknown> | null | undefined)?.urls)
    const invalidReferenceUrl = referenceUrls.find((url) => !isValidHttpUrl(url))
    if (invalidReferenceUrl) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: `URL image invalide : ${invalidReferenceUrl}` } },
        { status: 400 }
      )
    }

    const id = crypto.randomUUID()
    const newRun = await createRun({ id, chainId, idea, template, type })

    // Créer le dossier storage pour ce run
    const runPath = join(process.cwd(), 'storage', 'runs', id)
    await mkdir(join(runPath, 'clips'), { recursive: true })
    await mkdir(join(runPath, 'audio'), { recursive: true })
    await mkdir(join(runPath, 'subtitles'), { recursive: true })
    await mkdir(join(runPath, 'storyboard'), { recursive: true })
    await mkdir(join(runPath, 'final'), { recursive: true })

    const projectConfig = await writeProjectConfig(runPath, {
      meetingLlmMode,
      meetingLlmModel,
      outputConfig,
      referenceImages: referenceUrls.length > 0 ? { urls: referenceUrls } : null,
    })

    // Persister intention.json si le questionnaire a été rempli
    if (intention && typeof intention === 'object' && Object.keys(intention).length > 0) {
      const intentionData = {
        answers: intention,
        prefix: buildIntentionPrefix(intention as Record<string, string>),
        createdAt: new Date().toISOString(),
      }
      await writeFile(
        join(runPath, 'intention.json'),
        JSON.stringify(intentionData, null, 2),
      )
      logger.info({ event: 'intention_saved', runId: id, answeredCount: Object.keys(intention).length })
    }

    if (autoStart !== false) {
      executePipeline(id, { mode: 'continuous' }).catch((e) => {
        logger.error({ event: 'pipeline_crash', runId: id, error: (e as Error).message })
      })
    }

    return NextResponse.json({ data: { ...newRun, projectConfig } }, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: (e as Error).message } },
      { status: 500 }
    )
  }
}
