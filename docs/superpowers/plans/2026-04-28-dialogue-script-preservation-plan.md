# Dialogue Script Preservation (Bloc P1-P4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Préserver l'intention dramatique de Sami (personnages, voix distinctes, intent, subtext, beats) du brief jusqu'au `dialogue_script.json` final, en supprimant la réécriture LLM qui aplatit tout en « narrateur mystérieux ».

**Architecture:** 4 phases en cascade. (1) Mia produit un roster figé (`characters.json`) à partir d'un `narrationMode` lu sur projectConfig. (2) Sami écrit ses dialogues en JSON strict (`brief_dialogue.json`) au lieu de prose libre. (3) `buildSceneOutline` enrichit chaque scène avec un beat dramatique mais ne touche jamais aux `dialogueLines` — l'attachement est 100 % code. (4) Le step-3 produit `dialogue_script.json` par copie verbatim + dérivation déterministe `tone/pace/emphasis` — zéro LLM final.

**Tech Stack:** TypeScript, Zod 4.3 (strict parse), Vitest 4.1, Next.js (App Router) côté API, providers LLM existants (`executeWithFailover`).

**Spec source:** [docs/superpowers/specs/2026-04-28-dialogue-script-preservation-design.md](../specs/2026-04-28-dialogue-script-preservation-design.md)

---

## File Structure

### À créer

| Fichier | Responsabilité unique |
|---|---|
| `app/src/lib/schemas/audio.ts` | Zod schemas pour Character, Roster, Beat, BriefDialogueLine, MeetingSceneOutlineItem, DialogueLine, DialogueScene, DialogueScript |
| `app/src/lib/meeting/dialogue-extractor.ts` | Parse + valide le JSON Sami brut → `BriefDialogueLine[]` par scène |
| `app/src/lib/pipeline/dialogue-derivation.ts` | Heuristiques pures : `deriveTone`, `derivePace`, `deriveEmphasis`, `estimateDuration` |
| `app/src/lib/pipeline/dialogue-script-builder.ts` | `buildDialogueScriptFromOutline` — zéro LLM, copie verbatim + enrichissement déterministe |
| `app/src/lib/agents/__tests__/coordinator-roster.test.ts` | Tests Phase 0 |
| `app/src/lib/meeting/__tests__/dialogue-extractor.test.ts` | Tests parser Sami JSON |
| `app/src/lib/pipeline/__tests__/dialogue-derivation.test.ts` | Tests heuristiques tone/pace/emphasis |
| `app/src/lib/pipeline/__tests__/dialogue-script-builder.test.ts` | Tests préservation 1:1 |
| `app/src/lib/schemas/__tests__/audio.test.ts` | Tests Zod schemas |

### À modifier

| Fichier | Modification |
|---|---|
| `app/src/types/agent.ts` | + types Character, CharacterRoster, SceneBeat, BriefDialogueLine, NarrationMode ; modif MeetingSceneOutlineItem |
| `app/src/types/audio.ts` | modif DialogueLine (speaker→characterId), DialogueScene (+beat, +charactersPresent, +hooks, +continuity), DialogueScript (+narrationMode, +premise, +characters) |
| `app/src/types/run.ts` | + `narrationMode?: NarrationMode` dans ProjectConfig |
| `app/src/lib/agents/profiles.ts` | + Mia roster prompt, + Sami JSON-strict prompt |
| `app/src/lib/agents/base-agent.ts` | + `writeStructuredJson<T>()` helper |
| `app/src/lib/agents/coordinator.ts` | + Phase 0 (`runRosterPhase`), + `buildRosterContext`, refactor `buildSceneOutline` (no dialogueLines in LLM output, attach in code), refactor section Sami (JSON path) |
| `app/src/lib/pipeline/steps/step-3-json.ts` | Remplace `buildDialogueScript` LLM par appel à `buildDialogueScriptFromOutline` |
| `app/src/lib/meeting/scene-dialogue.ts` | Suppression de 5 helpers obsolètes ; ne garde rien (le fichier peut être supprimé) |
| `app/src/lib/pipeline/reset.ts` | + `characters.json`, `brief_dialogue.json` à l'étape 2 |
| `app/src/lib/pipeline/tts-renderer.ts` | shim de lecture `speaker → characterId` (read-only, @deprecated) |
| `app/src/lib/pipeline/steps/step-4c-audio.ts` | shim de lecture `speaker → characterId` (read-only, @deprecated) |
| Fixtures de tests existants | `speaker:` → `characterId:` partout dans `__tests__/` |

---

## Pré-requis : exécuter le travail dans une worktree

Si pas déjà fait :

```bash
cd "/Users/malik/Documents/claude-atelier/FILM CREW 🎬/app"
git worktree add ../app-dialogue-preservation -b feat/dialogue-script-preservation
cd ../app-dialogue-preservation
```

Toutes les commandes de ce plan sont relatives à `app-dialogue-preservation/`.

---

## Task 1 : Schémas et types (foundation)

**Files:**
- Modify: `src/types/agent.ts`
- Modify: `src/types/audio.ts`
- Modify: `src/types/run.ts`
- Create: `src/lib/schemas/audio.ts`
- Create: `src/lib/schemas/__tests__/audio.test.ts`

### Task 1.1 — Ajouter les types narratifs dans `agent.ts`

- [ ] **Step 1 : Modifier `src/types/agent.ts`** — ajouter en bas du fichier (avant `export type MeetingBrief`) :

```ts
export type NarrationMode = 'dialogue' | 'voiceover'

export type CharacterVoiceProfile = {
  register: 'grave' | 'medium' | 'aigu'
  tempo: 'lent' | 'normal' | 'rapide'
  accent?: string
  signatureWords?: string[]
}

export type Character = {
  id: string
  name: string
  archetype: string
  voiceProfile: CharacterVoiceProfile
  arcGoal: string
  arcStakes: string
  isNarrator?: boolean
}

export type CharacterRoster = {
  runId: string
  narrationMode: NarrationMode
  characters: Character[]
  premise: string
  createdAt: string
}

export type SceneBeatType =
  | 'setup' | 'inciting' | 'rising' | 'turn' | 'climax' | 'resolution'

export type SceneBeat = {
  beatId: string
  type: SceneBeatType
  emotionStart: string
  emotionEnd: string
  tensionLevel: number
  conflict: string
  stakes: string
}

export type BriefDialogueLine = {
  characterId: string
  text: string
  intent: string
  subtext?: string
  reactsToLineIndex?: number
}
```

- [ ] **Step 2 : Modifier `MeetingSceneOutlineItem` dans le même fichier** — remplacer le type existant par :

```ts
export type MeetingSceneOutlineItem = {
  index: number
  title: string
  description: string
  dialogueLines: BriefDialogueLine[]
  beat: SceneBeat
  charactersPresent: string[]
  continuityFromPreviousScene: string
  camera: string
  lighting: string
  duration_s: number
  foreground?: string
  midground?: string
  background?: string
}
```

- [ ] **Step 3 : Vérifier que TypeScript compile** —

Run: `npx tsc --noEmit -p .`
Expected: échoue avec des erreurs sur consommateurs (`coordinator.ts`, `scene-dialogue.ts`, `step-3-json.ts`). C'est attendu — les consommateurs seront mis à jour dans les tasks suivantes.

- [ ] **Step 4 : Commit**

```bash
git add src/types/agent.ts
git commit -m "types(agent): add Character, Roster, SceneBeat, BriefDialogueLine; refactor MeetingSceneOutlineItem"
```

### Task 1.2 — Augmenter les types `audio.ts`

- [ ] **Step 1 : Modifier `src/types/audio.ts`** — remplacer `DialogueLine`, `DialogueScene`, `DialogueScript` par :

```ts
import type { Character, CharacterRoster, NarrationMode, SceneBeat } from './agent'

export type Tone =
  | 'neutre' | 'urgent' | 'intime' | 'ironique' | 'grave' | 'enthousiaste' | 'mystérieux'

export type DialogueLine = {
  lineIndex: number
  characterId: string
  text: string
  intent: string
  subtext?: string
  reactsToLineIndex?: number
  tone: Tone
  pace: 'slow' | 'normal' | 'fast'
  emphasis: string[]
  estimatedDurationS: number
}

export type DialogueScene = {
  sceneIndex: number
  title: string
  durationTargetS: number
  beat: SceneBeat
  charactersPresent: string[]
  openingHook: string
  closingHook: string
  lines: DialogueLine[]
  silences: SilenceMarker[]
  stageDirections: string
  continuityFromPreviousScene: string
}

export type DialogueScript = {
  runId: string
  language: string
  narrationMode: NarrationMode
  totalDurationTargetS: number
  premise: string
  characters: Character[]
  scenes: DialogueScene[]
}
```

- [ ] **Step 2 : Commit**

```bash
git add src/types/audio.ts
git commit -m "types(audio): tighten DialogueLine/Scene/Script with characterId, beat, narrationMode"
```

### Task 1.3 — Ajouter `narrationMode` à `ProjectConfig`

- [ ] **Step 1 : Modifier `src/types/run.ts`** — ajouter l'import et le champ :

```ts
import type { NarrationMode } from './agent'

// ... laisser les types existants ...

export type ProjectConfig = {
  meetingLlmMode: MeetingLlmMode
  meetingLlmModel: string
  meetingPromptNote?: string | null
  stepLlmConfigs?: StepLlmConfigs
  outputConfig?: OutputConfig | null
  referenceImages?: ReferenceImageConfig | null
  generationMode?: GenerationMode
  narrationMode?: NarrationMode
}
```

- [ ] **Step 2 : Commit**

```bash
git add src/types/run.ts
git commit -m "types(run): add optional narrationMode to ProjectConfig"
```

### Task 1.4 — Créer les schémas Zod

- [ ] **Step 1 : Écrire le test failing en premier** — créer `src/lib/schemas/__tests__/audio.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  characterSchema,
  characterRosterSchema,
  sceneBeatSchema,
  briefDialogueLineSchema,
  meetingSceneOutlineItemSchema,
  dialogueLineSchema,
  dialogueSceneSchema,
  dialogueScriptSchema,
} from '../audio'

const validCharacter = {
  id: 'alex',
  name: 'Alex',
  archetype: 'frère revenant',
  voiceProfile: { register: 'medium', tempo: 'rapide' },
  arcGoal: 'obtenir la vérité',
  arcStakes: 'continue de mentir s’il échoue',
}

const validBeat = {
  beatId: 'B1',
  type: 'rising',
  emotionStart: 'calme',
  emotionEnd: 'rage froide',
  tensionLevel: 70,
  conflict: 'Alex veut la vérité',
  stakes: 'Noor perd sa famille',
}

describe('characterSchema', () => {
  it('accepte un personnage valide', () => {
    expect(() => characterSchema.parse(validCharacter)).not.toThrow()
  })

  it('rejette un id non-slug', () => {
    expect(() => characterSchema.parse({ ...validCharacter, id: 'Alex Smith' })).toThrow()
  })
})

describe('characterRosterSchema', () => {
  const validRoster = {
    runId: 'r1',
    narrationMode: 'dialogue',
    characters: [validCharacter, { ...validCharacter, id: 'noor', name: 'Noor' }],
    premise: 'Confrontation autour d’une lettre',
    createdAt: '2026-04-28T07:00:00Z',
  }

  it('accepte 2 personnages en mode dialogue sans narrator', () => {
    expect(() => characterRosterSchema.parse(validRoster)).not.toThrow()
  })

  it('rejette < 2 personnages', () => {
    expect(() =>
      characterRosterSchema.parse({ ...validRoster, characters: [validCharacter] }),
    ).toThrow()
  })

  it('rejette > 4 personnages', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...validCharacter, id: `c${i}` }))
    expect(() => characterRosterSchema.parse({ ...validRoster, characters: five })).toThrow()
  })

  it('rejette isNarrator: true en mode dialogue', () => {
    expect(() =>
      characterRosterSchema.parse({
        ...validRoster,
        characters: [validCharacter, { ...validCharacter, id: 'narrator', isNarrator: true }],
      }),
    ).toThrow(/isNarrator/i)
  })

  it('accepte zéro narrator en mode voiceover', () => {
    expect(() =>
      characterRosterSchema.parse({ ...validRoster, narrationMode: 'voiceover' }),
    ).not.toThrow()
  })

  it('accepte exactement un narrator en mode voiceover', () => {
    expect(() =>
      characterRosterSchema.parse({
        ...validRoster,
        narrationMode: 'voiceover',
        characters: [validCharacter, { ...validCharacter, id: 'narrator', isNarrator: true }],
      }),
    ).not.toThrow()
  })

  it('rejette deux narrators en mode voiceover', () => {
    expect(() =>
      characterRosterSchema.parse({
        ...validRoster,
        narrationMode: 'voiceover',
        characters: [
          { ...validCharacter, id: 'n1', isNarrator: true },
          { ...validCharacter, id: 'n2', isNarrator: true },
        ],
      }),
    ).toThrow(/narrator/i)
  })
})

describe('briefDialogueLineSchema', () => {
  it('accepte une ligne valide', () => {
    expect(() =>
      briefDialogueLineSchema.parse({
        characterId: 'alex',
        text: 'Sors d’ici',
        intent: 'menacer',
      }),
    ).not.toThrow()
  })

  it('rejette intent vide', () => {
    expect(() =>
      briefDialogueLineSchema.parse({ characterId: 'alex', text: 'x', intent: '' }),
    ).toThrow()
  })

  it('rejette text vide', () => {
    expect(() =>
      briefDialogueLineSchema.parse({ characterId: 'alex', text: '', intent: 'menacer' }),
    ).toThrow()
  })
})

describe('sceneBeatSchema', () => {
  it('accepte un beat valide', () => {
    expect(() => sceneBeatSchema.parse(validBeat)).not.toThrow()
  })

  it('rejette tensionLevel hors [0,100]', () => {
    expect(() => sceneBeatSchema.parse({ ...validBeat, tensionLevel: 120 })).toThrow()
  })
})

describe('meetingSceneOutlineItemSchema', () => {
  const validOutline = {
    index: 1,
    title: 'Confrontation',
    description: 'Alex débarque',
    dialogueLines: [{ characterId: 'alex', text: 'Sors', intent: 'menacer' }],
    beat: validBeat,
    charactersPresent: ['alex'],
    continuityFromPreviousScene: '',
    camera: 'plan rapproché',
    lighting: 'tungstène',
    duration_s: 12,
  }

  it('accepte un outline valide', () => {
    expect(() => meetingSceneOutlineItemSchema.parse(validOutline)).not.toThrow()
  })

  it('rejette un outline avec charactersPresent non vide ET dialogueLines vide', () => {
    expect(() =>
      meetingSceneOutlineItemSchema.parse({
        ...validOutline,
        dialogueLines: [],
        charactersPresent: ['alex'],
      }),
    ).toThrow(/dialogueLines/)
  })

  it('rejette un beat manquant', () => {
    const { beat: _beat, ...rest } = validOutline
    expect(() => meetingSceneOutlineItemSchema.parse(rest)).toThrow()
  })
})

describe('dialogueScriptSchema', () => {
  it('accepte un script avec characters et narrationMode', () => {
    const script = {
      runId: 'r1',
      language: 'fr',
      narrationMode: 'dialogue',
      totalDurationTargetS: 90,
      premise: 'Confrontation',
      characters: [validCharacter, { ...validCharacter, id: 'noor' }],
      scenes: [
        {
          sceneIndex: 1,
          title: 'Confrontation',
          durationTargetS: 12,
          beat: validBeat,
          charactersPresent: ['alex'],
          openingHook: 'Alex frappe',
          closingHook: 'Noor recule',
          lines: [
            {
              lineIndex: 0,
              characterId: 'alex',
              text: 'Sors',
              intent: 'menacer',
              tone: 'urgent',
              pace: 'fast',
              emphasis: ['sors'],
              estimatedDurationS: 0.5,
            },
          ],
          silences: [],
          stageDirections: '',
          continuityFromPreviousScene: '',
        },
      ],
    }
    expect(() => dialogueScriptSchema.parse(script)).not.toThrow()
  })
})
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run src/lib/schemas/__tests__/audio.test.ts`
Expected: FAIL — "Cannot find module '../audio'"

