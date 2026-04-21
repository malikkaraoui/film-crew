import { NextResponse } from 'next/server'
import { db } from '@/lib/db/connection'
import { run, runStep, chain } from '@/lib/db/schema'
import { logger } from '@/lib/logger'

const STEP_NAMES = [
  'Idée',
  'Brainstorm',
  'JSON structuré',
  'Storyboard',
  'Prompts Seedance',
  'Génération',
  'Preview',
  'Publication',
]

/**
 * POST /api/dev/seed-zombie
 *
 * Crée un run zombie (status='running', lastHeartbeat=null) directement en DB.
 * Uniquement disponible en développement. Utilisé par proof-12c.mjs.
 */
export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
  }

  try {
    // Trouver une chaîne existante
    const chains = await db.select({ id: chain.id }).from(chain).limit(1)
    if (chains.length === 0) {
      return NextResponse.json(
        { error: { code: 'NO_CHAIN', message: 'Aucune chaîne disponible pour créer un zombie' } },
        { status: 409 },
      )
    }

    const chainId = chains[0].id
    const runId = `zombie-proof-${Date.now()}`
    const ZOMBIE_STEP = 2 // simuler une interruption pendant le step 2

    // Insérer le run directement en status='running', lastHeartbeat=null (zombie pur)
    await db.insert(run).values({
      id: runId,
      chainId,
      type: 'standard',
      idea: '[PREUVE-12C] Zombie test — interruption simulée step 2',
      status: 'running',
      currentStep: ZOMBIE_STEP,
      lastHeartbeat: null,
    })

    // Créer les runSteps (step 1 completed, step 2 running, reste pending)
    for (let i = 0; i < STEP_NAMES.length; i++) {
      const stepNumber = i + 1
      const status = stepNumber < ZOMBIE_STEP ? 'completed' : stepNumber === ZOMBIE_STEP ? 'running' : 'pending'
      await db.insert(runStep).values({
        id: crypto.randomUUID(),
        runId,
        stepNumber,
        stepName: STEP_NAMES[i],
        status,
        startedAt: stepNumber <= ZOMBIE_STEP ? new Date() : null,
        completedAt: stepNumber < ZOMBIE_STEP ? new Date() : null,
      })
    }

    logger.info({ event: 'zombie_seeded', runId, chainId, zombieStep: ZOMBIE_STEP })
    return NextResponse.json({ data: { runId, chainId, zombieStep: ZOMBIE_STEP } }, { status: 201 })
  } catch (e) {
    logger.error({ event: 'zombie_seed_error', message: (e as Error).message })
    return NextResponse.json(
      { error: { code: 'SEED_ERROR', message: (e as Error).message } },
      { status: 500 },
    )
  }
}
