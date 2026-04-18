import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import type { PipelineStep, StepContext, StepResult } from '../types'
import { logger } from '@/lib/logger'

export const step3Json: PipelineStep = {
  name: 'JSON structuré',
  stepNumber: 3,

  async execute(ctx: StepContext): Promise<StepResult> {
    // Lire le brief produit par la réunion d'agents (step 2)
    let briefContent: string | null = null
    try {
      briefContent = await readFile(join(ctx.storagePath, 'brief.json'), 'utf-8')
    } catch {
      logger.warn({ event: 'brief_missing', runId: ctx.runId, fallback: 'ctx.idea' })
    }

    // Construire le prompt utilisateur à partir du brief ou fallback sur l'idée brute
    const userContent = briefContent
      ? `Brief de la réunion de production :\n\n${briefContent}\n\nTransforme ce brief en JSON structuré pour la production.`
      : `[FALLBACK — brief absent, idée brute uniquement]\n\nIdée : ${ctx.idea}\n\nTransforme en JSON structuré pour la production.`

    const { result } = await executeWithFailover(
      'llm',
      async (p) => {
        const llm = p as LLMProvider
        return llm.chat(
          [
            {
              role: 'system',
              content: `Tu es un assistant de production vidéo. Transforme le brief de réunion en un document JSON structuré pour la production.
Le JSON doit contenir :
{
  "title": "titre de la vidéo",
  "hook": "phrase d'accroche (5-10 mots)",
  "scenes": [
    {
      "index": 1,
      "description": "description visuelle détaillée de la scène",
      "dialogue": "texte de la narration pour cette scène",
      "camera": "mouvement caméra (1 seul)",
      "lighting": "description éclairage",
      "duration_s": 10
    }
  ],
  "style": "style visuel global",
  "tone": "ton émotionnel",
  "target_duration_s": 90
}
Retourne UNIQUEMENT le JSON, sans markdown ni explication.`,
            },
            {
              role: 'user',
              content: userContent,
            },
          ],
          { temperature: 0.5, maxTokens: 2048 },
        )
      },
      ctx.runId,
    )

    // Toujours sauvegarder la réponse brute pour diagnostic
    await writeFile(join(ctx.storagePath, 'structure-raw.txt'), result.content)

    // Parser le JSON — nettoyage défensif pour qwen3.5:4b
    let parsed: unknown
    try {
      let raw = result.content
      // Retirer les fences markdown ```json ... ```
      raw = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '')
      // Extraire le premier objet JSON
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Aucun objet JSON trouvé dans la réponse')
      parsed = JSON.parse(jsonMatch[0])
    } catch (e) {
      return {
        success: false,
        costEur: result.costEur,
        outputData: { raw: result.content },
        error: `Parsing JSON échoué: ${(e as Error).message}. Réponse brute conservée dans structure-raw.txt`,
      }
    }

    const outputPath = join(ctx.storagePath, 'structure.json')
    await writeFile(outputPath, JSON.stringify(parsed, null, 2))

    return {
      success: true,
      costEur: result.costEur,
      outputData: parsed,
    }
  },
}