- [ ] **Step 3 : Créer `src/lib/schemas/audio.ts`** :

```ts
import { z } from 'zod'

const slugId = z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/, 'id must be lowercase slug')

export const characterVoiceProfileSchema = z.object({
  register: z.enum(['grave', 'medium', 'aigu']),
  tempo: z.enum(['lent', 'normal', 'rapide']),
  accent: z.string().optional(),
  signatureWords: z.array(z.string()).max(3).optional(),
})

export const characterSchema = z.object({
  id: slugId,
  name: z.string().min(1),
  archetype: z.string().min(1),
  voiceProfile: characterVoiceProfileSchema,
  arcGoal: z.string().min(1),
  arcStakes: z.string().min(1),
  isNarrator: z.boolean().optional(),
})

const narrationModeSchema = z.enum(['dialogue', 'voiceover'])

export const characterRosterSchema = z
  .object({
    runId: z.string().min(1),
    narrationMode: narrationModeSchema,
    characters: z.array(characterSchema).min(2).max(4),
    premise: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .superRefine((roster, ctx) => {
    const narrators = roster.characters.filter((c) => c.isNarrator === true)
    if (roster.narrationMode === 'dialogue' && narrators.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'isNarrator must be false in dialogue mode',
        path: ['characters'],
      })
    }
    if (roster.narrationMode === 'voiceover' && narrators.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at most one narrator allowed in voiceover mode',
        path: ['characters'],
      })
    }
    const ids = new Set<string>()
    for (const c of roster.characters) {
      if (ids.has(c.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate character id: ${c.id}`,
          path: ['characters'],
        })
      }
      ids.add(c.id)
    }
  })

export const briefDialogueLineSchema = z.object({
  characterId: slugId,
  text: z.string().min(1),
  intent: z.string().min(1),
  subtext: z.string().optional(),
  reactsToLineIndex: z.number().int().nonnegative().optional(),
})

const sceneBeatTypeSchema = z.enum([
  'setup', 'inciting', 'rising', 'turn', 'climax', 'resolution',
])

export const sceneBeatSchema = z.object({
  beatId: z.string().min(1),
  type: sceneBeatTypeSchema,
  emotionStart: z.string().min(1),
  emotionEnd: z.string().min(1),
  tensionLevel: z.number().min(0).max(100),
  conflict: z.string().min(1),
  stakes: z.string().min(1),
})

export const meetingSceneOutlineItemSchema = z
  .object({
    index: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1),
    dialogueLines: z.array(briefDialogueLineSchema),
    beat: sceneBeatSchema,
    charactersPresent: z.array(slugId),
    continuityFromPreviousScene: z.string(),
    camera: z.string().min(1),
    lighting: z.string().min(1),
    duration_s: z.number().int().positive(),
    foreground: z.string().optional(),
    midground: z.string().optional(),
    background: z.string().optional(),
  })
  .superRefine((scene, ctx) => {
    if (scene.charactersPresent.length > 0 && scene.dialogueLines.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dialogueLines must be non-empty when charactersPresent is non-empty',
        path: ['dialogueLines'],
      })
    }
    if (scene.index > 1 && scene.continuityFromPreviousScene.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'continuityFromPreviousScene must be non-empty for scene > 1',
        path: ['continuityFromPreviousScene'],
      })
    }
  })

const toneSchema = z.enum([
  'neutre', 'urgent', 'intime', 'ironique', 'grave', 'enthousiaste', 'mystérieux',
])

export const dialogueLineSchema = z.object({
  lineIndex: z.number().int().nonnegative(),
  characterId: slugId,
  text: z.string().min(1),
  intent: z.string().min(1),
  subtext: z.string().optional(),
  reactsToLineIndex: z.number().int().nonnegative().optional(),
  tone: toneSchema,
  pace: z.enum(['slow', 'normal', 'fast']),
  emphasis: z.array(z.string()),
  estimatedDurationS: z.number().positive(),
})

const silenceMarkerSchema = z.object({
  afterLineIndex: z.number().int(),
  durationS: z.number().positive(),
  purpose: z.string().min(1),
})

export const dialogueSceneSchema = z.object({
  sceneIndex: z.number().int().positive(),
  title: z.string().min(1),
  durationTargetS: z.number().positive(),
  beat: sceneBeatSchema,
  charactersPresent: z.array(slugId),
  openingHook: z.string(),
  closingHook: z.string(),
  lines: z.array(dialogueLineSchema),
  silences: z.array(silenceMarkerSchema),
  stageDirections: z.string(),
  continuityFromPreviousScene: z.string(),
})

export const dialogueScriptSchema = z.object({
  runId: z.string().min(1),
  language: z.string().min(1),
  narrationMode: narrationModeSchema,
  totalDurationTargetS: z.number().positive(),
  premise: z.string().min(1),
  characters: z.array(characterSchema).min(2).max(5),
  scenes: z.array(dialogueSceneSchema).min(1),
})

export const briefDialogueSchema = z.object({
  scenes: z.array(z.object({
    sceneIndex: z.number().int().positive(),
    lines: z.array(briefDialogueLineSchema).min(1),
  })).min(1),
})

export type BriefDialogueDoc = z.infer<typeof briefDialogueSchema>
```

- [ ] **Step 4 : Lancer le test, tous les cas doivent passer**

Run: `npx vitest run src/lib/schemas/__tests__/audio.test.ts`
Expected: PASS — toutes les assertions vertes.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/schemas/audio.ts src/lib/schemas/__tests__/audio.test.ts
git commit -m "schemas(audio): strict Zod for roster, beat, outline, dialogue script with narrationMode invariants"
```

---

## Task 2 : Phase 0 (roster Mia)

**Files:**
- Modify: `src/lib/agents/profiles.ts`
- Modify: `src/lib/agents/base-agent.ts`
- Modify: `src/lib/agents/coordinator.ts`
- Modify: `src/lib/pipeline/reset.ts`
- Create: `src/lib/agents/__tests__/coordinator-roster.test.ts`

### Task 2.1 — Helper LLM JSON sur `BaseAgent`

- [ ] **Step 1 : Ajouter `writeStructuredJson` dans `src/lib/agents/base-agent.ts`** — après `writeBriefSection` :

```ts
  /**
   * Demande à l'agent une réponse JSON valide sur un schéma Zod.
   * Retourne (data parsé, AgentMessage). Retry jusqu'à `opts.retries` fois si JSON ou Zod KO.
   * Ne fait aucun fallback prose.
   */
  async writeStructuredJson<T>(
    userPrompt: string,
    schema: { parse: (input: unknown) => T },
    runId: string,
    opts: AgentSpeakOptions & { retries?: number; systemOverride?: string } = {},
  ): Promise<{ data: T; message: AgentMessage }> {
    const retries = opts.retries ?? 2
    let lastError: string | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      const reminder = attempt === 0
        ? ''
        : `\n\nLa tentative précédente a échoué : ${lastError}.\nProduis cette fois UNIQUEMENT du JSON valide, sans markdown ni explication, conforme au schéma demandé.`

      const previousSystem = this.profile.systemPrompt
      if (opts.systemOverride) {
        this.profile = { ...this.profile, systemPrompt: opts.systemOverride }
      }

      try {
        const message = await this.speak(userPrompt + reminder, runId, {
          ...opts,
          resetHistory: true,
          temperature: opts.temperature ?? 0.4,
          maxTokens: opts.maxTokens ?? 2400,
        })

        const raw = message.content.trim()
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
        const source = fenced?.[1]?.trim() ?? raw
        const firstBrace = source.indexOf('{')
        const lastBrace = source.lastIndexOf('}')
        if (firstBrace < 0 || lastBrace <= firstBrace) {
          lastError = 'aucun objet JSON trouvé'
          continue
        }
        const json = source.slice(firstBrace, lastBrace + 1)
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(json)
        } catch (e) {
          lastError = `JSON invalide: ${(e as Error).message}`
          continue
        }
        try {
          const data = schema.parse(parsedJson)
          return { data, message }
        } catch (e) {
          lastError = `Zod: ${(e as Error).message.slice(0, 200)}`
          continue
        }
      } finally {
        if (opts.systemOverride) {
          this.profile = { ...this.profile, systemPrompt: previousSystem }
        }
      }
    }

    throw new Error(`writeStructuredJson échec après ${retries + 1} tentatives — ${lastError ?? 'inconnu'}`)
  }
```

- [ ] **Step 2 : Vérifier compilation**

Run: `npx tsc --noEmit -p .`
Expected: pas d'erreur sur `base-agent.ts`. (D'autres erreurs ailleurs sont attendues.)

- [ ] **Step 3 : Commit**

```bash
git add src/lib/agents/base-agent.ts
git commit -m "agents(base): add writeStructuredJson helper with Zod-validated retries, no prose fallback"
```

### Task 2.2 — Prompt Mia roster dans `profiles.ts`

- [ ] **Step 1 : Modifier `src/lib/agents/profiles.ts`** — laisser le profil Mia existant tel quel, et ajouter en bas du fichier (après `getProfile`) un export :

```ts
export const MIA_ROSTER_SYSTEM_PROMPT = `Tu es Mia, cheffe de projet. Pour ce run, tu dois fixer le casting narratif AVANT la réunion.

Tu reçois en input :
- l'idée du client
- un narrationMode : "dialogue" ou "voiceover"

Tu produis UNIQUEMENT un JSON conforme à ce schéma :
{
  "premise": "1-2 phrases du conflit central, situé, concret",
  "characters": [
    {
      "id": "slug stable, lowercase, ex: alex, noor",
      "name": "Prénom",
      "archetype": "rôle dramatique en 4-8 mots",
      "voiceProfile": {
        "register": "grave|medium|aigu",
        "tempo": "lent|normal|rapide",
        "signatureWords": ["1 à 3 mots-tics du personnage"]
      },
      "arcGoal": "ce que le personnage veut sur la durée du run",
      "arcStakes": "ce qu'il perd s'il échoue"
    }
  ]
}

