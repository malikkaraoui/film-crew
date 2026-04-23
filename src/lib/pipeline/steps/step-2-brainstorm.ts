import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { MeetingCoordinator } from '@/lib/agents/coordinator'
import { getStepLlmConfig, readProjectConfig } from '@/lib/runs/project-config'
import type { PipelineStep, StepContext, StepResult } from '../types'

export const step2Brainstorm: PipelineStep = {
  name: 'Brainstorm',
  stepNumber: 2,

  async execute(ctx: StepContext): Promise<StepResult> {
    // Charger le Brand Kit si disponible
    let brandKit: string | null = null
    if (ctx.brandKitPath) {
      try {
        const brandPath = join(process.cwd(), ctx.brandKitPath, 'brand.json')
        brandKit = await readFile(brandPath, 'utf-8')
      } catch { /* pas de brand kit */ }
    }

    const projectConfig = await readProjectConfig(ctx.storagePath)
    const stepLlmConfig = getStepLlmConfig(projectConfig, 2)

    const coordinator = new MeetingCoordinator({
      runId: ctx.runId,
      idea: ctx.idea,
      brandKit,
      template: ctx.template,
      referenceImages: projectConfig?.referenceImages ?? null,
      meetingLlmMode: stepLlmConfig?.mode ?? projectConfig?.meetingLlmMode,
      meetingLlmModel: stepLlmConfig?.model ?? projectConfig?.meetingLlmModel,
      outputConfig: projectConfig?.outputConfig ?? null,
    })

    const brief = await coordinator.runMeeting()
    const totalCost = coordinator.getMessages().reduce(
      (sum, m) => sum + (m.metadata?.costEur ?? 0),
      0,
    )

    // Persister le brief pour que step-3-json puisse le lire
    await writeFile(
      join(ctx.storagePath, 'brief.json'),
      JSON.stringify(brief, null, 2),
    )

    // Vérifier que le brief est exploitable
    const nonEmptySections = brief.sections.filter(s => s.content.trim().length > 0)
    if (!brief.summary?.trim() && nonEmptySections.length === 0) {
      return {
        success: false,
        costEur: totalCost,
        outputData: brief,
        error: `Brief vide : summary=${brief.summary?.length ?? 0} chars, sections non-vides=${nonEmptySections.length}/5. Le LLM retourne des réponses vides.`,
      }
    }

    return {
      success: true,
      costEur: totalCost,
      outputData: brief,
    }
  },
}
