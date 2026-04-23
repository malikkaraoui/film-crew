import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { NextResponse } from 'next/server'
import { getRunSteps } from '@/lib/db/queries/runs'

type DeliverableConfig = {
  title: string
  expected: string
  filePath?: string
  pageHref?: string
  editable: boolean
}

function getConfig(runId: string, stepNumber: number): DeliverableConfig | null {
  const base = join(process.cwd(), 'storage', 'runs', runId)

  const map: Record<number, DeliverableConfig> = {
    1: {
      title: 'Idée enrichie',
      expected: 'Intention structurée du run',
      filePath: join(base, 'intention.json'),
      editable: true,
    },
    2: {
      title: 'Réunion / brief',
      expected: 'Compte-rendu de réunion + brief éditorial',
      filePath: join(base, 'brief.json'),
      pageHref: `/runs/${runId}/studio`,
      editable: true,
    },
    3: {
      title: 'JSON structuré',
      expected: 'Structure canonique du film',
      filePath: join(base, 'structure.json'),
      editable: true,
    },
    4: {
      title: 'Blueprint visuel',
      expected: 'Plan visuel simple scène par scène pour rough local + cloud',
      filePath: join(base, 'storyboard-blueprint.json'),
      editable: true,
    },
    5: {
      title: 'Storyboard',
      expected: 'Vignettes par scène + prompts storyboard',
      filePath: join(base, 'storyboard', 'manifest.json'),
      pageHref: `/runs/${runId}/storyboard`,
      editable: false,
    },
    6: {
      title: 'Prompts vidéo',
      expected: 'Prompts scène par scène + négatifs',
      filePath: join(base, 'prompt-manifest.json'),
      pageHref: `/runs/${runId}/prompts`,
      editable: true,
    },
    7: {
      title: 'Génération',
      expected: 'Manifest clips/audio + liens vers brouillons',
      filePath: join(base, 'generation-manifest.json'),
      pageHref: `/runs/${runId}/preview`,
      editable: true,
    },
    8: {
      title: 'Preview',
      expected: 'Preview-manifest + média playable si dispo',
      filePath: join(base, 'preview-manifest.json'),
      pageHref: `/runs/${runId}/preview`,
      editable: true,
    },
    9: {
      title: 'Publication',
      expected: 'Manifest publication + export contextualisé',
      filePath: join(base, 'publish-manifest.json'),
      pageHref: `/runs/${runId}/export`,
      editable: true,
    },
  }

  return map[stepNumber] ?? null
}

function summarize(stepNumber: number, content: string | null): string {
  if (!content) return 'Livrable non disponible pour le moment.'

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (stepNumber === 1 && typeof parsed.idea === 'string') {
      return `Idée de travail prête${parsed.hasIntention ? ' avec questionnaire' : ''}.`
    }
    if (stepNumber === 2 && Array.isArray(parsed.sections)) {
      return `${parsed.sections.length} section(s) de brief disponibles.`
    }
    if (stepNumber === 3 && Array.isArray(parsed.scenes)) {
      return `${parsed.scenes.length} scène(s) structurée(s).`
    }
    if (stepNumber === 4 && Array.isArray(parsed.scenes)) {
      return `${parsed.scenes.length} scène(s) enrichie(s) dans le blueprint visuel.`
    }
    if (stepNumber === 5 && Array.isArray(parsed.images)) {
      return `${parsed.images.length} image(s) storyboard dans le manifest.`
    }
    if (stepNumber === 6 && Array.isArray(parsed.prompts)) {
      return `${parsed.prompts.length} prompt(s) vidéo prêts pour la génération.`
    }
    if (stepNumber === 7 && Array.isArray(parsed.clips)) {
      return `${parsed.clips.length} clip(s) dans le manifest de génération.`
    }
    if (stepNumber === 8 && typeof parsed.mode === 'string') {
      return `Mode de preview actuel : ${parsed.mode}.`
    }
    if (stepNumber === 9 && Array.isArray(parsed.attempts)) {
      return `${parsed.attempts.length} tentative(s) de publication enregistrée(s).`
    }
  } catch {
    // texte libre
  }

  return content.slice(0, 180).replace(/\s+/g, ' ').trim() + (content.length > 180 ? '…' : '')
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; stepNumber: string }> },
) {
  const { id, stepNumber } = await context.params
  const step = Number(stepNumber)
  const config = getConfig(id, step)

  if (!config) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Étape inconnue' } },
      { status: 404 },
    )
  }

  let content: string | null = null
  if (config.filePath) {
    try {
      content = await readFile(config.filePath, 'utf-8')
    } catch {
      content = null
    }
  }

  if (content === null && step === 1) {
    const steps = await getRunSteps(id)
    const stepOne = steps.find((entry) => entry.stepNumber === 1)
    if (stepOne?.outputData != null) {
      content = JSON.stringify(stepOne.outputData, null, 2)
    }
  }

  return NextResponse.json({
    data: {
      stepNumber: step,
      title: config.title,
      expected: config.expected,
      editable: config.editable,
      pageHref: config.pageHref ?? null,
      fileName: config.filePath ? config.filePath.split('/').pop() ?? null : null,
      available: content !== null,
      content,
      summary: summarize(step, content),
    },
  })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; stepNumber: string }> },
) {
  const { id, stepNumber } = await context.params
  const step = Number(stepNumber)
  const config = getConfig(id, step)

  if (!config?.filePath || !config.editable) {
    return NextResponse.json(
      { error: { code: 'NOT_ALLOWED', message: 'Livrable non éditable via cette route' } },
      { status: 400 },
    )
  }

  const body = await request.json().catch(() => null) as { content?: string } | null
  if (!body?.content || !body.content.trim()) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'content requis' } },
      { status: 400 },
    )
  }

  await writeFile(config.filePath, body.content)
  return NextResponse.json({
    data: {
      stepNumber: step,
      saved: true,
      summary: summarize(step, body.content),
    },
  })
}