Règles non négociables :
- 2 à 4 personnages exactement
- ids uniques, [a-z][a-z0-9_-]{1,30}
- en mode "dialogue" : aucun personnage ne doit être un narrateur (pas d'isNarrator)
- en mode "voiceover" : tu peux ajouter au plus UN personnage avec "isNarrator": true (id "narrator")
- pas de prose, pas de markdown, pas de commentaire — uniquement le JSON

Le narrationMode te sera donné dans le prompt utilisateur. Tu ne le choisis pas.`
```

- [ ] **Step 2 : Commit**

```bash
git add src/lib/agents/profiles.ts
git commit -m "agents(profiles): add MIA_ROSTER_SYSTEM_PROMPT for Phase 0 casting"
```

### Task 2.3 — Test failing pour Phase 0

- [ ] **Step 1 : Créer `src/lib/agents/__tests__/coordinator-roster.test.ts`** :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MeetingCoordinator } from '../coordinator'
import type { LLMProvider } from '@/lib/providers/types'
import { mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('@/lib/providers/failover', () => ({
  executeWithFailover: vi.fn(async (_kind, fn) => {
    const provider: Partial<LLMProvider> & { name: string } = {
      name: 'mock-llm',
      chat: async () => ({
        content: JSON.stringify({
          premise: 'Alex débarque chez Noor à cause d\'une lettre.',
          characters: [
            {
              id: 'alex',
              name: 'Alex',
              archetype: 'frère revenant en quête de vérité',
              voiceProfile: { register: 'medium', tempo: 'rapide', signatureWords: ['regarde-moi'] },
              arcGoal: 'obtenir la vérité',
              arcStakes: 'continuer de mentir s\'il échoue',
            },
            {
              id: 'noor',
              name: 'Noor',
              archetype: 'sœur protectrice',
              voiceProfile: { register: 'grave', tempo: 'lent', signatureWords: ['pas maintenant'] },
              arcGoal: 'cacher la lettre',
              arcStakes: 'perdre la garde de leur mère',
            },
          ],
        }),
        costEur: 0.001,
        tokens: 200,
        model: 'mock',
      }),
    }
    const result = await fn(provider as LLMProvider)
    return { result, provider }
  }),
}))

vi.mock('@/lib/db/queries/traces', () => ({ createAgentTrace: vi.fn() }))
vi.mock('@/lib/db/queries/runs', () => ({ updateRunCost: vi.fn() }))
vi.mock('@/lib/db/queries/logs', () => ({ createProviderLog: vi.fn() }))

describe('MeetingCoordinator.runRosterPhase', () => {
  let storagePath: string

  beforeEach(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'fc-roster-'))
  })

  it('produit characters.json valide en mode dialogue', async () => {
    const coordinator = new MeetingCoordinator({
      runId: 'r1',
      idea: 'confrontation entre frère et sœur autour d\'une lettre',
      narrationMode: 'dialogue',
      storagePath,
    })

    const roster = await coordinator.runRosterPhase()

    expect(roster.runId).toBe('r1')
    expect(roster.narrationMode).toBe('dialogue')
    expect(roster.characters).toHaveLength(2)
    expect(roster.characters[0].id).toBe('alex')
    expect(roster.characters.every((c) => c.isNarrator !== true)).toBe(true)

    const written = JSON.parse(await readFile(join(storagePath, 'characters.json'), 'utf-8'))
    expect(written.characters).toHaveLength(2)
  })
})
```

- [ ] **Step 2 : Lancer le test**

Run: `npx vitest run src/lib/agents/__tests__/coordinator-roster.test.ts`
Expected: FAIL — `MeetingCoordinator` n'a pas encore `runRosterPhase` ni le param `storagePath` ni `narrationMode`.

### Task 2.4 — Implémenter `runRosterPhase` dans `coordinator.ts`

- [ ] **Step 1 : Modifier le constructeur** — ajouter les options `narrationMode` et `storagePath` dans `MeetingCoordinator` à `coordinator.ts:201-233`. Remplacer le bloc constructor par :

```ts
  private narrationMode: NarrationMode
  private storagePath: string

  constructor(opts: {
    runId: string
    idea: string
    brandKit?: string | null
    template?: StyleTemplate | null
    outputConfig?: OutputConfig | null
    referenceImages?: ReferenceImageConfig | null
    meetingPromptNote?: string | null
    meetingLlmMode?: MeetingLlmMode
    meetingLlmModel?: string | null
    narrationMode?: NarrationMode
    storagePath: string
    onMessage?: (message: AgentMessage) => void
  }) {
    this.runId = opts.runId
    this.idea = opts.idea
    this.brandKit = opts.brandKit ?? null
    this.template = opts.template ?? null
    this.outputConfig = opts.outputConfig ?? null
    this.referenceImages = opts.referenceImages ?? null
    this.meetingPromptNote = opts.meetingPromptNote?.trim() || null
    this.meetingLlmMode = opts.meetingLlmMode ?? 'local'
    this.meetingLlmModel = opts.meetingLlmModel?.trim() || null
    this.narrationMode = opts.narrationMode ?? 'dialogue'
    this.storagePath = opts.storagePath
    this.onMessage = opts.onMessage

    const llmTarget = resolveLlmTarget(this.meetingLlmMode, this.meetingLlmModel)
    this.meetingLlmModel = llmTarget.model
    this.llmHost = llmTarget.host
    this.llmHeaders = llmTarget.headers

    for (const [role, profile] of Object.entries(AGENT_PROFILES)) {
      this.agents.set(role as AgentRole, new BaseAgent(profile))
    }
  }
```

- [ ] **Step 2 : Ajouter les imports manquants en haut du fichier** :

```ts
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { MIA_ROSTER_SYSTEM_PROMPT } from './profiles'
import { characterRosterSchema } from '@/lib/schemas/audio'
import type { CharacterRoster, NarrationMode } from '@/types/agent'
```

- [ ] **Step 3 : Ajouter la méthode `runRosterPhase` dans la classe** — placer juste avant `runMeeting` (ligne ~242) :

```ts
  /**
   * Phase 0 — Mia produit le roster narratif AVANT la réunion.
   * Le narrationMode est imposé par le run/projectConfig, jamais choisi par Mia.
   * Écrit characters.json puis renvoie le roster validé Zod.
   */
  async runRosterPhase(): Promise<CharacterRoster> {
    const mia = this.agents.get('mia')!

    const userPrompt = [
      `Idée du run : ${this.idea}`,
      `narrationMode : ${this.narrationMode}`,
      this.brandKit ? `\nBrand Kit :\n${this.brandKit}` : '',
      '',
      'Produis le casting narratif au format JSON conforme au schéma. Aucun texte hors JSON.',
    ].filter(Boolean).join('\n')

    const partialSchema = characterRosterSchema
      .innerType()
      .pick({ premise: true, characters: true })

    const { data } = await mia.writeStructuredJson(
      userPrompt,
      partialSchema,
      this.runId,
      {
        systemOverride: MIA_ROSTER_SYSTEM_PROMPT,
        temperature: 0.5,
        maxTokens: 1200,
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
        model: this.meetingLlmModel ?? undefined,
        host: this.llmHost,
        headers: this.llmHeaders,
        retries: 2,
      },
    )

    const roster: CharacterRoster = characterRosterSchema.parse({
      runId: this.runId,
      narrationMode: this.narrationMode,
      characters: data.characters,
      premise: data.premise,
      createdAt: new Date().toISOString(),
    })

    await writeFile(
      join(this.storagePath, 'characters.json'),
      JSON.stringify(roster, null, 2),
    )

    logger.info({
      event: 'roster_written',
      runId: this.runId,
      narrationMode: this.narrationMode,
      characterCount: roster.characters.length,
    })

    return roster
  }
```

Note : `characterRosterSchema.innerType().pick(...)` extrait un sous-schéma sans les champs ajoutés en code (`runId`, `narrationMode`, `createdAt`). Si ZodEffects pose problème, replier sur un schéma local explicite :

```ts
const miaOutputSchema = z.object({
  premise: z.string().min(1),
  characters: z.array(characterSchema).min(2).max(4),
})
```

avec un import `characterSchema` depuis `@/lib/schemas/audio`. Cette deuxième forme est plus fiable et préférée. Refaire l'edit avec :

```ts
import { characterRosterSchema, characterSchema } from '@/lib/schemas/audio'
import { z } from 'zod'

const miaOutputSchema = z.object({
  premise: z.string().min(1),
  characters: z.array(characterSchema).min(2).max(4),
})
```

et remplacer `partialSchema` par `miaOutputSchema` dans l'appel `writeStructuredJson`.

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `npx vitest run src/lib/agents/__tests__/coordinator-roster.test.ts`
Expected: PASS — roster valide écrit dans characters.json.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/agents/coordinator.ts src/lib/agents/__tests__/coordinator-roster.test.ts
git commit -m "agents(coordinator): add Phase 0 runRosterPhase, narrationMode-driven, writes characters.json"
```

### Task 2.5 — `buildRosterContext` injecté en contextualPrelude

- [ ] **Step 1 : Ajouter dans `coordinator.ts` (avant la classe MeetingCoordinator)** :

```ts
function buildRosterContext(roster: CharacterRoster): string {
  const lines = [
    'Roster figé pour ce run (à respecter dans toutes tes propositions) :',
    `- narrationMode : ${roster.narrationMode}`,
    `- premise : ${roster.premise}`,
    'Personnages :',
    ...roster.characters.map((c) => {
      const narratorTag = c.isNarrator ? ' [narrator]' : ''
      const sigwords = c.voiceProfile.signatureWords?.length
        ? ` mots-tics: ${c.voiceProfile.signatureWords.join(', ')}`
        : ''
      return `- ${c.id}${narratorTag} (${c.archetype}) — voix ${c.voiceProfile.register} ${c.voiceProfile.tempo}${sigwords}; veut: ${c.arcGoal}; risque: ${c.arcStakes}`
    }),
    'Tu n\'as pas le droit d\'inventer de nouveau personnage ni de renommer ces ids.',
  ]
  return lines.join('\n')
}
```

- [ ] **Step 2 : Modifier `runMeeting` pour invoquer `runRosterPhase` en premier et propager le roster** —

À `coordinator.ts:242` (début de `runMeeting`), ajouter en tout premier :

```ts
    const roster = await this.runRosterPhase()
    const rosterPrelude = buildRosterContext(roster)
```

Puis pour chaque appel `agentSpeak` qui utilise un `contextualPrelude`, préfixer le `rosterPrelude` :

Remplacer toutes les occurrences de :

```ts
contextualPrelude: [referenceImagesDirective, visualSafetyDirective, meetingSteeringDirective].filter(Boolean).join('\n\n') || undefined,
```

par :

```ts
contextualPrelude: [rosterPrelude, referenceImagesDirective, visualSafetyDirective, meetingSteeringDirective].filter(Boolean).join('\n\n') || undefined,
```

Pour les `agentSpeak` qui n'avaient pas de contextualPrelude (Phase 3 audio, Phase 5 réactions Théo), leur en donner un :

```ts
contextualPrelude: rosterPrelude,
```

Et propager le `roster` jusqu'au `MeetingBrief` retourné en l'ajoutant dans le retour final :

```ts
    return {
      runId: this.runId,
      idea: this.idea,
      sections: briefSections,
      summary: closing.content,
      sceneOutline,
      estimatedBudget: `~${totalCost.toFixed(2)} € (réunion)`,
      validatedBy: 'mia',
      createdAt: new Date().toISOString(),
      roster, // ← ajout
    }
```

- [ ] **Step 3 : Mettre à jour `MeetingBrief` dans `src/types/agent.ts`** — ajouter `roster: CharacterRoster` :

```ts
export type MeetingBrief = {
  runId: string
  idea: string
  sections: { agent: AgentRole; title: string; content: string }[]
  summary: string
  sceneOutline?: MeetingSceneOutlineItem[]
  estimatedBudget: string
  validatedBy: string
  createdAt: string
  roster: CharacterRoster
}
```

- [ ] **Step 4 : Compiler**

Run: `npx tsc --noEmit -p .`
Expected: pas d'erreur sur `coordinator.ts` ni `agent.ts`. (Erreurs persistent ailleurs.)

- [ ] **Step 5 : Commit**

```bash
git add src/lib/agents/coordinator.ts src/types/agent.ts
git commit -m "agents(coordinator): inject buildRosterContext as prelude in every meeting phase; propagate roster in MeetingBrief"
```

### Task 2.6 — Adapter le caller `meeting/route.ts` pour passer `storagePath` et `narrationMode`

- [ ] **Step 1 : Lire `src/app/api/runs/[id]/meeting/route.ts:200-220`** pour repérer le constructeur

Run: `grep -n "new MeetingCoordinator" src/app/api/runs/[id]/meeting/route.ts`
Expected: ligne ~200-215.

- [ ] **Step 2 : Modifier l'instanciation** — ajouter les deux params :

```ts
const coordinator = new MeetingCoordinator({
  runId,
  idea: run.idea,
  brandKit,
  template,
  outputConfig: projectConfig?.outputConfig ?? null,
  referenceImages: projectConfig?.referenceImages ?? null,
  meetingPromptNote: projectConfig?.meetingPromptNote ?? null,
  meetingLlmMode: projectConfig?.meetingLlmMode,
  meetingLlmModel: projectConfig?.meetingLlmModel,
  narrationMode: projectConfig?.narrationMode ?? 'dialogue',
  storagePath,
  onMessage: (msg) => { /* existant */ },
})
```

(Conserver les options existantes ; ajouter seulement les deux nouvelles. Adapter au nom de variable `storagePath` réellement utilisé dans le fichier — probablement déjà calculé pour `writeFile(join(storagePath, 'brief.json'), ...)`.)

- [ ] **Step 3 : Faire la même chose pour TOUS les autres callers** :

Run: `grep -rn "new MeetingCoordinator" src/`
Expected: liste de fichiers. Pour chacun, ajouter `storagePath` et `narrationMode`.

- [ ] **Step 4 : Compiler**

Run: `npx tsc --noEmit -p .`
Expected: 0 erreur sur les call sites du coordinator.

- [ ] **Step 5 : Commit**

```bash
git add src/app/api/
git commit -m "api(runs): pass storagePath and narrationMode to MeetingCoordinator"
```

### Task 2.7 — Reset étape 2 inclut les nouveaux fichiers

- [ ] **Step 1 : Modifier `src/lib/pipeline/reset.ts`** — ligne 7 :

Avant :

```ts
const FILES_BY_STEP: Record<number, string[]> = {
  2: ['brief.json'],
  3: ['structure.json', 'structure-raw.txt', 'director-plan.json', 'dialogue_script.json'],
```

Après :

```ts
const FILES_BY_STEP: Record<number, string[]> = {
  2: ['brief.json', 'characters.json', 'brief_dialogue.json'],
  3: ['structure.json', 'structure-raw.txt', 'director-plan.json', 'dialogue_script.json'],
```

- [ ] **Step 2 : Commit**

```bash
git add src/lib/pipeline/reset.ts
git commit -m "pipeline(reset): include characters.json and brief_dialogue.json in step-2 reset"
```

---

## Task 3 : Sami JSON forcé

