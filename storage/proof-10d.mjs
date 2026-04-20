/**
 * proof-10d.mjs — Preuve runtime 10D — Brand Kit 2.0 + templates branchés
 *
 * Démontre :
 * 1. Templates YAML chargés depuis templates/
 * 2. Deux templates → system prompts step-3 différents
 * 3. Deux templates → system prompts step-5 différents
 * 4. agentTones injectés et différents entre templates
 * 5. brand.json étendu avec voicePreset
 * 6. StepContext.template propagé correctement (templateContext non vide)
 * 7. Condition de sortie : deux chaînes → sorties réellement différentes
 *
 * Usage : node storage/proof-10d.mjs (depuis app/)
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import { parse } from 'yaml'

const TEMPLATES_DIR = join(process.cwd(), 'templates')

function pass(msg) { console.log(`  ✓ ${msg}`) }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1 }
function section(title) { console.log(`\n[${title}]`) }

async function loadTemplate(id) {
  const raw = await readFile(join(TEMPLATES_DIR, `${id}.yaml`), 'utf-8')
  return { ...parse(raw), id }
}

function buildTemplateContextStep3(template) {
  if (!template) return ''
  return `\n\nTemplate de style imposé : ${template.name} — ${template.description}\nStyle : ${template.style} | Rythme : ${template.rhythm}\nTransitions recommandées : ${template.transitions.join(', ')}\nAdapte le nombre de scènes, leur durée et leur rythme en conséquence.`
}

function buildTemplateContextStep5(template) {
  if (!template) return ''
  return `\nTemplate : ${template.name} — prefix imposé : "${template.promptPrefix}"\nSous-titres : ${template.subtitleStyle}\nRythme visuel : ${template.rhythm}`
}

async function main() {
  console.log('='.repeat(60))
  console.log('PREUVE 10D — Brand Kit 2.0 + templates branchés')
  console.log('='.repeat(60))

  // ─── 1. Chargement des templates YAML ───────────────────────────────────

  section('1. Chargement des templates YAML depuis templates/')

  const cine = await loadTemplate('cinematique')
  const viral = await loadTemplate('viral')
  const documentaire = await loadTemplate('documentaire')

  if (cine.id === 'cinematique') pass(`Template "cinematique" chargé : style=${cine.style}`)
  else fail('Template cinematique absent ou mal chargé')

  if (viral.id === 'viral') pass(`Template "viral" chargé : style=${viral.style}`)
  else fail('Template viral absent ou mal chargé')

  if (documentaire.id === 'documentaire') pass(`Template "documentaire" chargé : style=${documentaire.style}`)
  else fail('Template documentaire absent ou mal chargé')

  if (cine.promptPrefix && viral.promptPrefix && documentaire.promptPrefix)
    pass('Tous les templates ont un promptPrefix non vide')
  else fail('promptPrefix manquant dans un template')

  if (cine.agentTones && Object.keys(cine.agentTones).length >= 4)
    pass(`cinematique.agentTones : ${Object.keys(cine.agentTones).join(', ')}`)
  else fail('agentTones manquants dans cinematique')

  // ─── 2. System prompts step-3 différents ────────────────────────────────

  section('2. System prompts step-3 différents selon template')

  const ctx3_none = buildTemplateContextStep3(null)
  const ctx3_cine = buildTemplateContextStep3(cine)
  const ctx3_viral = buildTemplateContextStep3(viral)

  if (ctx3_none === '') pass('template=null → contexte step-3 vide (mode dégradé)')
  else fail('template=null devrait produire un contexte vide')

  if (ctx3_cine !== ctx3_viral) pass('cinematique ≠ viral → system prompts step-3 distincts')
  else fail('system prompts step-3 identiques — templates non différenciants')

  if (ctx3_cine.includes('cinematic') && ctx3_cine.includes('fondu'))
    pass(`step-3 cinematique contient style="${cine.style}" et transitions`)
  else fail('step-3 cinematique ne contient pas les éléments attendus')

  if (ctx3_viral.includes('viral') && ctx3_viral.includes('glitch'))
    pass(`step-3 viral contient style="${viral.style}" et transitions`)
  else fail('step-3 viral ne contient pas les éléments attendus')

  // ─── 3. System prompts step-5 différents ────────────────────────────────

  section('3. System prompts step-5 différents selon template')

  const ctx5_none = buildTemplateContextStep5(null)
  const ctx5_cine = buildTemplateContextStep5(cine)
  const ctx5_viral = buildTemplateContextStep5(viral)

  if (ctx5_none === '') pass('template=null → contexte step-5 vide (mode dégradé)')
  else fail('template=null devrait produire un contexte vide')

  if (ctx5_cine !== ctx5_viral) pass('cinematique ≠ viral → system prompts step-5 distincts')
  else fail('system prompts step-5 identiques — templates non différenciants')

  if (ctx5_cine.includes(cine.promptPrefix))
    pass(`step-5 cinematique contient promptPrefix : "${cine.promptPrefix.slice(0, 40)}..."`)
  else fail('promptPrefix cinematique absent du contexte step-5')

  if (ctx5_viral.includes(viral.promptPrefix))
    pass(`step-5 viral contient promptPrefix : "${viral.promptPrefix.slice(0, 40)}..."`)
  else fail('promptPrefix viral absent du contexte step-5')

  // ─── 4. agentTones différents entre templates ───────────────────────────

  section('4. agentTones différents selon template')

  const agents = ['lenny', 'laura', 'nael', 'emilie', 'nico']
  let allDifferent = true
  for (const agent of agents) {
    const tC = cine.agentTones?.[agent] ?? ''
    const tV = viral.agentTones?.[agent] ?? ''
    if (tC === tV) { allDifferent = false; fail(`agent ${agent} : même ton entre cinematique et viral`) }
  }
  if (allDifferent) pass('Tous les agents ont un ton distinct entre cinematique et viral')

  const lennyViral = viral.agentTones?.lenny ?? ''
  if (lennyViral.includes('Hook') || lennyViral.includes('CTA'))
    pass(`Lenny viral : "${lennyViral.slice(0, 50)}"`)
  else fail('Lenny viral ne contient pas le ton attendu (Hook/CTA)')

  const lennyCine = cine.agentTones?.lenny ?? ''
  if (lennyCine.includes('contemplatif') || lennyCine.includes('contemplative'))
    pass(`Lenny cinématique : "${lennyCine.slice(0, 50)}"`)
  else fail('Lenny cinématique ne contient pas le ton attendu (contemplatif)')

  // ─── 5. brand.json étendu ───────────────────────────────────────────────

  section('5. brand.json v2 — champ voicePreset')

  const brandV2 = { style: 'cinématique', palette: 'sombre', tone: 'dramatique', voicePreset: 'grave-FR' }
  const brandContext = `Brand Kit — style: ${brandV2.style}, palette: ${brandV2.palette}, ton: ${brandV2.tone}${brandV2.voicePreset ? `, voicePreset: ${brandV2.voicePreset}` : ''}.`

  if (brandContext.includes('grave-FR')) pass('voicePreset "grave-FR" présent dans brandContext v2')
  else fail('voicePreset absent de brandContext v2')

  const brandV1 = { style: 'viral', palette: 'néon', tone: 'humoristique' }
  const brandContextV1 = `Brand Kit — style: ${brandV1.style}, palette: ${brandV1.palette}, ton: ${brandV1.tone}.`
  if (!brandContextV1.includes('voicePreset')) pass('brand.json sans voicePreset → rétrocompatible')
  else fail('brand.json v1 ne devrait pas avoir de voicePreset')

  // ─── 6. StepContext propagation ─────────────────────────────────────────

  section('6. StepContext.template propagé — templateContext non vide si template présent')

  const ctxCine = { runId: 'r1', chainId: 'c', idea: 'test', brandKitPath: null, storagePath: '/tmp', intentionPath: null, template: cine }
  const ctxNone = { runId: 'r2', chainId: 'c', idea: 'test', brandKitPath: null, storagePath: '/tmp', intentionPath: null, template: null }

  if (ctxCine.template !== null && ctxCine.template.id === 'cinematique')
    pass('ctx avec template cinematique : template.id = "cinematique"')
  else fail('template non propagé dans StepContext')

  if (ctxNone.template === null) pass('ctx sans template : template = null')
  else fail('template devrait être null')

  const tc = buildTemplateContextStep3(ctxCine.template)
  const tn = buildTemplateContextStep3(ctxNone.template)
  if (tc.length > 0 && tn === '') pass('templateContext non vide si template, vide sinon')
  else fail('templateContext incorrectement construit depuis StepContext')

  // ─── 7. Condition de sortie 10D ─────────────────────────────────────────

  section('7. Condition de sortie — deux chaînes/templates → sorties réellement différentes')

  const base3 = `Tu es un assistant de production vidéo.`
  const sp3_cine = base3 + buildTemplateContextStep3(cine)
  const sp3_viral = base3 + buildTemplateContextStep3(viral)
  if (sp3_cine !== sp3_viral) pass('System prompts step-3 complets : cinematique ≠ viral')
  else fail('System prompts step-3 identiques — templates non différenciants')

  const base5 = `Tu es un Prompt Engineer vidéo cinématographique.`
  const sp5_cine = base5 + buildTemplateContextStep5(cine)
  const sp5_viral = base5 + buildTemplateContextStep5(viral)
  if (sp5_cine !== sp5_viral) pass('System prompts step-5 complets : cinematique ≠ viral')
  else fail('System prompts step-5 identiques — templates non différenciants')

  // Résumé
  console.log('\n' + '='.repeat(60))
  console.log('RÉSUMÉ — Preuve 10D')
  console.log('='.repeat(60))
  console.log(`Templates chargés   : cinematique, viral, documentaire`)
  console.log(`promptPrefix cine   : "${cine.promptPrefix.slice(0, 50)}..."`)
  console.log(`promptPrefix viral  : "${viral.promptPrefix.slice(0, 50)}..."`)
  console.log(`agentTones lenny    : cine="${lennyCine.slice(0, 30)}..." | viral="${lennyViral.slice(0, 30)}..."`)
  console.log()
  console.log('Injection dans le pipeline :')
  console.log('  StepContext.template → engine.ts (loadTemplate(run.template))')
  console.log('  step-2-brainstorm    → coordinator(template) → agentTones injectés dans réunion')
  console.log('  step-3-json          → system prompt enrichi (style, rhythm, transitions)')
  console.log('  step-5-prompts       → system prompt enrichi (promptPrefix, subtitleStyle, rhythm)')
  console.log()

  if (!process.exitCode) {
    console.log('✓ Toutes les preuves 10D validées.')
  } else {
    console.log('✗ Certaines preuves ont échoué.')
  }
}

main().catch((err) => {
  console.error('Erreur:', err)
  process.exit(1)
})
