import { db } from '../connection'
import { run, runStep } from '../schema'
import { eq, desc, or, inArray, and, lt, isNull } from 'drizzle-orm'

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

export async function getRuns() {
  return db.select().from(run).orderBy(desc(run.createdAt))
}

export async function getRunById(id: string) {
  const rows = await db.select().from(run).where(eq(run.id, id))
  return rows[0] ?? null
}

export async function getRunSteps(runId: string) {
  return db.select().from(runStep).where(eq(runStep.runId, runId)).orderBy(runStep.stepNumber)
}

export async function getActiveRun() {
  const rows = await db.select().from(run).where(
    or(eq(run.status, 'running'), eq(run.status, 'pending'))
  )
  return rows[0] ?? null
}

export async function createRun(data: {
  id: string
  chainId: string
  type?: string
  idea: string
  template?: string
}) {
  const [row] = await db.insert(run).values({
    ...data,
    type: data.type || 'standard',
    status: 'pending',
  }).returning()

  // Créer les 8 étapes
  for (let i = 0; i < STEP_NAMES.length; i++) {
    await db.insert(runStep).values({
      id: crypto.randomUUID(),
      runId: data.id,
      stepNumber: i + 1,
      stepName: STEP_NAMES[i],
      status: 'pending',
    })
  }

  return row
}

export async function updateRunStatus(id: string, status: string, currentStep?: number) {
  const updates: Record<string, unknown> = { status, updatedAt: new Date() }
  if (currentStep !== undefined) updates.currentStep = currentStep
  if (status === 'running') updates.lastHeartbeat = new Date()

  const [row] = await db.update(run).set(updates).where(eq(run.id, id)).returning()
  return row
}

export async function updateRunCost(id: string, costEur: number) {
  const [row] = await db
    .update(run)
    .set({ costEur, updatedAt: new Date() })
    .where(eq(run.id, id))
    .returning()
  return row
}

export async function deleteRun(id: string) {
  await db.delete(run).where(eq(run.id, id))
}

/** Retourne les runs zombies : status='running' avec heartbeat stale (>5min) ou absent (12C). */
export async function getZombieRuns(thresholdMs = 5 * 60_000) {
  const cutoff = new Date(Date.now() - thresholdMs)
  return db
    .select()
    .from(run)
    .where(
      and(
        eq(run.status, 'running'),
        or(isNull(run.lastHeartbeat), lt(run.lastHeartbeat, cutoff)),
      ),
    )
}

/**
 * Marque un run comme failed et persiste le message d'erreur sur le runStep courant (12C).
 * Le message est lisible via GET /api/runs/{id}/progress → steps[].error
 */
export async function markRunFailed(id: string, error: string) {
  // Récupérer currentStep du run pour savoir où persister l'erreur
  const runRows = await db.select({ currentStep: run.currentStep }).from(run).where(eq(run.id, id))
  const currentStep = runRows[0]?.currentStep ?? 1

  // Persister le message d'erreur sur le runStep courant
  await db
    .update(runStep)
    .set({ status: 'failed', error, completedAt: new Date() })
    .where(and(eq(runStep.runId, id), eq(runStep.stepNumber, currentStep)))

  // Marquer le run failed
  const [row] = await db
    .update(run)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(run.id, id))
    .returning()
  return row ?? null
}

/** Retourne les runs en attente (pending) et en cours (running) pour la vue queue (12A). */
export async function getQueueRuns() {
  return db
    .select()
    .from(run)
    .where(inArray(run.status, ['pending', 'running']))
    .orderBy(run.createdAt)
}