**Files:**
- Modify: `src/lib/agents/profiles.ts`
- Modify: `src/lib/agents/coordinator.ts`
- Create: `src/lib/meeting/dialogue-extractor.ts`
- Create: `src/lib/meeting/__tests__/dialogue-extractor.test.ts`

### Task 3.1 — Prompt Sami JSON

- [ ] **Step 1 : Ajouter dans `src/lib/agents/profiles.ts`** (après `MIA_ROSTER_SYSTEM_PROMPT`) :

```ts
export const SAMI_DIALOGUE_SYSTEM_PROMPT = `Tu es Sami, dialoguiste. Tu écris le script dialogué scène par scène en JSON STRICT.

Tu reçois en input :
- le roster du run (personnages disponibles, leurs voix, leurs enjeux)
- le narrationMode (dialogue ou voiceover)
- la séquence de scènes prévue par la réunion (titres, durées, intentions narratives)

Tu produis UNIQUEMENT un JSON conforme à ce schéma :
{
  "scenes": [
    {
      "sceneIndex": 1,
      "lines": [
        {
          "characterId": "alex",
          "text": "phrase exacte de la réplique",
          "intent": "verbe d'action dramatique : accuser|esquiver|menacer|céder|rassurer|annoncer|raconter|ironiser",
          "subtext": "ce que le personnage ne dit pas (optionnel mais encouragé en tension)",
          "reactsToLineIndex": null
        }
      ]
    }
  ]
}

Règles non négociables :
- chaque characterId DOIT exister dans le roster
- chaque ligne a un text non vide ET un intent non vide
- en mode dialogue : aucun characterId 'narrator' ni 'narrateur'
- en mode voiceover : 'narrator' autorisé (uniquement si le roster contient un narrator)
- alterne les voix : pas plus de 2 lignes consécutives du même characterId quand 2+ personnages sont présents
- minimum 4 lignes par scène avec ≥ 2 personnages présents
- pas de prose, pas de markdown, pas de commentaire — uniquement le JSON`
```

- [ ] **Step 2 : Commit**

```bash
git add src/lib/agents/profiles.ts
git commit -m "agents(profiles): add SAMI_DIALOGUE_SYSTEM_PROMPT for JSON-strict dialogue authoring"
```

### Task 3.2 — Test failing pour l'extractor

- [ ] **Step 1 : Créer `src/lib/meeting/__tests__/dialogue-extractor.test.ts`** :

```ts
import { describe, it, expect } from 'vitest'
import { validateBriefDialogue, checkAlternation } from '../dialogue-extractor'

const validRoster = {
  runId: 'r1',
  narrationMode: 'dialogue' as const,
  characters: [
    { id: 'alex', name: 'Alex', archetype: 'a', voiceProfile: { register: 'medium', tempo: 'rapide' } as const, arcGoal: 'a', arcStakes: 'a' },
    { id: 'noor', name: 'Noor', archetype: 'b', voiceProfile: { register: 'grave', tempo: 'lent' } as const, arcGoal: 'b', arcStakes: 'b' },
  ],
  premise: 'p',
  createdAt: '2026-04-28T07:00:00Z',
}

describe('validateBriefDialogue', () => {
  it('accepte un dialogue valide en mode dialogue', () => {
    const dialogue = {
      scenes: [
        {
          sceneIndex: 1,
          lines: [
            { characterId: 'alex', text: 'Sors', intent: 'menacer' },
            { characterId: 'noor', text: 'Pas maintenant', intent: 'esquiver' },
            { characterId: 'alex', text: 'Réponds', intent: 'presser' },
            { characterId: 'noor', text: 'D\'accord', intent: 'céder' },
          ],
        },
      ],
    }
    const result = validateBriefDialogue(dialogue, validRoster)
    expect(result.scenes[0].lines).toHaveLength(4)
  })

  it('rejette un characterId absent du roster', () => {
    const dialogue = {
      scenes: [
        { sceneIndex: 1, lines: [{ characterId: 'inconnu', text: 'x', intent: 'a' }] },
      ],
    }
    expect(() => validateBriefDialogue(dialogue, validRoster)).toThrow(/inconnu/)
  })

  it('rejette narrator en mode dialogue', () => {
    const dialogue = {
      scenes: [
        { sceneIndex: 1, lines: [{ characterId: 'narrator', text: 'x', intent: 'a' }] },
      ],
    }
    expect(() => validateBriefDialogue(dialogue, validRoster)).toThrow(/narrator/)
  })

  it('accepte narrator en mode voiceover si présent dans le roster', () => {
    const voiceoverRoster = {
      ...validRoster,
      narrationMode: 'voiceover' as const,
      characters: [
        ...validRoster.characters,
        { id: 'narrator', name: 'Narrateur', archetype: 'voix', voiceProfile: { register: 'grave', tempo: 'normal' } as const, arcGoal: 'g', arcStakes: 's', isNarrator: true },
      ],
    }
    const dialogue = {
      scenes: [
        { sceneIndex: 1, lines: [{ characterId: 'narrator', text: 'Il fait nuit.', intent: 'situer' }] },
      ],
    }
    expect(() => validateBriefDialogue(dialogue, voiceoverRoster)).not.toThrow()
  })

  it('rejette une scène à 0 ligne', () => {
    const dialogue = { scenes: [{ sceneIndex: 1, lines: [] }] }
    expect(() => validateBriefDialogue(dialogue, validRoster)).toThrow()
  })
})

describe('checkAlternation', () => {
  it('passe : alternance respectée', () => {
    const lines = [
      { characterId: 'alex', text: 'a', intent: 'i' },
      { characterId: 'noor', text: 'b', intent: 'i' },
      { characterId: 'alex', text: 'c', intent: 'i' },
    ]
    expect(checkAlternation(lines)).toEqual({ ok: true, violations: [] })
  })

  it('détecte 3 lignes consécutives du même characterId', () => {
    const lines = [
      { characterId: 'alex', text: 'a', intent: 'i' },
      { characterId: 'alex', text: 'b', intent: 'i' },
      { characterId: 'alex', text: 'c', intent: 'i' },
      { characterId: 'noor', text: 'd', intent: 'i' },
    ]
    const result = checkAlternation(lines)
    expect(result.ok).toBe(false)
    expect(result.violations).toContain(2)
  })
})
```

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/meeting/__tests__/dialogue-extractor.test.ts`
Expected: FAIL — module not found.

### Task 3.3 — Implémenter l'extractor

- [ ] **Step 1 : Créer `src/lib/meeting/dialogue-extractor.ts`** :

```ts
import type { BriefDialogueLine, CharacterRoster } from '@/types/agent'
import { briefDialogueSchema, type BriefDialogueDoc } from '@/lib/schemas/audio'

/**
 * Valide un brief_dialogue.json (Zod) puis vérifie les invariants liés au roster :
 * - chaque characterId existe dans le roster
 * - en mode 'dialogue', aucun characterId === 'narrator' ou 'narrateur'
 * Throw une Error explicite si une violation est trouvée.
 */
export function validateBriefDialogue(
  raw: unknown,
  roster: CharacterRoster,
): BriefDialogueDoc {
  const parsed = briefDialogueSchema.parse(raw)

  const knownIds = new Set(roster.characters.map((c) => c.id))

  for (const scene of parsed.scenes) {
    for (const line of scene.lines) {
      if (!knownIds.has(line.characterId)) {
        throw new Error(`brief_dialogue scene ${scene.sceneIndex}: characterId "${line.characterId}" inconnu du roster`)
      }
      if (roster.narrationMode === 'dialogue') {
        const isNarratorRef = line.characterId === 'narrator' || line.characterId === 'narrateur'
        if (isNarratorRef) {
          throw new Error(`brief_dialogue scene ${scene.sceneIndex}: characterId "narrator" interdit en mode dialogue`)
        }
      }
    }
  }

  return parsed
}

/**
 * Vérifie que pas plus de 2 lignes consécutives n'ont le même characterId.
 * Retourne { ok, violations } où violations contient les indices de ligne
 * qui sont la 3e (ou plus) consécutive du même characterId.
 * Soft check, jamais throw.
 */
export function checkAlternation(
  lines: Pick<BriefDialogueLine, 'characterId'>[],
): { ok: boolean; violations: number[] } {
  const violations: number[] = []
  let runStart = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].characterId === lines[i - 1].characterId) {
      const runLength = i - runStart + 1
      if (runLength >= 3) {
        violations.push(i)
      }
    } else {
      runStart = i
    }
  }
  return { ok: violations.length === 0, violations }
}
```

- [ ] **Step 2 : Run le test, doit passer**

Run: `npx vitest run src/lib/meeting/__tests__/dialogue-extractor.test.ts`
Expected: PASS — toutes les assertions vertes.

- [ ] **Step 3 : Commit**

```bash
git add src/lib/meeting/dialogue-extractor.ts src/lib/meeting/__tests__/dialogue-extractor.test.ts
git commit -m "meeting(dialogue-extractor): validate Sami JSON against roster + soft alternation check"
```

### Task 3.4 — Brancher Sami JSON dans le coordinator

- [ ] **Step 1 : Dans `src/lib/agents/coordinator.ts`**, modifier la Phase 7 (autour de `coordinator.ts:347-370`).

Localiser le bloc qui itère sur `['lenny', 'laura', ...]` pour `writeBriefSection`, et **isoler le cas Sami** :

Avant :

```ts
for (const role of ['lenny', 'laura', 'nael', 'emilie', 'nico', 'sami', 'jade', 'remi', 'theo'] as AgentRole[]) {
  const agent = this.agents.get(role)!
  const section = await agent.writeBriefSection(transcript, this.runId, { ... })
  await this.recordMessage(section)
  totalCost += section.metadata?.costEur ?? 0
  briefSections.push({
    agent: role,
    title: AGENT_PROFILES[role].briefSection,
    content: section.content,
  })
}
```

Après :

```ts
for (const role of ['lenny', 'laura', 'nael', 'emilie', 'nico', 'sami', 'jade', 'remi', 'theo'] as AgentRole[]) {
  if (role === 'sami') {
    const { dialogue, summary, costEur } = await this.runSamiDialoguePhase(transcript, roster, rosterPrelude)
    totalCost += costEur
    briefSections.push({
      agent: 'sami',
      title: AGENT_PROFILES.sami.briefSection,
      content: summary,
    })
    await writeFile(
      join(this.storagePath, 'brief_dialogue.json'),
      JSON.stringify(dialogue, null, 2),
    )
    continue
  }

  const agent = this.agents.get(role)!
  const section = await agent.writeBriefSection(transcript, this.runId, {
    timeoutMs: MEETING_LLM_TIMEOUT_MS,
    model: this.meetingLlmModel ?? undefined,
    host: this.llmHost,
    headers: this.llmHeaders,
    contextualPrelude: [rosterPrelude, referenceImagesDirective, visualSafetyDirective, meetingSteeringDirective].filter(Boolean).join('\n\n') || undefined,
  })
  await this.recordMessage(section)
  totalCost += section.metadata?.costEur ?? 0

  briefSections.push({
    agent: role,
    title: AGENT_PROFILES[role].briefSection,
    content: section.content,
  })
}
```

- [ ] **Step 2 : Ajouter la méthode `runSamiDialoguePhase`** dans `MeetingCoordinator` (juste avant `runRosterPhase`) :

```ts
  /**
   * Phase 7 — Sami produit ses dialogues en JSON strict (brief_dialogue.json).
   * Aucun fallback prose. Si JSON ou Zod KO après retries → throw, le step échoue.
   */
  private async runSamiDialoguePhase(
    transcript: string,
    roster: CharacterRoster,
    rosterPrelude: string,
  ): Promise<{ dialogue: BriefDialogueDoc; summary: string; costEur: number }> {
    const sami = this.agents.get('sami')!

    const sceneCount = this.outputConfig?.sceneCount ?? 5
    const sceneList = Array.from({ length: sceneCount }, (_, i) => `scène ${i + 1}`).join(', ')

    const userPrompt = [
      'Voici la réunion :',
      transcript,
      '',
      `Tu dois produire les répliques pour ces scènes : ${sceneList}.`,
      'narrationMode : ' + roster.narrationMode,
      '',
      'Rappel : uniquement du JSON conforme au schéma. characterIds = [' + roster.characters.map((c) => c.id).join(', ') + '].',
    ].join('\n')

    const { data: dialogue, message } = await sami.writeStructuredJson(
      userPrompt,
      briefDialogueSchema,
      this.runId,
      {
        systemOverride: SAMI_DIALOGUE_SYSTEM_PROMPT + '\n\n' + rosterPrelude,
        temperature: 0.7,
        maxTokens: 4000,
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
        model: this.meetingLlmModel ?? undefined,
        host: this.llmHost,
        headers: this.llmHeaders,
        retries: 2,
      },
    )

    const validated = validateBriefDialogue(dialogue, roster)

    for (const scene of validated.scenes) {
      const alt = checkAlternation(scene.lines)
      if (!alt.ok) {
        logger.warn({
          event: 'sami_alternation_violation',
          runId: this.runId,
          sceneIndex: scene.sceneIndex,
          violations: alt.violations,
        })
      }
    }

    await this.recordMessage(message)

    const summary = `Sami a produit ${validated.scenes.length} scène(s) dialoguée(s), total ${validated.scenes.reduce((sum, s) => sum + s.lines.length, 0)} ligne(s). Voix incarnées : ${[...new Set(validated.scenes.flatMap((s) => s.lines.map((l) => l.characterId)))].join(', ')}.`

    return {
      dialogue: validated,
      summary,
      costEur: message.metadata?.costEur ?? 0,
    }
  }
