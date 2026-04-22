import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bootstrapProviders } from '@/lib/providers/bootstrap'
import { step4VisualBlueprint } from '@/lib/pipeline/steps/step-4-visual-blueprint'
import { step4Storyboard } from '@/lib/pipeline/steps/step-4-storyboard'
import type { StepContext } from '@/lib/pipeline/types'

async function main() {
  const runId = `proof-step45-${Date.now()}`
  const storagePath = join(process.cwd(), 'storage', 'runs', runId)

  await mkdir(join(storagePath, 'storyboard'), { recursive: true })
  await mkdir(join(storagePath, 'final'), { recursive: true })

  const structure = {
    title: 'Le chien et la voiture rouge',
    tone: 'simple et chaleureux',
    style: 'storyboard rough noir et blanc',
    scenes: [
      {
        index: 1,
        description: 'Un enfant regarde une voiture rouge devant la maison au petit matin.',
        dialogue: 'La voiture arrive devant chez nous.',
        camera: 'plan large',
        lighting: 'lumiere douce du matin',
        duration_s: 6,
      },
      {
        index: 2,
        description: 'Le chien saute pres du ballon dans le jardin pendant que l enfant rit.',
        dialogue: 'Le chien veut jouer.',
        camera: 'plan moyen',
        lighting: 'lumiere naturelle',
        duration_s: 5,
      },
    ],
  }

  const brief = {
    summary: 'Toujours viser un dessin ultra simple, lisible, comme une feuille de rough pour enfant de 10 ans.',
    sections: [
      { agent: 'nael', title: 'Mise en scene', content: 'Un sujet principal par scene, decor minimal, emotion lisible.' },
      { agent: 'laura', title: 'Cadre', content: 'Plans simples, directs, sans sophistication inutile.' },
    ],
  }

  const directorPlan = {
    runId,
    idea: 'Preuve runtime blueprint/storyboard',
    tone: 'joyeux',
    style: 'simple storyboard',
    creativeDirection: 'Faire tres simple, tres lisible, tres concret.',
    shotList: [
      { sceneIndex: 1, intent: 'Presenter la voiture et l enfant', camera: 'plan large', emotion: 'curiosite', influencedBy: ['nael', 'laura'] },
      { sceneIndex: 2, intent: 'Montrer le jeu du chien', camera: 'plan moyen', emotion: 'joie', influencedBy: ['nael', 'laura'] },
    ],
    generatedAt: new Date().toISOString(),
  }

  await writeFile(join(storagePath, 'structure.json'), JSON.stringify(structure, null, 2))
  await writeFile(join(storagePath, 'brief.json'), JSON.stringify(brief, null, 2))
  await writeFile(join(storagePath, 'director-plan.json'), JSON.stringify(directorPlan, null, 2))

  bootstrapProviders()

  const ctx: StepContext = {
    runId,
    chainId: null,
    idea: 'Preuve runtime blueprint/storyboard',
    brandKitPath: null,
    storagePath,
    intentionPath: null,
    template: null,
  }

  console.log('='.repeat(72))
  console.log('PREUVE RUNTIME CIBLEE - step 4 blueprint + step 5 storyboard')
  console.log('='.repeat(72))
  console.log(`RunId       : ${runId}`)
  console.log(`StoragePath  : ${storagePath}`)

  const blueprintResult = await step4VisualBlueprint.execute(ctx)
  if (!blueprintResult.success) {
    throw new Error(`Blueprint step failed: ${blueprintResult.error}`)
  }

  const storyboardResult = await step4Storyboard.execute(ctx)
  if (!storyboardResult.success) {
    throw new Error(`Storyboard step failed: ${storyboardResult.error}`)
  }

  const blueprint = JSON.parse(await readFile(join(storagePath, 'storyboard-blueprint.json'), 'utf8'))
  const storyboard = JSON.parse(await readFile(join(storagePath, 'storyboard', 'manifest.json'), 'utf8'))

  const blueprintScenes = Array.isArray(blueprint?.scenes) ? blueprint.scenes.length : 0
  const storyboardImages = Array.isArray(storyboard?.images) ? storyboard.images.length : 0
  const cloudStatuses = Array.isArray(storyboard?.images)
    ? storyboard.images.map((img: { cloudPlanStatus?: string | null }) => img.cloudPlanStatus).filter(Boolean)
    : []

  if (blueprintScenes === 0) throw new Error('Blueprint vide')
  if (storyboardImages === 0) throw new Error('Storyboard manifest vide')

  console.log(`Blueprint    : ${blueprintScenes} scene(s)`) 
  console.log(`Storyboard   : ${storyboardImages} image(s)`) 
  console.log(`Source BP    : ${blueprint.source} via ${blueprint.providerUsed}`)
  console.log(`Cloud plan   : ${cloudStatuses.length > 0 ? cloudStatuses.join(', ') : 'aucun statut visible'}`)
  console.log(`Artefact 4   : ${join(storagePath, 'storyboard-blueprint.json')}`)
  console.log(`Artefact 5   : ${join(storagePath, 'storyboard', 'manifest.json')}`)
  console.log('✓ Preuve runtime ciblee OK sur les steps modifies.')
}

main().catch((error) => {
  console.error(`✗ ${error.message}`)
  process.exit(1)
})
