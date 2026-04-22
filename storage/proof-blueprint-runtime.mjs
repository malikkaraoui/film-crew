/**
 * proof-blueprint-runtime.mjs
 *
 * Preuve runtime ciblee du nouveau flux 9 etapes :
 * - creation d'un vrai run via l'API
 * - attente du Blueprint visuel + Storyboard
 * - verification des artefacts exposes via API et presents sur disque
 *
 * Usage : node storage/proof-blueprint-runtime.mjs
 * Prerequis : serveur Next.js actif sur http://localhost:3000
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = 'http://localhost:3000'
const POLL_MS = 5000
const WAIT_FOR_BLUEPRINT_STORYBOARD_TIMEOUT_MS = 20 * 60_000
const RUN_STALL_TIMEOUT_MS = 5 * 60_000
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { res, json, text }
}

function pass(message) {
  console.log(`  ✓ ${message}`)
}

function section(title) {
  console.log(`\n[${title}]`)
}

async function main() {
  console.log('='.repeat(72))
  console.log('PREUVE RUNTIME - blueprint visuel / storyboard / prompts')
  console.log('='.repeat(72))

  section('0. Pre-requis - chaine disponible')
  const chainsResp = await fetchJson(`${BASE}/api/chains`)
  if (!chainsResp.res.ok) {
    throw new Error(`GET /api/chains HTTP ${chainsResp.res.status}`)
  }
  const chains = chainsResp.json?.data ?? []
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new Error('Aucune chaine disponible pour lancer un run reel')
  }
  const chainId = chains[0].id
  pass(`Chaine retenue : ${chainId}`)

  section('1. Creation du run reel')
  let runId = null
  const createResp = await fetchJson(`${BASE}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId,
      idea: '[PREUVE-RUNTIME] Blueprint visuel -> storyboard rough -> prompts',
    }),
  })

  if (createResp.res.status === 201 || createResp.res.ok) {
    runId = createResp.json?.data?.id ?? null
    pass(`Run cree : ${runId}`)
  } else if (createResp.res.status === 409) {
    const queueResp = await fetchJson(`${BASE}/api/queue`)
    runId = queueResp.json?.data?.active?.id ?? queueResp.json?.data?.queue?.[0]?.id ?? null
    pass(`Run actif reutilise suite au 409 : ${runId}`)
  } else {
    throw new Error(`POST /api/runs HTTP ${createResp.res.status}: ${createResp.text}`)
  }

  if (!runId) {
    throw new Error('Impossible d obtenir un runId')
  }

  section('2. Attente des artefacts blueprint + storyboard')
  const start = Date.now()
  let lastSnapshot = ''
  let progress = null
  let runData = null
  let deliverable4 = null
  let deliverable5 = null
  let deliverable6 = null
  let lastHeartbeat = null
  let lastTraceCount = -1
  let lastLifeAt = Date.now()

  while (Date.now() - start < WAIT_FOR_BLUEPRINT_STORYBOARD_TIMEOUT_MS) {
    const progressResp = await fetchJson(`${BASE}/api/runs/${runId}/progress`)
    if (!progressResp.res.ok) {
      throw new Error(`GET /api/runs/${runId}/progress HTTP ${progressResp.res.status}`)
    }
    progress = progressResp.json?.data ?? null

    const runResp = await fetchJson(`${BASE}/api/runs/${runId}`)
    if (!runResp.res.ok) {
      throw new Error(`GET /api/runs/${runId} HTTP ${runResp.res.status}`)
    }
    runData = runResp.json?.data ?? null

    const tracesResp = await fetchJson(`${BASE}/api/runs/${runId}/traces`)
    if (!tracesResp.res.ok) {
      throw new Error(`GET /api/runs/${runId}/traces HTTP ${tracesResp.res.status}`)
    }
    const traceCount = Array.isArray(tracesResp.json?.data) ? tracesResp.json.data.length : 0

    const current = progress?.currentStep ?? '?'
    const status = runData?.status ?? progress?.status ?? 'unknown'
    const pct = progress?.progressPct ?? '?'
    const heartbeat = runData?.lastHeartbeat ?? null

    if (heartbeat !== lastHeartbeat || traceCount !== lastTraceCount) {
      lastLifeAt = Date.now()
      lastHeartbeat = heartbeat
      lastTraceCount = traceCount
    }

    const snapshot = `${status}|${current}|${pct}|traces=${traceCount}`

    if (snapshot !== lastSnapshot) {
      console.log(`  · status=${status} step=${current}/9 progress=${pct}% traces=${traceCount}`)
      lastSnapshot = snapshot
    }

    const d4 = await fetchJson(`${BASE}/api/runs/${runId}/deliverables/4`)
    const d5 = await fetchJson(`${BASE}/api/runs/${runId}/deliverables/5`)
    const d6 = await fetchJson(`${BASE}/api/runs/${runId}/deliverables/6`)
    deliverable4 = d4.json?.data ?? null
    deliverable5 = d5.json?.data ?? null
    deliverable6 = d6.json?.data ?? null

    const hasBlueprint = !!deliverable4?.available
    const hasStoryboard = !!deliverable5?.available

    if (hasBlueprint && hasStoryboard) {
      pass('Blueprint visuel + storyboard manifest disponibles via API')
      break
    }

    if (['failed', 'killed'].includes(status)) {
      throw new Error(`Run termine trop tot avec status=${status} avant la preuve blueprint/storyboard`)
    }

    if (Date.now() - lastLifeAt > RUN_STALL_TIMEOUT_MS) {
      throw new Error(
        `Run vivant mais sans signe de vie exploitable depuis > ${Math.round(RUN_STALL_TIMEOUT_MS / 60000)} min (step=${current}, traces=${traceCount}, heartbeat=${heartbeat ?? 'absent'})`,
      )
    }

    await wait(POLL_MS)
  }

  if (!deliverable4?.available || !deliverable5?.available) {
    throw new Error(
      `Timeout : blueprint/storyboard non disponibles dans le delai imparti (${Math.round(WAIT_FOR_BLUEPRINT_STORYBOARD_TIMEOUT_MS / 60000)} min) alors que le run est ${runData?.status ?? progress?.status ?? 'unknown'} en step ${runData?.currentStep ?? progress?.currentStep ?? '?'}`,
    )
  }

  section('3. Verification des artefacts sur disque')
  const storagePath = join(process.cwd(), 'storage', 'runs', runId)
  const blueprint = JSON.parse(await readFile(join(storagePath, 'storyboard-blueprint.json'), 'utf8'))
  const storyboard = JSON.parse(await readFile(join(storagePath, 'storyboard', 'manifest.json'), 'utf8'))

  let prompts = null
  try {
    prompts = JSON.parse(await readFile(join(storagePath, 'prompt-manifest.json'), 'utf8'))
  } catch {
    prompts = null
  }

  const blueprintScenes = Array.isArray(blueprint?.scenes) ? blueprint.scenes.length : 0
  const storyboardImages = Array.isArray(storyboard?.images) ? storyboard.images.length : 0
  const cloudStatuses = Array.isArray(storyboard?.images)
    ? storyboard.images.map((img) => img.cloudPlanStatus).filter(Boolean)
    : []
  const promptCount = Array.isArray(prompts?.prompts) ? prompts.prompts.length : 0

  if (blueprintScenes === 0) throw new Error('storyboard-blueprint.json existe mais ne contient aucune scene')
  if (storyboardImages === 0) throw new Error('storyboard/manifest.json existe mais ne contient aucune image')

  pass(`Blueprint scenes : ${blueprintScenes}`)
  pass(`Storyboard images : ${storyboardImages}`)
  if (promptCount > 0) pass(`Prompt manifest present : ${promptCount} prompt(s)`)
  else pass('Prompt manifest pas encore disponible (acceptable si step 6 non atteint)')
  if (cloudStatuses.length > 0) pass(`Cloud plan visible : ${cloudStatuses.join(', ')}`)
  else pass('Cloud plan pas encore visible a ce stade')

  section('4. Resume')
  console.log(`Run ID             : ${runId}`)
  console.log(`Status courant     : ${progress?.status ?? 'unknown'}`)
  console.log(`Current step       : ${progress?.currentStep ?? '?'} / 9`)
  console.log(`Deliverable step 4 : ${deliverable4?.summary ?? 'n/a'}`)
  console.log(`Deliverable step 5 : ${deliverable5?.summary ?? 'n/a'}`)
  console.log(`Deliverable step 6 : ${deliverable6?.summary ?? 'n/a'}`)
  console.log(`Blueprint path     : ${join(storagePath, 'storyboard-blueprint.json')}`)
  console.log(`Storyboard path    : ${join(storagePath, 'storyboard', 'manifest.json')}`)
  if (promptCount > 0) {
    console.log(`Prompts path       : ${join(storagePath, 'prompt-manifest.json')}`)
  }
  console.log('\n✓ Validation runtime ciblee reussie jusqu au couple blueprint/storyboard.')
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