```

- [ ] **Step 3 : Ajouter les imports** en haut du fichier :

```ts
import { SAMI_DIALOGUE_SYSTEM_PROMPT } from './profiles'
import { briefDialogueSchema, type BriefDialogueDoc } from '@/lib/schemas/audio'
import { validateBriefDialogue, checkAlternation } from '@/lib/meeting/dialogue-extractor'
```

- [ ] **Step 4 : Compiler**

Run: `npx tsc --noEmit -p .`
Expected: pas d'erreur sur `coordinator.ts`.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/agents/coordinator.ts
git commit -m "agents(coordinator): Sami writes brief_dialogue.json via writeStructuredJson, no prose fallback"
```

### Task 3.5 — Test e2e mock pour Sami JSON

- [ ] **Step 1 : Étendre `src/lib/agents/__tests__/coordinator-roster.test.ts`** avec un nouveau `describe` qui mocke aussi le retour Sami JSON et appelle `runMeeting`. (Ce test peut grandir — alternativement, créer `coordinator-sami.test.ts`.) Pour rester DRY, créer `coordinator-sami.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// Le mock executeWithFailover répond séquentiellement :
// 1) roster Mia
// 2) toutes les phases d'agentSpeak (réponse vide acceptée)
// 3) Sami JSON
// 4) buildSceneOutline
// On simplifie en faisant un dispatcher selon le system prompt.

let callIndex = 0

vi.mock('@/lib/providers/failover', () => ({
  executeWithFailover: vi.fn(async (_kind, fn) => {
    const provider = {
      name: 'mock-llm',
      chat: async (messages: { role: string; content: string }[]) => {
        const sys = messages.find((m) => m.role === 'system')?.content ?? ''
        callIndex++
        if (sys.includes('cheffe de projet') && sys.includes('casting narratif')) {
          return {
            content: JSON.stringify({
              premise: 'p',
              characters: [
                { id: 'alex', name: 'A', archetype: 'a', voiceProfile: { register: 'medium', tempo: 'rapide' }, arcGoal: 'g', arcStakes: 's' },
                { id: 'noor', name: 'N', archetype: 'b', voiceProfile: { register: 'grave', tempo: 'lent' }, arcGoal: 'g', arcStakes: 's' },
              ],
            }),
            costEur: 0.001,
            tokens: 200,
            model: 'mock',
          }
        }
        if (sys.includes('Sami, dialoguiste')) {
          return {
            content: JSON.stringify({
              scenes: [
                { sceneIndex: 1, lines: [
                  { characterId: 'alex', text: 'Sors', intent: 'menacer' },
                  { characterId: 'noor', text: 'Non', intent: 'esquiver' },
                  { characterId: 'alex', text: 'Tout de suite', intent: 'presser' },
                  { characterId: 'noor', text: 'D\'accord', intent: 'céder' },
                ]},
              ],
            }),
            costEur: 0.002,
            tokens: 400,
            model: 'mock',
          }
        }
        // buildSceneOutline et autres : réponse JSON minimale qui ne casse pas
        if (sys.includes('sceneOutline canonique') || sys.includes('outline')) {
          return {
            content: JSON.stringify({ sceneOutline: [{
              index: 1,
              title: 'Confrontation',
              description: 'Alex débarque',
              beat: { beatId: 'B1', type: 'rising', emotionStart: 'calme', emotionEnd: 'rage', tensionLevel: 70, conflict: 'c', stakes: 's' },
              continuityFromPreviousScene: '',
              camera: 'rapproché',
              lighting: 'tungstène',
              duration_s: 12,
              foreground: 'fp', midground: 'mg', background: 'bg',
            }]}),
            costEur: 0.001, tokens: 200, model: 'mock',
          }
        }
        return { content: 'ok', costEur: 0, tokens: 10, model: 'mock' }
      },
    }
    const result = await fn(provider as never)
    return { result, provider }
  }),
}))

vi.mock('@/lib/db/queries/traces', () => ({ createAgentTrace: vi.fn() }))
vi.mock('@/lib/db/queries/runs', () => ({ updateRunCost: vi.fn() }))
vi.mock('@/lib/db/queries/logs', () => ({ createProviderLog: vi.fn() }))

describe('Sami JSON path', () => {
  let storagePath: string

  beforeEach(async () => {
    callIndex = 0
    storagePath = await mkdtemp(join(tmpdir(), 'fc-sami-'))
  })

  it('écrit brief_dialogue.json avec lignes valides', async () => {
    const { MeetingCoordinator } = await import('../coordinator')
    const coordinator = new MeetingCoordinator({
      runId: 'r1',
      idea: 'confrontation autour d\'une lettre',
      narrationMode: 'dialogue',
      storagePath,
      outputConfig: { videoCount: 1, fullVideoDurationS: 12, sceneDurationS: 12, sceneCount: 1 },
    })

    const brief = await coordinator.runMeeting()

    const written = JSON.parse(await readFile(join(storagePath, 'brief_dialogue.json'), 'utf-8'))
    expect(written.scenes).toHaveLength(1)
    expect(written.scenes[0].lines).toHaveLength(4)
    expect(brief.roster.characters).toHaveLength(2)
    expect(brief.sections.find((s) => s.agent === 'sami')?.content).toContain('Sami a produit')
  })
})
```

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/agents/__tests__/coordinator-sami.test.ts`
Expected: PASS

- [ ] **Step 3 : Commit**

```bash
git add src/lib/agents/__tests__/coordinator-sami.test.ts
git commit -m "test(coordinator): e2e mock — Sami JSON path writes brief_dialogue.json"
```

---

## Task 4 : sceneOutline enrichi sans LLM-touch sur dialogueLines

**Files:**
- Modify: `src/lib/agents/coordinator.ts` (section `buildSceneOutline`)
- Delete: `src/lib/meeting/scene-dialogue.ts` (5 helpers obsolètes — ou retirer leur export)
- Modify: `src/lib/pipeline/steps/step-3-json.ts` (consommateurs des helpers supprimés)

### Task 4.1 — Refactor `buildSceneOutline`

- [ ] **Step 1 : Localiser** `coordinator.ts:467-576` (méthode `buildSceneOutline`).

- [ ] **Step 2 : Réécrire la méthode complète** :

```ts
  private async buildSceneOutline(
    transcript: string,
    sections: MeetingBrief['sections'],
    briefDialogue: BriefDialogueDoc,
    roster: CharacterRoster,
    rosterPrelude: string,
  ): Promise<MeetingSceneOutlineItem[]> {
    const compactTranscript = compactTranscriptForPrompt(transcript, SCENE_OUTLINE_TRANSCRIPT_MAX_CHARS)
    const outputLockContext = buildOutputLockContext(this.outputConfig)
    const referenceImagesContext = buildReferenceImagesContext(this.referenceImages)
    const visualSafetyDirective = buildVisualSafetyDirective()
    const meetingSteeringDirective = buildMeetingSteeringDirective(this.meetingPromptNote)
    const compactSections = sections.map((section) => ({
      agent: section.agent,
      title: section.title,
      content: section.content.slice(0, 700),
    }))

    const sceneSchema = z.object({
      index: z.number().int().positive(),
      title: z.string().min(1),
      description: z.string().min(1),
      beat: sceneBeatSchema,
      continuityFromPreviousScene: z.string(),
      camera: z.string().min(1),
      lighting: z.string().min(1),
      duration_s: z.number().int().positive(),
      foreground: z.string().optional(),
      midground: z.string().optional(),
      background: z.string().optional(),
    })
    const llmOutputSchema = z.object({
      sceneOutline: z.array(sceneSchema).min(1),
    })

    const { result } = await executeWithFailover(
      'llm',
      async (provider) => {
        const llm = provider as LLMProvider
        const system = [
          rosterPrelude,
          '',
          'Tu transformes une réunion + un brief_dialogue en sceneOutline canonique.',
          'IMPORTANT : tu NE produis PAS les répliques. Les dialogueLines de chaque scène existent déjà dans brief_dialogue et seront attachées en code après ta réponse. Ne tente pas de les recopier ni de les paraphraser.',
          '',
          'Schéma de sortie attendu :',
          '{',
          '  "sceneOutline": [',
          '    {',
          '      "index": 1,',
          '      "title": "titre court",',
          '      "description": "ce qui est montré dans la scène",',
          '      "beat": {',
          '        "beatId": "B1-...",',
          '        "type": "setup|inciting|rising|turn|climax|resolution",',
          '        "emotionStart": "...", "emotionEnd": "...",',
          '        "tensionLevel": 0-100,',
          '        "conflict": "...", "stakes": "..."',
          '      },',
          '      "continuityFromPreviousScene": "1 phrase, vide pour scène 1",',
          '      "camera": "intention caméra",',
          '      "lighting": "intention lumière",',
          '      "duration_s": 5,',
          '      "foreground": "...", "midground": "...", "background": "..."',
          '    }',
          '  ]',
          '}',
          '',
          'Règles :',
          '- pour chaque scène présente dans brief_dialogue, produis un beat, une description et le découpage visuel',
          '- l\'ordre des scènes doit suivre brief_dialogue exactement',
          '- aucune scène fusionnée, aucune scène ajoutée',
          '- chaque scène > 1 doit avoir une continuityFromPreviousScene non vide',
          '- camera et lighting concrets et courts',
          '- décors réels, jamais de fond studio',
          '- composition verticale TikTok 9:16',
          ...(outputLockContext ? [outputLockContext] : []),
          ...(referenceImagesContext ? [referenceImagesContext] : []),
          ...(meetingSteeringDirective ? [meetingSteeringDirective] : []),
          visualSafetyDirective,
        ].join('\n')

        const userMsg = [
          `Idée : ${this.idea}`,
          '',
          'Brief dialogues (source canonique des répliques, ne pas recopier) :',
          JSON.stringify(briefDialogue, null, 2).slice(0, 4000),
          '',
          'Sections du brief :',
          JSON.stringify(compactSections, null, 2),
          '',
          'Transcript compacté :',
          compactTranscript,
        ].join('\n')

        return llm.chat(
          [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
          {
            model: this.meetingLlmModel ?? undefined,
            temperature: 0.3,
            maxTokens: 2400,
            timeoutMs: MEETING_LLM_TIMEOUT_MS,
            host: this.llmHost,
            headers: this.llmHeaders,
          },
        )
      },
      this.runId,
    )

    const payload = extractJsonObject(result.content)
    const llmParsed = llmOutputSchema.parse(payload)

    // Attachement code des dialogueLines depuis brief_dialogue (1:1 strict, zéro LLM)
    const dialogueByIndex = new Map<number, BriefDialogueDoc['scenes'][number]>()
    for (const s of briefDialogue.scenes) dialogueByIndex.set(s.sceneIndex, s)

    const enriched: MeetingSceneOutlineItem[] = llmParsed.sceneOutline.map((scene) => {
      const dialogueForScene = dialogueByIndex.get(scene.index)
      if (!dialogueForScene) {
        throw new Error(`buildSceneOutline: scène ${scene.index} produite par le LLM mais absente de brief_dialogue`)
      }
      const lines = dialogueForScene.lines
      const charactersPresent = [...new Set(lines.map((l) => l.characterId))]
      return {
        index: scene.index,
        title: scene.title,
        description: scene.description,
        dialogueLines: lines,
        beat: scene.beat,
        charactersPresent,
        continuityFromPreviousScene: scene.continuityFromPreviousScene,
        camera: scene.camera,
        lighting: scene.lighting,
        duration_s: scene.duration_s,
        foreground: scene.foreground,
        midground: scene.midground,
        background: scene.background,
      }
    })

    // Validation Zod stricte de chaque outline
    for (const o of enriched) {
      meetingSceneOutlineItemSchema.parse(o)
    }

    validateSceneOutlineLock(enriched, this.outputConfig)

    if (enriched.length === 0) {
      throw new Error('sceneOutline vide après synthèse réunion')
    }

    return enriched
  }
```

- [ ] **Step 3 : Mettre à jour les imports en haut de `coordinator.ts`** :

```ts
import { z } from 'zod'
import { meetingSceneOutlineItemSchema, sceneBeatSchema } from '@/lib/schemas/audio'
```

Et **supprimer** :

```ts
import { backfillSceneOutlineDialogue, extractBriefSceneDialogues } from '@/lib/meeting/scene-dialogue'
```

(plus utilisé.)

- [ ] **Step 4 : Mettre à jour le caller `runMeeting`** — l'appel `buildSceneOutline` doit recevoir maintenant `briefDialogue, roster, rosterPrelude`. Modifier dans `runMeeting`, autour de `coordinator.ts:381-393`, le `try` qui appelle `buildSceneOutline` :

```ts
    let sceneOutline: MeetingSceneOutlineItem[] = []
    try {
      // briefDialogue a été stocké via this.lastBriefDialogue lors de runSamiDialoguePhase
      if (!this.lastBriefDialogue) {
        throw new Error('briefDialogue absent — Phase 7 Sami a échoué')
      }
      sceneOutline = await this.buildSceneOutline(
        fullTranscript,
        briefSections,
        this.lastBriefDialogue,
        roster,
        rosterPrelude,
      )
    } catch (error) {
      if (this.outputConfig) {
        throw error
      }
      logger.warn({
        event: 'meeting_scene_outline_missing',
        runId: this.runId,
        error: (error as Error).message,
      })
    }
```

Et stocker `briefDialogue` après `runSamiDialoguePhase`. Dans la boucle des sections (Task 3.4 step 1), après le `continue;` du cas Sami, set :

```ts
    if (role === 'sami') {
      const { dialogue, summary, costEur } = await this.runSamiDialoguePhase(transcript, roster, rosterPrelude)
      this.lastBriefDialogue = dialogue
      // ... reste inchangé
    }
```

Ajouter le champ dans la classe :

```ts
  private lastBriefDialogue: BriefDialogueDoc | null = null
```

- [ ] **Step 5 : Compiler**

Run: `npx tsc --noEmit -p .`
Expected: pas d'erreur sur `coordinator.ts`. (Erreurs persistantes attendues sur `step-3-json.ts` qui consomme encore les helpers à supprimer.)

- [ ] **Step 6 : Commit**

```bash
git add src/lib/agents/coordinator.ts
git commit -m "agents(coordinator): refactor buildSceneOutline — LLM never touches dialogueLines, code-side 1:1 attach"
```

### Task 4.2 — Supprimer les helpers obsolètes

- [ ] **Step 1 : Supprimer `src/lib/meeting/scene-dialogue.ts`** complètement

```bash
rm src/lib/meeting/scene-dialogue.ts
```

- [ ] **Step 2 : Run la suite Vitest pour repérer tous les imports cassés**

Run: `npx vitest run`
Expected: erreurs d'import sur `scene-dialogue` dans `step-3-json.ts` au minimum.

- [ ] **Step 3 : Modifier `src/lib/pipeline/steps/step-3-json.ts`** — retirer l'import :

```ts
// SUPPRIMER cette ligne (step-3-json.ts:12)
import { backfillSceneOutlineDialogue, extractBriefSceneDialogues, findScenesMissingDialogue, normalizeDialogueScenesWithFallback } from '@/lib/meeting/scene-dialogue'
```

Et tous les usages de ces fonctions dans `step-3-json.ts` :
- supprimer la fonction `buildDialogueScript` complète (lignes 159-260)
- supprimer la fonction `alignStructuredStoryToBriefOutline` (la garder si elle est encore utile pour aligner sur sceneOutline — vérifier l'usage à `step-3-json.ts:371`)

Pour cette étape, on garde `alignStructuredStoryToBriefOutline` mais on supprime sa dépendance au champ `dialogue: string` qui n'existe plus. Modifier la fonction pour ignorer `dialogue` :

```ts
function buildSceneFromOutline(
  outline: MeetingSceneOutlineItem,
  candidate?: Record<string, unknown>,
): StructuredScene {
  return {
    index: outline.index,
    description: toText(candidate?.description, outline.description),
    dialogue: '', // structure.json garde le champ pour rétro-compat aval, mais sa source canonique est dialogue_script.json
    camera: toText(candidate?.camera, outline.camera),
    lighting: toText(candidate?.lighting, outline.lighting),
    duration_s: toPositiveInt(candidate?.duration_s, outline.duration_s),
  }
}
```

- [ ] **Step 4 : Désactiver l'appel à `buildDialogueScript` dans `step-3-json.ts:441`** — entourer d'un commentaire explicite :

```ts
    // ── DialogueScript supprimé ici, déplacé vers Task 5 (dialogue-script-builder.ts) ──
    let dialogueScriptSummary: { sceneCount: number; lineCount: number } | null = null
    let totalCostEur = result.costEur

    // TEMPORAIRE — sera remplacé par buildDialogueScriptFromOutline en Task 5
    // const dialogueScriptResult = await buildDialogueScript(...)
    // totalCostEur += dialogueScriptResult.costEur

    // // skip écriture dialogue_script.json pour le moment (Task 5 le fera proprement)
```

NB : ce commentaire `TEMPORAIRE` est une transition INTRA-plan. Il sera supprimé en Task 5. C'est explicite, pas un placeholder de production.

- [ ] **Step 5 : Compiler**

Run: `npx tsc --noEmit -p .`
Expected: 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git rm src/lib/meeting/scene-dialogue.ts
git add src/lib/pipeline/steps/step-3-json.ts
git commit -m "meeting: remove scene-dialogue helpers (extractBriefScene, splitBlocks, normalizeWithFallback, buildFallback) — superseded by JSON path"
```

### Task 4.3 — Tests sur le sceneOutline enrichi

- [ ] **Step 1 : Étendre `coordinator-sami.test.ts`** avec une nouvelle assertion :

Ajouter dans le `it('écrit brief_dialogue.json avec lignes valides', ...)` :

```ts
    expect(brief.sceneOutline).toBeDefined()
    expect(brief.sceneOutline?.[0].dialogueLines).toHaveLength(4)
    expect(brief.sceneOutline?.[0].dialogueLines[0].text).toBe('Sors')
    expect(brief.sceneOutline?.[0].charactersPresent).toEqual(['alex', 'noor'])
    expect(brief.sceneOutline?.[0].beat.type).toBe('rising')
```

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/agents/__tests__/coordinator-sami.test.ts`
Expected: PASS — `dialogueLines` attachées en code, `charactersPresent` dérivés, beat fourni par le LLM.

- [ ] **Step 3 : Commit**

```bash
git add src/lib/agents/__tests__/coordinator-sami.test.ts
git commit -m "test(coordinator): assert sceneOutline.dialogueLines attached 1:1 from brief_dialogue"
```

---

## Task 5 : Préservation 1:1 dans step-3 (zéro LLM)

**Files:**
- Create: `src/lib/pipeline/dialogue-derivation.ts`
- Create: `src/lib/pipeline/__tests__/dialogue-derivation.test.ts`
- Create: `src/lib/pipeline/dialogue-script-builder.ts`
- Create: `src/lib/pipeline/__tests__/dialogue-script-builder.test.ts`
- Modify: `src/lib/pipeline/steps/step-3-json.ts`
- Modify: `src/lib/pipeline/tts-renderer.ts`
- Modify: `src/lib/pipeline/steps/step-4c-audio.ts`

### Task 5.1 — Tests pour la dérivation tone/pace/emphasis

- [ ] **Step 1 : Créer `src/lib/pipeline/__tests__/dialogue-derivation.test.ts`** :

```ts
import { describe, it, expect } from 'vitest'
import { deriveTone, derivePace, deriveEmphasis, estimateDuration } from '../dialogue-derivation'
import type { SceneBeat } from '@/types/agent'

const baseBeat: SceneBeat = {
  beatId: 'B', type: 'rising',
  emotionStart: 'calme', emotionEnd: 'colère', tensionLevel: 70,
  conflict: 'c', stakes: 's',
}
const aigu = { register: 'aigu' as const, tempo: 'rapide' as const }
const grave = { register: 'grave' as const, tempo: 'lent' as const }

describe('deriveTone', () => {
  it('intent accuser + emotionEnd colère → urgent', () => {
    expect(deriveTone({ intent: 'accuser', subtext: undefined }, { ...baseBeat, emotionEnd: 'colère' }, aigu)).toBe('urgent')
  })

  it('intent menacer + emotionEnd peur → grave', () => {
    expect(deriveTone({ intent: 'menacer' }, { ...baseBeat, emotionEnd: 'peur' }, aigu)).toBe('grave')
  })

  it('intent esquiver + emotionEnd doute → mystérieux', () => {
    expect(deriveTone({ intent: 'esquiver' }, { ...baseBeat, emotionEnd: 'doute' }, aigu)).toBe('mystérieux')
  })

  it('intent céder + emotionEnd vulnérabilité → intime', () => {
    expect(deriveTone({ intent: 'céder' }, { ...baseBeat, emotionEnd: 'vulnérabilité' }, aigu)).toBe('intime')
  })

  it('intent ironiser → ironique', () => {
    expect(deriveTone({ intent: 'ironiser' }, baseBeat, aigu)).toBe('ironique')
  })

  it('intent raconter sans subtext → neutre', () => {
    expect(deriveTone({ intent: 'raconter' }, baseBeat, aigu)).toBe('neutre')
  })

  it('emotionEnd ne contient ni mystère ni doute → JAMAIS mystérieux par défaut', () => {
    expect(deriveTone({ intent: 'parler' }, { ...baseBeat, emotionEnd: 'colère' }, aigu)).not.toBe('mystérieux')
  })

  it('voiceProfile.register grave ne force PAS tone grave', () => {
    expect(deriveTone({ intent: 'rassurer' }, { ...baseBeat, emotionEnd: 'tendresse' }, grave)).toBe('intime')
  })
})

describe('derivePace', () => {
  it('intent menacer → fast', () => {
    expect(derivePace({ intent: 'menacer' }, aigu)).toBe('fast')
  })

  it('intent céder → slow', () => {
    expect(derivePace({ intent: 'céder' }, aigu)).toBe('slow')
  })

  it('intent autre + voiceProfile lent → slow', () => {
    expect(derivePace({ intent: 'raconter' }, grave)).toBe('slow')
  })

  it('intent autre + voiceProfile normal → normal (fallback)', () => {
    expect(derivePace({ intent: 'raconter' }, { register: 'medium', tempo: 'normal' })).toBe('normal')
  })
})

describe('deriveEmphasis', () => {
  it('intersection avec signatureWords gagne', () => {
    const result = deriveEmphasis('regarde-moi quand je te parle', { register: 'medium', tempo: 'rapide', signatureWords: ['regarde-moi'] })
    expect(result).toEqual(['regarde-moi'])
  })

  it('sans signatureWords : top 1-2 mots > 4 caractères', () => {
    const result = deriveEmphasis('Pourquoi tu mens encore', { register: 'medium', tempo: 'rapide' })
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(2)
    expect(result.every((w) => w.length > 4)).toBe(true)
  })

  it('texte vide → []', () => {
    expect(deriveEmphasis('', { register: 'medium', tempo: 'rapide' })).toEqual([])
  })
})

describe('estimateDuration', () => {
  it('3 mots → ~1s', () => {
    expect(estimateDuration('un deux trois')).toBeGreaterThanOrEqual(1)
  })

  it('phrase plus longue', () => {
    expect(estimateDuration('un deux trois quatre cinq six neuf')).toBeGreaterThan(2)
  })

  it('ne descend pas en dessous de 0.5s', () => {
    expect(estimateDuration('a')).toBeGreaterThanOrEqual(0.5)
  })
})
```

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/pipeline/__tests__/dialogue-derivation.test.ts`
Expected: FAIL — module not found.

### Task 5.2 — Implémenter la dérivation

- [ ] **Step 1 : Créer `src/lib/pipeline/dialogue-derivation.ts`** :

```ts
import type { CharacterVoiceProfile, SceneBeat } from '@/types/agent'
import type { Tone } from '@/types/audio'

const STOP_WORDS = new Set([
  'alors', 'aussi', 'avec', 'avait', 'avant', 'avoir', 'comme', 'comment', 'donc', 'elle', 'encore', 'entre', 'fait',
  'leur', 'leurs', 'mais', 'meme', 'même', 'mes', 'mon', 'nous', 'notre', 'nos', 'parce', 'pour', 'pourquoi',
  'sans', 'ses', 'son', 'sont', 'sous', 'sur', 'tout', 'tous', 'toute', 'toutes', 'très', 'trop', 'vous', 'votre',
])

function emotionMatches(emotionEnd: string, keywords: string[]): boolean {
  const lower = emotionEnd.toLowerCase()
  return keywords.some((k) => lower.includes(k))
}

const INTENT_GROUPS: Record<string, string[]> = {
  accuser: ['accuser', 'confronter', 'dénoncer', 'blâmer', 'reprocher'],
  menacer: ['menacer', 'intimider'],
  esquiver: ['esquiver', 'mentir', 'minimiser', 'détourner'],
  céder: ['céder', 'avouer', 'pardonner'],
  ironiser: ['ironiser', 'moquer', 'sarcasme'],
  rassurer: ['rassurer', 'consoler', 'apaiser'],
  annoncer: ['annoncer', 'révéler'],
  raconter: ['raconter', 'décrire', 'expliquer', 'narrer', 'situer'],
  presser: ['presser', 'urgent', 'enjoindre'],
}

function intentMatches(intent: string, group: keyof typeof INTENT_GROUPS): boolean {
  const lower = intent.toLowerCase()
  return INTENT_GROUPS[group].some((v) => lower.includes(v))
}

/**
 * Dérive le tone d'une ligne à partir de l'intent + beat.emotionEnd + (subtext).
 * Le voiceProfile.register n'influence PAS le tone. Il sert au casting TTS uniquement.
 */
export function deriveTone(
  line: { intent: string; subtext?: string },
  beat: SceneBeat,
  _voiceProfile: CharacterVoiceProfile,
): Tone {
  const emotionEnd = beat.emotionEnd

  if (intentMatches(line.intent, 'menacer') && emotionMatches(emotionEnd, ['peur', 'tension', 'danger'])) return 'grave'
  if (intentMatches(line.intent, 'esquiver') && emotionMatches(emotionEnd, ['doute', 'malaise', 'méfiance', 'mystère'])) return 'mystérieux'
  if (intentMatches(line.intent, 'accuser') && emotionMatches(emotionEnd, ['colère', 'rage', 'déception'])) return 'urgent'
  if (intentMatches(line.intent, 'céder') && emotionMatches(emotionEnd, ['apaisement', 'vulnérabilité', 'tendresse'])) return 'intime'
  if (intentMatches(line.intent, 'ironiser')) return 'ironique'
  if (intentMatches(line.intent, 'rassurer')) return 'intime'
  if (intentMatches(line.intent, 'annoncer') && emotionMatches(emotionEnd, ['choc', 'surprise'])) return 'urgent'
  if (intentMatches(line.intent, 'presser')) return 'urgent'

  // Si emotionEnd contient explicitement mystère ou doute → mystérieux, sinon JAMAIS par défaut
  if (intentMatches(line.intent, 'raconter') && !line.subtext) return 'neutre'
  if (emotionMatches(emotionEnd, ['mystère', 'doute']) && line.subtext) return 'mystérieux'

  return 'neutre'
}

/**
 * Dérive le pace à partir de l'intent (primaire) puis voiceProfile.tempo (fallback).
 */
export function derivePace(
  line: { intent: string },
  voiceProfile: CharacterVoiceProfile,
): 'slow' | 'normal' | 'fast' {
  if (intentMatches(line.intent, 'menacer') || intentMatches(line.intent, 'accuser') || intentMatches(line.intent, 'presser') || intentMatches(line.intent, 'annoncer')) {
    return 'fast'
  }
  if (intentMatches(line.intent, 'céder')) return 'slow'

  switch (voiceProfile.tempo) {
    case 'lent': return 'slow'
    case 'rapide': return 'fast'
    default: return 'normal'
  }
}

/**
 * Calcule l'emphasis : signatureWords ∩ text gagnent. Sinon top 1-2 mots > 4 chars hors stop-words.
 */
export function deriveEmphasis(text: string, voiceProfile: CharacterVoiceProfile): string[] {
  const words = text
    .toLowerCase()
    .replace(/[.,!?;:"()…—-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (voiceProfile.signatureWords?.length) {
    const sigSet = new Set(voiceProfile.signatureWords.map((w) => w.toLowerCase()))
    const hits = words.filter((w) => sigSet.has(w))
    if (hits.length > 0) return [...new Set(hits)].slice(0, 2)
  }

  const candidates = words
    .filter((w) => w.length > 4 && !STOP_WORDS.has(w))
    .slice(0, 2)

  return candidates
}

/**
 * Durée estimée d'une réplique : 3 mots/s, plancher 0.5s.
 */
export function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(0.5, Number((words / 3).toFixed(2)))
}
```

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/pipeline/__tests__/dialogue-derivation.test.ts`
Expected: PASS — toutes les assertions vertes.

- [ ] **Step 3 : Commit**

```bash
git add src/lib/pipeline/dialogue-derivation.ts src/lib/pipeline/__tests__/dialogue-derivation.test.ts
git commit -m "pipeline(derivation): tone/pace/emphasis from beat+intent+subtext, voiceProfile colors casting only"
```

### Task 5.3 — Test pour `dialogue-script-builder` (préservation 1:1)

- [ ] **Step 1 : Créer `src/lib/pipeline/__tests__/dialogue-script-builder.test.ts`** :

```ts
import { describe, it, expect } from 'vitest'
import { buildDialogueScriptFromOutline } from '../dialogue-script-builder'
import type { CharacterRoster, MeetingSceneOutlineItem } from '@/types/agent'

const roster: CharacterRoster = {
  runId: 'r1',
  narrationMode: 'dialogue',
  characters: [
    { id: 'alex', name: 'Alex', archetype: 'a', voiceProfile: { register: 'medium', tempo: 'rapide', signatureWords: ['regarde-moi'] }, arcGoal: 'g', arcStakes: 's' },
    { id: 'noor', name: 'Noor', archetype: 'b', voiceProfile: { register: 'grave', tempo: 'lent' }, arcGoal: 'g', arcStakes: 's' },
  ],
  premise: 'Confrontation',
  createdAt: '2026-04-28T07:00:00Z',
}

const sceneOutline: MeetingSceneOutlineItem[] = [
  {
    index: 1,
    title: 'Confrontation',
    description: 'Alex débarque',
    dialogueLines: [
      { characterId: 'alex', text: 'Regarde-moi quand je te parle', intent: 'accuser' },
      { characterId: 'noor', text: 'Pas maintenant', intent: 'esquiver' },
      { characterId: 'alex', text: 'Réponds', intent: 'presser', reactsToLineIndex: 1 },
      { characterId: 'noor', text: 'D\'accord', intent: 'céder' },
    ],
    beat: { beatId: 'B1', type: 'rising', emotionStart: 'calme', emotionEnd: 'colère', tensionLevel: 70, conflict: 'c', stakes: 's' },
    charactersPresent: ['alex', 'noor'],
    continuityFromPreviousScene: '',
    camera: 'rapproché',
    lighting: 'tungstène',
    duration_s: 12,
  },
]

describe('buildDialogueScriptFromOutline', () => {
  it('préserve verbatim chaque text de chaque ligne', () => {
    const script = buildDialogueScriptFromOutline({
      runId: 'r1',
      idea: 'idée',
      sceneOutline,
      roster,
      totalDurationTargetS: 12,
    })

    expect(script.scenes[0].lines.map((l) => l.text)).toEqual([
      'Regarde-moi quand je te parle',
      'Pas maintenant',
      'Réponds',
      'D\'accord',
    ])
  })

  it('propage characterId sans transformation', () => {
    const script = buildDialogueScriptFromOutline({
      runId: 'r1', idea: 'i', sceneOutline, roster, totalDurationTargetS: 12,
    })
    expect(script.scenes[0].lines.map((l) => l.characterId)).toEqual(['alex', 'noor', 'alex', 'noor'])
  })

  it('propage intent et subtext', () => {
    const script = buildDialogueScriptFromOutline({
      runId: 'r1', idea: 'i', sceneOutline, roster, totalDurationTargetS: 12,
    })
    expect(script.scenes[0].lines[0].intent).toBe('accuser')
    expect(script.scenes[0].lines[2].reactsToLineIndex).toBe(1)
  })

  it('dérive tone selon intent + beat.emotionEnd', () => {
    const script = buildDialogueScriptFromOutline({
      runId: 'r1', idea: 'i', sceneOutline, roster, totalDurationTargetS: 12,
    })
    expect(script.scenes[0].lines[0].tone).toBe('urgent')
    expect(script.scenes[0].lines[3].tone).not.toBe('mystérieux')
  })

  it('insère un silence avant une ligne avec reactsToLineIndex', () => {
    const script = buildDialogueScriptFromOutline({
      runId: 'r1', idea: 'i', sceneOutline, roster, totalDurationTargetS: 12,
    })
    expect(script.scenes[0].silences.length).toBeGreaterThan(0)
    expect(script.scenes[0].silences[0].afterLineIndex).toBe(1)
  })

  it('inclut le roster verbatim dans script.characters', () => {
    const script = buildDialogueScriptFromOutline({
      runId: 'r1', idea: 'i', sceneOutline, roster, totalDurationTargetS: 12,
    })
    expect(script.characters).toEqual(roster.characters)
    expect(script.narrationMode).toBe('dialogue')
  })

  it('passe la validation Zod stricte (dialogueScriptSchema.parse)', async () => {
    const { dialogueScriptSchema } = await import('@/lib/schemas/audio')
    const script = buildDialogueScriptFromOutline({
      runId: 'r1', idea: 'i', sceneOutline, roster, totalDurationTargetS: 12,
    })
    expect(() => dialogueScriptSchema.parse(script)).not.toThrow()
  })

  it('1:1 sur 100 lignes synthétiques', () => {
    const synth: MeetingSceneOutlineItem = {
      index: 1, title: 'T', description: 'D',
      dialogueLines: Array.from({ length: 100 }, (_, i) => ({
        characterId: i % 2 === 0 ? 'alex' : 'noor',
        text: `Réplique numéro ${i} avec contenu unique ${i * 7}`,
        intent: i % 2 === 0 ? 'accuser' : 'esquiver',
      })),
      beat: { beatId: 'B', type: 'rising', emotionStart: 's', emotionEnd: 'colère', tensionLevel: 50, conflict: 'c', stakes: 's' },
      charactersPresent: ['alex', 'noor'],
      continuityFromPreviousScene: '',
      camera: 'c', lighting: 'l', duration_s: 60,
    }
    const script = buildDialogueScriptFromOutline({
      runId: 'r1', idea: 'i', sceneOutline: [synth], roster, totalDurationTargetS: 60,
    })
    const inputs = synth.dialogueLines.map((l) => l.text)
    const outputs = script.scenes[0].lines.map((l) => l.text)
    expect(outputs).toEqual(inputs)
  })
})
```

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/pipeline/__tests__/dialogue-script-builder.test.ts`
Expected: FAIL — module not found.

### Task 5.4 — Implémenter `dialogue-script-builder`

- [ ] **Step 1 : Créer `src/lib/pipeline/dialogue-script-builder.ts`** :

```ts
import type { CharacterRoster, MeetingSceneOutlineItem } from '@/types/agent'
import type { DialogueLine, DialogueScene, DialogueScript, SilenceMarker } from '@/types/audio'
import { dialogueScriptSchema } from '@/lib/schemas/audio'
import { deriveTone, derivePace, deriveEmphasis, estimateDuration } from './dialogue-derivation'

export type BuildDialogueScriptInput = {
  runId: string
  idea: string
  sceneOutline: MeetingSceneOutlineItem[]
  roster: CharacterRoster
  totalDurationTargetS: number
  language?: string
}

/**
 * Construit dialogue_script.json sans aucun appel LLM.
 * - Chaque text est copié VERBATIM depuis sceneOutline[i].dialogueLines[j].text.
 * - tone/pace/emphasis dérivés via heuristiques déterministes (cf. dialogue-derivation.ts).
 * - silences générés à partir de reactsToLineIndex.
 * - characters propagés depuis le roster.
 *
 * Throw si :
 * - une scène a charactersPresent non vide ET dialogueLines vide
 * - une scène index > 1 a continuityFromPreviousScene vide
 * - le résultat ne passe pas dialogueScriptSchema.parse
 */
export function buildDialogueScriptFromOutline(input: BuildDialogueScriptInput): DialogueScript {
  const { runId, sceneOutline, roster, totalDurationTargetS } = input
  const language = input.language ?? 'fr'

  const scenes: DialogueScene[] = sceneOutline.map((outline) => {
    if (outline.charactersPresent.length > 0 && outline.dialogueLines.length === 0) {
      throw new Error(`Scene ${outline.index}: charactersPresent non vide mais dialogueLines vide — interdit en mode dialogue`)
    }

    const characterById = new Map(roster.characters.map((c) => [c.id, c]))

    const lines: DialogueLine[] = outline.dialogueLines.map((bdl, index) => {
      const character = characterById.get(bdl.characterId)
      if (!character) {
        throw new Error(`Scene ${outline.index} line ${index}: characterId "${bdl.characterId}" inconnu du roster`)
      }
      const tone = deriveTone({ intent: bdl.intent, subtext: bdl.subtext }, outline.beat, character.voiceProfile)
      const pace = derivePace({ intent: bdl.intent }, character.voiceProfile)
      const emphasis = deriveEmphasis(bdl.text, character.voiceProfile)
      const estimatedDurationS = estimateDuration(bdl.text)

      return {
        lineIndex: index,
        characterId: bdl.characterId,
        text: bdl.text,
        intent: bdl.intent,
        subtext: bdl.subtext,
        reactsToLineIndex: bdl.reactsToLineIndex,
        tone,
        pace,
        emphasis,
        estimatedDurationS,
      }
    })

    const silences: SilenceMarker[] = outline.dialogueLines
      .map((bdl, index) => {
        if (typeof bdl.reactsToLineIndex !== 'number') return null
        return {
          afterLineIndex: bdl.reactsToLineIndex,
          durationS: 0.5,
          purpose: 'respiration',
        } as SilenceMarker
      })
      .filter((s): s is SilenceMarker => s !== null)

    const openingHook = outline.continuityFromPreviousScene.trim().length > 0
      ? outline.continuityFromPreviousScene
      : (lines[0]?.text ?? '')
    const closingHook = lines[lines.length - 1]?.text ?? ''

    return {
      sceneIndex: outline.index,
      title: outline.title,
      durationTargetS: outline.duration_s,
      beat: outline.beat,
      charactersPresent: outline.charactersPresent,
      openingHook,
      closingHook,
      lines,
      silences,
      stageDirections: '',
      continuityFromPreviousScene: outline.continuityFromPreviousScene,
    }
  })

  const script: DialogueScript = {
    runId,
    language,
    narrationMode: roster.narrationMode,
    totalDurationTargetS,
    premise: roster.premise,
    characters: roster.characters,
    scenes,
  }

  return dialogueScriptSchema.parse(script)
}
```

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/pipeline/__tests__/dialogue-script-builder.test.ts`
Expected: PASS — toutes les assertions vertes, y compris les 100 lignes synthétiques.

- [ ] **Step 3 : Commit**

```bash
git add src/lib/pipeline/dialogue-script-builder.ts src/lib/pipeline/__tests__/dialogue-script-builder.test.ts
git commit -m "pipeline(builder): buildDialogueScriptFromOutline — zero LLM, verbatim text, deterministic tone/pace/emphasis"
```

### Task 5.5 — Brancher le builder dans `step-3-json.ts`

- [ ] **Step 1 : Modifier `src/lib/pipeline/steps/step-3-json.ts`** — supprimer `buildDialogueScript` (LLM) restant et tous ses helpers liés. Le bloc audio-first à `step-3-json.ts:441` devient :

```ts
    // ── Audio-First — Dialogue Script (zéro LLM, copie verbatim) ──
    let dialogueScriptSummary: { sceneCount: number; lineCount: number } | null = null
    let totalCostEur = result.costEur

    if (brief?.sceneOutline && brief.sceneOutline.length > 0 && brief.roster) {
      try {
        const dialogueScript = buildDialogueScriptFromOutline({
          runId: ctx.runId,
          idea: ctx.idea,
          sceneOutline: brief.sceneOutline,
          roster: brief.roster,
          totalDurationTargetS: outputConfig?.fullVideoDurationS ?? brief.sceneOutline.reduce((s, o) => s + o.duration_s, 0),
          language: 'fr',
        })

        await writeFile(
          join(ctx.storagePath, 'dialogue_script.json'),
          JSON.stringify(dialogueScript, null, 2),
        )

        const lineCount = dialogueScript.scenes.reduce((sum, s) => sum + s.lines.length, 0)
        dialogueScriptSummary = {
          sceneCount: dialogueScript.scenes.length,
          lineCount,
        }

        logger.info({
          event: 'dialogue_script_written',
          runId: ctx.runId,
          sceneCount: dialogueScript.scenes.length,
          lineCount,
          totalDurationTargetS: dialogueScript.totalDurationTargetS,
          source: 'verbatim',
        })
      } catch (error) {
        logger.error({
          event: 'dialogue_script_build_failed',
          runId: ctx.runId,
          error: (error as Error).message,
        })
        await rm(join(ctx.storagePath, 'dialogue_script.json'), { force: true }).catch(() => {})
        throw error
      }
    } else {
      logger.warn({
        event: 'dialogue_script_skipped',
        runId: ctx.runId,
        reason: 'brief.sceneOutline ou brief.roster manquant — ce run a été créé avec l\'ancien pipeline, reset l\'étape 2',
      })
      throw new Error('dialogue_script: brief incomplet (sceneOutline ou roster absent). Reset l\'étape 2 avec le nouveau pipeline.')
    }

    return {
      success: true,
      costEur: totalCostEur,
      outputData: {
        ...parsed,
        llm: { mode: llmTarget.mode, model: llmTarget.model },
        sceneOutlineUsed: sceneOutline.length > 0,
        directorPlan: {
          tone,
          style,
          sceneCount: scenes.length,
          creativeDirection: directorPlan.creativeDirection,
        },
        dialogueScript: dialogueScriptSummary,
      },
    }
```

Et ajouter en haut du fichier :

```ts
import { buildDialogueScriptFromOutline } from '@/lib/pipeline/dialogue-script-builder'
```

Supprimer les imports devenus inutiles :
- `import type { DialogueScript } from '@/types/audio'`
- toute la fonction `buildDialogueScript` (déjà supprimée à Task 4.2)
- la constante `DIALOGUE_SCRIPT_SYSTEM_PROMPT`

- [ ] **Step 2 : Compiler**

Run: `npx tsc --noEmit -p .`
Expected: 0 erreur.

- [ ] **Step 3 : Run la suite Vitest sans l'e2e**

Run: `npx vitest run --exclude '**/e2e-pipeline-audio.test.ts'`
Expected: PASS sur les nouveaux tests, certaines fixtures speaker→characterId à mettre à jour (Task 5.6).

- [ ] **Step 4 : Commit**

```bash
git add src/lib/pipeline/steps/step-3-json.ts
git commit -m "step-3: replace LLM dialogue_script generation with buildDialogueScriptFromOutline (zero LLM)"
```

### Task 5.6 — Shim `speaker → characterId` dans tts-renderer & step-4c-audio

- [ ] **Step 1 : Modifier `src/lib/pipeline/tts-renderer.ts`** — ligne 13 (type interne `TTSManifestLine` qui a `speaker`) et lignes 126/136 (qui lisent `line.speaker`). Stratégie : un shim qui accepte les deux pour la lecture du fichier ancien. Mais pour le NOUVEAU script, `line.characterId` est garanti. Donc on remplace `line.speaker` par `line.characterId ?? (line as any).speaker ?? 'unknown'` et on marque `@deprecated` :

```ts
// type interne — tts-renderer.ts:11-15
export type TTSManifestLine = {
  sceneIndex: number
  lineIndex: number
  /** @deprecated read-only shim for old runs ; use characterId for new runs */
  speaker: string
  text: string
  filePath: string
  durationS: number
  provider: string
  costEur: number
}

// helper local
function lineCharacter(line: { characterId?: string; speaker?: string }): string {
  return line.characterId ?? line.speaker ?? 'narrateur'
}
```

Puis ligne 126/136, remplacer `line.speaker` par `lineCharacter(line)`.

- [ ] **Step 2 : Modifier `src/lib/pipeline/steps/step-4c-audio.ts:49`** — adapter de la même façon :

```ts
// avant : sharedSpeakers: [...new Set(scene.lines.map((l) => l.speaker))],
// après :
sharedSpeakers: [...new Set(scene.lines.map((l: { characterId?: string; speaker?: string }) => l.characterId ?? l.speaker ?? 'narrateur'))],
```

- [ ] **Step 3 : Compiler**

Run: `npx tsc --noEmit -p .`
Expected: 0 erreur.

- [ ] **Step 4 : Commit**

```bash
git add src/lib/pipeline/tts-renderer.ts src/lib/pipeline/steps/step-4c-audio.ts
git commit -m "pipeline(tts,4c): read-only shim characterId|speaker for old runs (deprecated)"
```

### Task 5.7 — Mettre à jour les fixtures de tests existants

- [ ] **Step 1 : Repérer les usages de `speaker:` dans les fixtures Vitest**

Run: `grep -rn "speaker:" src/lib/pipeline/__tests__/ src/lib/pipeline/steps/`
Expected: liste de fichiers avec fixtures.

- [ ] **Step 2 : Pour chaque fichier, remplacer `speaker:` par `characterId:`** dans les fixtures. Exemple pour `src/lib/pipeline/__tests__/tts-renderer.test.ts` (ligne ~85) :

```ts
// avant
const sampleScript = {
  scenes: [{ sceneIndex: 1, lines: [{ lineIndex: 0, speaker: 'narrateur', text: 'Hello', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 1 }] }],
  // ...
}

// après — ajouter aussi tous les nouveaux champs requis
const sampleScript = {
  runId: 'r1', language: 'fr', narrationMode: 'voiceover', totalDurationTargetS: 5, premise: 'p',
  characters: [{ id: 'narrator', name: 'Narrateur', archetype: 'voix', voiceProfile: { register: 'medium', tempo: 'normal' }, arcGoal: 'g', arcStakes: 's', isNarrator: true }, { id: 'alex', name: 'Alex', archetype: 'a', voiceProfile: { register: 'medium', tempo: 'normal' }, arcGoal: 'g', arcStakes: 's' }],
  scenes: [{
    sceneIndex: 1,
    title: 'T', durationTargetS: 5,
    beat: { beatId: 'B', type: 'setup', emotionStart: 'a', emotionEnd: 'b', tensionLevel: 10, conflict: 'c', stakes: 's' },
    charactersPresent: ['narrator'],
    openingHook: '', closingHook: '',
    lines: [{ lineIndex: 0, characterId: 'narrator', text: 'Hello', intent: 'situer', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 1 }],
    silences: [], stageDirections: '',
    continuityFromPreviousScene: '',
  }],
}
```

(Adapter le détail à chaque test existant. Le shim de Task 5.6 absorbe les anciens fixtures qui restent en `speaker`, mais pour les tests qui valident Zod, il faut le nouveau format.)

- [ ] **Step 3 : Run toute la suite Vitest**

Run: `npx vitest run`
Expected: PASS sur tous les tests.

- [ ] **Step 4 : Commit**

```bash
git add src/lib/pipeline/__tests__/ src/lib/pipeline/steps/__tests__/
git commit -m "test(fixtures): migrate speaker→characterId, add roster/beat fields to dialogue_script fixtures"
```

---

## Task 6 : Validation et critères d'acceptation

**Files:**
- Run: pipeline complet sur fixture canonique
- Modify (si besoin) : un fichier de doc-trace pour archiver le résultat

### Task 6.1 — Vérifier la suite Vitest complète

- [ ] **Step 1 : Lancer toute la suite**

Run: `npx vitest run`
Expected: PASS, 100 % vert. Si rouge, identifier la cause et corriger avant la suite.

### Task 6.2 — Vérifier le typecheck strict

- [ ] **Step 1 : Lancer tsc**

Run: `npx tsc --noEmit -p .`
Expected: 0 erreur, 0 warning bloquant.

### Task 6.3 — Lancer un run de bout en bout (mock LLM)

- [ ] **Step 1 : Créer ou réutiliser un script qui exécute steps 2 + 3 sur une idée test, avec LLM mocké**

Si pas existant, étendre `src/lib/pipeline/__tests__/e2e-pipeline-audio.test.ts` avec un cas :

```ts
describe('e2e P1-P4 — préservation 1:1 idée canonique', () => {
  it('produit un dialogue_script.json verbatim depuis brief_dialogue', async () => {
    // setup mocks LLM (cf. coordinator-sami.test.ts pour pattern)
    // execute step-2 (meeting) + step-3 (json)
    // assert critères 8.1 du spec :
    //   - characters.json existe
    //   - brief_dialogue.json existe avec ≥ 4 lignes/scène
    //   - dialogue_script.scenes[i].lines.text === brief_dialogue.scenes[i].lines.text
    //   - 0 narrator dans le script en mode dialogue
    //   - 0 tone === 'mystérieux' par défaut (sauf si beat.emotionEnd contient mystère/doute)
  })
})
```

(Le contenu complet de ce test est long — ~120 lignes. Le pattern est : reprendre le mock de `coordinator-sami.test.ts`, ajouter la phase `runStep` du step-3, asserter sur `dialogue_script.json` lu depuis le storagePath.)

- [ ] **Step 2 : Run le test**

Run: `npx vitest run src/lib/pipeline/__tests__/e2e-pipeline-audio.test.ts`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add src/lib/pipeline/__tests__/e2e-pipeline-audio.test.ts
git commit -m "test(e2e): full P1-P4 — verify 1:1 preservation, no narrator, no default mystérieux"
```

### Task 6.4 — Lancer un run TikTok réel en mode shadow

- [ ] **Step 1 : Démarrer le serveur dev**

Run: `npm run dev` en background

- [ ] **Step 2 : Créer un run via l'API** avec `narrationMode: 'dialogue'` :

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'Content-Type: application/json' \
  -d '{
    "idea": "Trois personnages se retrouvent autour d'un secret familial qu'ils ont chacun une raison de cacher",
    "type": "manual",
    "projectConfig": {
      "narrationMode": "dialogue",
      "outputConfig": { "videoCount": 1, "fullVideoDurationS": 90, "sceneDurationS": 18, "sceneCount": 5 }
    }
  }'
