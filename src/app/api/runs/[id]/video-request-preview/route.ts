import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { bootstrapProviders } from '@/lib/providers/bootstrap'
import { registry } from '@/lib/providers/registry'
import { readProjectConfig } from '@/lib/runs/project-config'
import {
  buildHappyHorseRequestBody,
  getHappyHorseSettingOptions,
  HAPPYHORSE_BASE_URL,
  HAPPYHORSE_GENERATE_PATH,
} from '@/lib/providers/video/happyhorse'
import type { ProviderHealth } from '@/lib/providers/types'

bootstrapProviders()

type PromptEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt?: string
}

const PIPELINE_VIDEO_OPTS = {
  resolution: '720p' as const,
  duration: 10,
  aspectRatio: '9:16',
}

function pickPipelineProvider(providers: Array<{ name: string; health: ProviderHealth; excludedFromStandard: boolean }>) {
  const eligible = providers.filter((provider) => !provider.excludedFromStandard)
  return eligible.find((provider) => provider.health.status === 'free')
    ?? eligible.find((provider) => provider.health.status !== 'down')
    ?? null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const storagePath = join(process.cwd(), 'storage', 'runs', id)
    const projectConfig = await readProjectConfig(storagePath)

    let prompts: PromptEntry[] = []
    let promptsMeta: { reason?: string } | null = null
    try {
      const promptsRaw = JSON.parse(
        await readFile(join(storagePath, 'prompts.json'), 'utf-8'),
      ) as { prompts?: PromptEntry[] }
      prompts = Array.isArray(promptsRaw.prompts) ? promptsRaw.prompts : []
    } catch (error) {
      const message = (error as Error).message
      if (/ENOENT|no such file or directory/i.test(message)) {
        promptsMeta = {
          reason: 'prompts.json absent — étape 6 en cours ou non encore terminée',
        }
      } else {
        throw error
      }
    }
    const referenceImageUrls = projectConfig?.referenceImages?.urls ?? []

    const videoProviders = registry.getByType('video')
    const providers = await Promise.all(
      videoProviders.map(async (provider) => ({
        name: provider.name,
        health: await provider.healthCheck(),
        excludedFromStandard: provider.name === 'sketch-local',
      })),
    )
    const selectedProvider = pickPipelineProvider(providers)

    return NextResponse.json({
      data: {
        outputConfig: projectConfig?.outputConfig ?? null,
        referenceImages: referenceImageUrls,
        promptCount: prompts.length,
        promptsMeta,
        pipelineVideoOpts: PIPELINE_VIDEO_OPTS,
        providerSelection: {
          selectedProvider: selectedProvider?.name ?? null,
          providers,
        },
        happyHorse: {
          endpoint: `${HAPPYHORSE_BASE_URL}${HAPPYHORSE_GENERATE_PATH}`,
          method: 'POST',
          settingOptions: getHappyHorseSettingOptions(),
          negativePromptHandling: 'non envoyé dans la requête HappyHorse actuelle',
        },
        requests: prompts.map((entry) => ({
          sceneIndex: entry.sceneIndex,
          prompt: entry.prompt,
          negativePrompt: entry.negativePrompt ?? '',
          negativePromptSent: false,
          chosenSettings: {
            ...PIPELINE_VIDEO_OPTS,
            provider: 'happyhorse',
            referenceImageCount: referenceImageUrls.length,
          },
          happyHorseBody: buildHappyHorseRequestBody(entry.prompt, {
            ...PIPELINE_VIDEO_OPTS,
            referenceImageUrls,
          }),
        })),
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: { code: 'VIDEO_REQUEST_PREVIEW_ERROR', message: (error as Error).message } },
      { status: 500 },
    )
  }
}
