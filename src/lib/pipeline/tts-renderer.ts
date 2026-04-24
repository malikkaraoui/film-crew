import { readFile, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { TTSProvider } from '@/lib/providers/types'
import type { DialogueScript, DialogueLine } from '@/types/audio'
import { logger } from '@/lib/logger'

// ─── TTS Manifest ───

export type TTSManifestLine = {
  sceneIndex: number
  lineIndex: number
  speaker: string
  filePath: string
  durationS: number
}

export type TTSManifest = {
  runId: string
  provider: string
  voice: string
  language: string
  lines: TTSManifestLine[]
}

// ─── Core ───

/**
 * Rend chaque DialogueLine en WAV individuel via la stack TTS provider
 * (kokoro-local → piper-local → system-tts → fish-audio).
 *
 * Produit un dossier `tts/` avec un WAV par ligne et un `tts_manifest.json`.
 * En cas d'échec d'une ligne, la ligne est skippée avec un warning
 * (le manifest ne contiendra que les lignes rendues).
 */
export async function renderDialogueToTTS(params: {
  storagePath: string
  runId: string
  language?: string
  voice?: string
}): Promise<TTSManifest | null> {
  const { storagePath, runId, language: languageOverride, voice = 'default' } = params

  // Lire le dialogue_script.json
  let script: DialogueScript
  try {
    const raw = await readFile(join(storagePath, 'dialogue_script.json'), 'utf-8')
    script = JSON.parse(raw) as DialogueScript
  } catch (error) {
    logger.warn({
      event: 'tts_render_no_script',
      runId,
      error: (error as Error).message,
    })
    return null
  }

  if (!script.scenes || script.scenes.length === 0) {
    logger.warn({ event: 'tts_render_empty_script', runId })
    await rm(join(storagePath, 'tts_manifest.json'), { force: true }).catch(() => {})
    await rm(join(storagePath, 'tts'), { recursive: true, force: true }).catch(() => {})
    return null
  }

  const language = languageOverride ?? script.language ?? 'fr'

  // Créer le dossier tts/
  const ttsDir = join(storagePath, 'tts')
  await rm(ttsDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(ttsDir, { recursive: true })

  // Collecter toutes les lignes à rendre
  const linesToRender: { sceneIndex: number; line: DialogueLine }[] = []
  for (const scene of script.scenes) {
    for (const line of scene.lines) {
      if (line.text.trim()) {
        linesToRender.push({ sceneIndex: scene.sceneIndex, line })
      }
    }
  }

  if (linesToRender.length === 0) {
    logger.warn({ event: 'tts_render_no_lines', runId })
    await rm(join(storagePath, 'tts_manifest.json'), { force: true }).catch(() => {})
    await rm(ttsDir, { recursive: true, force: true }).catch(() => {})
    return null
  }

  logger.info({
    event: 'tts_render_start',
    runId,
    lineCount: linesToRender.length,
    sceneCount: script.scenes.length,
  })

  // Rendre chaque ligne
  const manifestLines: TTSManifestLine[] = []
  const providersUsed = new Set<string>()

  for (const { sceneIndex, line } of linesToRender) {
    const filename = `tts-scene${sceneIndex}-line${line.lineIndex}.wav`
    const outputPath = join(ttsDir, filename)

    try {
      const { result, provider } = await executeWithFailover(
        'tts',
        async (p) => {
          const tts = p as TTSProvider
          return tts.synthesize(line.text, voice, language, ttsDir)
        },
        runId,
      )

      providersUsed.add(provider.name)

      // Le provider écrit le fichier dans ttsDir avec son propre nom.
      // On le renomme vers notre convention de nommage.
      if (result.filePath !== outputPath) {
        const { rename } = await import('fs/promises')
        await rename(result.filePath, outputPath)
      }

      manifestLines.push({
        sceneIndex,
        lineIndex: line.lineIndex,
        speaker: line.speaker,
        filePath: filename, // relatif au dossier tts/
        durationS: Number(result.duration.toFixed(3)),
      })

      logger.info({
        event: 'tts_render_line',
        runId,
        sceneIndex,
        lineIndex: line.lineIndex,
        speaker: line.speaker,
        durationS: Number(result.duration.toFixed(3)),
        provider: provider.name,
      })
    } catch (error) {
      logger.warn({
        event: 'tts_render_line_failed',
        runId,
        sceneIndex,
        lineIndex: line.lineIndex,
        error: (error as Error).message,
      })
      // Skip cette ligne, on continue avec les suivantes
    }
  }

  if (manifestLines.length === 0) {
    logger.warn({ event: 'tts_render_all_failed', runId })
    await rm(join(storagePath, 'tts_manifest.json'), { force: true }).catch(() => {})
    await rm(ttsDir, { recursive: true, force: true }).catch(() => {})
    return null
  }

  const providerUsed = providersUsed.size === 1
    ? [...providersUsed][0]
    : 'mixed'

  // Écrire le manifest
  const manifest: TTSManifest = {
    runId,
    provider: providerUsed,
    voice,
    language,
    lines: manifestLines,
  }

  await writeFile(
    join(storagePath, 'tts_manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  logger.info({
    event: 'tts_render_complete',
    runId,
    renderedLines: manifestLines.length,
    totalLines: linesToRender.length,
    provider: providerUsed,
  })

  return manifest
}