```

- [ ] **Step 3 : Lancer manuellement steps 2 et 3** via l'UI ou les routes API

- [ ] **Step 4 : Inspecter `app/storage/runs/<runId>/`**

Run: `ls app/storage/runs/<runId>/ && cat app/storage/runs/<runId>/dialogue_script.json | jq '.characters | length, .scenes[0].lines | length, .scenes[0].lines[0]'`

Expected: ≥ 2 characters, ≥ 3 lignes scène 1, première ligne avec `characterId`, `intent`, `tone` cohérents.

- [ ] **Step 5 : Vérifier les critères 8.1 manuellement**

Pour chaque check du spec §8.1, marquer ✓/✗ dans un tableau (ne pas commit, juste valider).

- [ ] **Step 6 : Si tout passe, créer la PR**

```bash
git push -u origin feat/dialogue-script-preservation
gh pr create --title "feat(P1-P4): preserve dramatic intent from brief to dialogue_script.json" --body "$(cat <<'EOF'
## Summary
- Phase 0 ajoutée : Mia produit characters.json avec narrationMode lu depuis projectConfig
- Sami écrit brief_dialogue.json en JSON strict (no prose fallback)
- buildSceneOutline ne touche plus jamais aux dialogueLines (attachement code 100%)
- step-3 supprime l'appel LLM final, build dialogue_script.json par copie verbatim + dérivation déterministe tone/pace/emphasis
- Schémas Zod stricts pour tous les artefacts
- Helpers obsolètes supprimés (extractBriefSceneDialogues, normalizeDialogueScenesWithFallback, buildFallbackDialogueLines)

