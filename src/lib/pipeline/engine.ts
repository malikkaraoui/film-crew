import { join } from 'path'
import { getRunById, updateRunStatus, updateRunCost } from '@/lib/db/queries/runs'
import { getChainById } from '@/lib/db/queries/chains'
import { logger } from '@/lib/logger'
import { db } from '@/lib/db/connection'
import { runStep } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { existsSync } from 'fs'
import { loadTemplate } from '@/lib/templates/loader'
import type { StepContext, PipelineStep } from './types'

// Import des étapes
import { step1Idea } from './steps/step-1-idea'
import { step2Brainstorm } from './steps/step-2-brainstorm'
import { step3Json } from './steps/step-3-json'
import { step4Storyboard } from './steps/step-4-storyboard'
import { step5Prompts } from './steps/step-5-prompts'
import { step6Generation } from './steps/step-6-generation'
import { step7Preview } from './steps/step-7-preview'
import { step8Publish } from './steps/step-8-publish'

const STEPS: PipelineStep[] = [
  step1Idea,
  step2Brainstorm,
  step3Json,
  step4Storyboard,
  step5Prompts,
  step6Generation,
  step7Preview,
  step8Publish,
]

/**
 * Exécute le pipeline à partir de l'étape courante du run.
 * Chaque étape est exécutée séquentiellement avec mise à jour DB.
 */
export async function executePipeline(runId: string): Promise<void> {
  const run = await getRunById(runId)
  if (!run) throw new Error(`Run ${runId} introuvable`)

  const chain = await getChainById(run.chainId)
  if (!chain) throw new Error(`Chaîne ${run.chainId} introuvable`)

  const storagePath = join(process.cwd(), 'storage', 'runs', runId)
  const intentionPath = existsSync(join(storagePath, 'intention.json'))
    ? join(storagePath, 'intention.json')
    : null

  // Charger le template de style si le run en a un (10D)
  const template = run.template ? await loadTemplate(run.template) : null
  if (run.template) {
    logger.info({ event: 'template_loaded', runId, templateId: run.template, found: !!template })
  }

  const ctx: StepContext = {
    runId,
    chainId: run.chainId,
    idea: run.idea,
    brandKitPath: chain.brandKitPath,
    storagePath,
    intentionPath,
    template,
  }

  const startStep = run.currentStep ?? 1
  let totalCost = run.costEur ?? 0

  logger.info({ event: 'pipeline_start', runId, startStep })

  for (let i = startStep - 1; i < STEPS.length; i++) {
    const step = STEPS[i]

    // Mettre à jour le statut de l'étape
    await updateStepStatus(runId, step.stepNumber, 'running')
    await updateRunStatus(runId, 'running', step.stepNumber)

    // Heartbeat toutes les 60s pendant l'exécution du step
    // (les steps LLM/Ollama peuvent prendre plusieurs minutes)
    const heartbeatInterval = setInterval(async () => {
      try { await updateRunStatus(runId, 'running', step.stepNumber) } catch { /* best-effort */ }
    }, 60_000)

    try {
      const result = await step.execute(ctx)
      clearInterval(heartbeatInterval)

      totalCost += result.costEur
      await updateRunCost(runId, totalCost)

      await updateStepStatus(runId, step.stepNumber, result.success ? 'completed' : 'failed', {
        costEur: result.costEur,
        outputData: result.outputData,
        error: result.error,
      })

      if (!result.success) {
        await updateRunStatus(runId, 'failed', step.stepNumber)
        logger.error({ event: 'step_failed', runId, step: step.name, error: result.error })
        return
      }

      // Step 1 peut enrichir ctx.idea avec le prefix d'intention — propager aux steps suivants
      if (step.stepNumber === 1) {
        const data = result.outputData as Record<string, unknown> | null
        if (data?.idea && typeof data.idea === 'string' && data.idea !== ctx.idea) {
          ctx.idea = data.idea
          logger.info({ event: 'idea_enriched', runId, answeredCount: data.answeredCount })
        }
      }

      logger.info({ event: 'step_completed', runId, step: step.name, costEur: result.costEur })
    } catch (e) {
      clearInterval(heartbeatInterval)
      const error = (e as Error).message
      await updateStepStatus(runId, step.stepNumber, 'failed', { error })
      await updateRunStatus(runId, 'failed', step.stepNumber)
      logger.error({ event: 'step_error', runId, step: step.name, error })
      return
    }
  }

  await updateRunStatus(runId, 'completed', 8)
  logger.info({ event: 'pipeline_complete', runId, totalCost })
}

async function updateStepStatus(
  runId: string,
  stepNumber: number,
  status: string,
  extra?: { costEur?: number; outputData?: unknown; error?: string },
) {
  const updates: Record<string, unknown> = { status }
  if (status === 'running') updates.startedAt = new Date()
  if (status === 'completed' || status === 'failed') updates.completedAt = new Date()
  if (extra?.costEur != null) updates.costEur = extra.costEur
  if (extra?.outputData != null) updates.outputData = extra.outputData
  if (extra?.error) updates.error = extra.error

  await db
    .update(runStep)
    .set(updates)
    .where(and(eq(runStep.runId, runId), eq(runStep.stepNumber, stepNumber)))
}
