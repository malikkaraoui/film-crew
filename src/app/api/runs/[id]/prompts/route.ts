import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { NextResponse } from 'next/server'

type PromptEntry = {
  sceneIndex: number
  prompt: string
  negativePrompt?: string
}

function getPaths(runId: string) {
  const base = join(process.cwd(), 'storage', 'runs', runId)
  return {
    promptsPath: join(base, 'prompts.json'),
    promptManifestPath: join(base, 'prompt-manifest.json'),
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const { promptsPath, promptManifestPath } = getPaths(id)

  try {
    const promptsRaw = JSON.parse(await readFile(promptsPath, 'utf-8')) as { prompts: PromptEntry[] }
    let manifestPrompts: Array<PromptEntry & { sources?: Record<string, unknown> }> = []
    try {
      const manifestRaw = JSON.parse(await readFile(promptManifestPath, 'utf-8')) as { prompts?: Array<PromptEntry & { sources?: Record<string, unknown> }> }
      manifestPrompts = manifestRaw.prompts ?? []
    } catch {
      // no-op
    }

    const prompts = promptsRaw.prompts.map((entry) => {
      const detailed = manifestPrompts.find((item) => item.sceneIndex === entry.sceneIndex)
      return {
        ...entry,
        sources: detailed?.sources,
      }
    })

    return NextResponse.json({ data: { prompts } })
  } catch (e) {
    const message = (e as Error).message
    if (/ENOENT|no such file or directory/i.test(message)) {
      return NextResponse.json({
        data: {
          prompts: [],
        },
        meta: {
          reason: 'prompts.json absent — étape 6 non encore terminée ou relance en cours',
        },
      })
    }

    return NextResponse.json(
      { error: { code: 'PROMPTS_ERROR', message } },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const body = await request.json().catch(() => null) as { sceneIndex?: number; prompt?: string; negativePrompt?: string } | null
  if (!body?.sceneIndex || !body?.prompt?.trim()) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'sceneIndex et prompt requis' } },
      { status: 400 },
    )
  }

  const { promptsPath, promptManifestPath } = getPaths(id)
  const promptsRaw = JSON.parse(await readFile(promptsPath, 'utf-8')) as { prompts: PromptEntry[] }
  const prompt = promptsRaw.prompts.find((item) => item.sceneIndex === body.sceneIndex)
  if (!prompt) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Prompt scène introuvable' } },
      { status: 404 },
    )
  }

  prompt.prompt = body.prompt
  if (body.negativePrompt !== undefined) {
    prompt.negativePrompt = body.negativePrompt
  }
  await writeFile(promptsPath, JSON.stringify(promptsRaw, null, 2))

  try {
    const manifestRaw = JSON.parse(await readFile(promptManifestPath, 'utf-8')) as { prompts?: PromptEntry[] }
    const manifestPrompt = manifestRaw.prompts?.find((item) => item.sceneIndex === body.sceneIndex)
    if (manifestPrompt) {
      manifestPrompt.prompt = body.prompt
      if (body.negativePrompt !== undefined) {
        manifestPrompt.negativePrompt = body.negativePrompt
      }
      await writeFile(promptManifestPath, JSON.stringify(manifestRaw, null, 2))
    }
  } catch {
    // no-op
  }

  return NextResponse.json({
    data: {
      sceneIndex: body.sceneIndex,
      prompt: body.prompt,
      negativePrompt: body.negativePrompt ?? prompt.negativePrompt ?? '',
      saved: true,
    },
  })
}