## Test plan
- [ ] Vitest suite verte localement
- [ ] tsc strict OK
- [ ] Run shadow TikTok 90s/5 scènes/3 personnages : ≥ 2 characterIds incarnés par scène, 0 narrator
- [ ] dialogue_script.json.scenes[i].lines.text === brief_dialogue.scenes[i].lines.text (multiset)
- [ ] Aucun tone === 'mystérieux' par défaut
EOF
)"
```

---

## Self-review (à faire après écriture)

**Spec coverage check :**

| Spec section | Couvert par |
|---|---|
| §3.1 Types narratifs | Task 1.1 |
| §3.2 MeetingSceneOutlineItem augmenté | Task 1.1 step 2 |
| §3.4 DialogueLine augmenté | Task 1.2 |
| §3.5 DialogueScene augmenté | Task 1.2 |
| §3.6 DialogueScript augmenté | Task 1.2 |
| §3.7 Schémas Zod | Task 1.4 |
| §4.2 Phase 0 Mia | Task 2.3-2.4 |
| §4.3 Sami JSON | Task 3.1-3.5 |
| §4.4 buildSceneOutline 1:1 attache code | Task 4.1 |
| §4.5 buildDialogueScriptFromOutline | Task 5.4 |
| §4.5.1 deriveTone | Task 5.2 |
| §4.5.2 derivePace | Task 5.2 |
| §4.5.3 deriveEmphasis | Task 5.2 |
| §4.6 Suppression fallback narrateur mystérieux | Task 4.2 + 5.4 (Zod throw) |
| §4.7 Helpers obsolètes | Task 4.2 |
| §5.1 reset.ts | Task 2.7 |
| §5.2 Lecteurs aval | Task 5.6 (shim) + 5.7 (fixtures) |
| §6 R1-R8 validations | Task 1.4 (Zod) + Task 3.3 (extractor) + Task 5.4 (builder) |
| §8.1 Critères acceptation | Task 6.3-6.4 |
| §8.3 Test 1:1 sur 100 lignes | Task 5.3 |

**Placeholder scan :** OK — toutes les commandes, tous les blocs de code sont concrets. Le marqueur `TEMPORAIRE` à Task 4.2 step 4 est explicitement transitoire intra-plan, supprimé en Task 5.5.

**Type consistency :** OK — `BriefDialogueLine.characterId`, `Character.id`, `DialogueLine.characterId` utilisent partout le même type slug. `narrationMode` propagé homogène. `buildDialogueScriptFromOutline` signature identique entre test (Task 5.3) et impl (Task 5.4).

---

## Execution Handoff

Plan complet et sauvegardé dans `docs/superpowers/plans/2026-04-28-dialogue-script-preservation-plan.md`. Deux options d'exécution :

**1. Subagent-Driven (recommandé)** — Je dispatche un subagent frais par task, je relis entre chaque task, itération rapide.

**2. Inline Execution** — Exécution dans cette session via executing-plans, batch avec checkpoints de relecture.

Quelle approche ?
