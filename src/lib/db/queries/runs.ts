import { db } from '../connection'
import { run, runStep } from '../schema'
import { eq, desc } from 'drizzle-orm'

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
  const rows = await db.select().from(run).where(eq(run.status, 'running'))
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
