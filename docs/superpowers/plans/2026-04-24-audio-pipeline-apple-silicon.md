# Audio Pipeline Apple Silicon — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un pipeline audio local Apple Silicon qui produit un "package audio maître" scène par scène (narration + FX + ambiance + musique) avant toute génération vidéo, afin que la vidéo soit calée sur l'audio et non l'inverse.

**Architecture:** Nouveau step pipeline `step-4c-audio` inséré entre le blueprint visuel (step 4) et les prompts vidéo (step 5). Ce step consomme le `brief.json` + `structure.json` produits par les agents (Sami, Jade, Remi, Theo) et orchestre : extraction dialogues → TTS local → mix ambiance/FX → rendu timeline → export WAV maître + manifest JSON. L'audio maître conditionne ensuite les durées exactes des prompts vidéo en step 5.

**Tech Stack:** Kokoro TTS (local, Metal-ready), FFmpeg (concat + filtergraph + amix), faster-whisper (validation STT), Node.js spawn pour orchestration, providers existants (`lib/providers/tts/`).

---

## Lots et dépendances

```
LOT 1 — Canon audio (schéma + types)         ← aucune dépendance
LOT 2 — Runtime local Apple Silicon           ← dépend de LOT 1
LOT 3 — Intégration pipeline                  ← dépend de LOT 1 + LOT 2
```

**Ordre recommandé :** LOT 1 → LOT 2 → LOT 3 (séquentiel strict).

---

## Validation Copilot — retour sur l'implémentation Claude du 24/04

### Verdict rapide

Le retour Claude est **globalement sérieux et utile** : il y a du vrai code, une vraie insertion du step audio, et un bon réflexe de **graceful degradation**. En revanche, il faut être lucide : **ce n'est pas encore la cible produit décrite par ce plan**, mais plutôt un **V1 stable “dialogue-first”**.

Autrement dit :

- **oui**, il y a une avancée réelle ;
- **non**, le chantier n'est pas “fini produit” ;
- **oui**, il faut maintenant reframer la suite pour éviter une dette d'architecture audio parallèle.

### Ce que Claude a bien fait

- **Insertion pipeline propre du step audio**

  - le pipeline est bien passé à **10 étapes** ;
  - `step-4c-audio.ts` est inséré avant `step-5-prompts.ts` ;
  - `step-5-prompts.ts` lit bien `audio/audio-master-manifest.json` pour enrichir le contexte LLM.

- **Orientation stabilité plutôt que démo fragile**

  - le step audio saute proprement si `dialogue_script.json` est absent ;
  - le step continue si TTS indisponible ;
  - le mix scène retombe sur une copie directe du TTS si FFmpeg mix échoue ;
  - l'assemblage master ne casse pas tout le pipeline en cas d'échec.

- **Bonne décision implicite : réduction de scope réelle**

  Au lieu d'implémenter brutalement toute l'ambition LLM + sound design + musique + FX, Claude a choisi une voie **plus conservative** fondée sur le `dialogue_script.json` existant. Pour la stabilité court terme, c'est une décision saine.

### Ce que Claude n'a PAS encore livré malgré les cases cochées

#### 1) La cible “audio package maître complet” n'est pas atteinte

Le plan décrit un package audio maître enrichi par :

- brief multi-agents,
- intentions audio par scène,
- ambiance,
- FX,
- musique,
- logique Apple Silicon / Metal,
- validation STT.

Dans le code actuel, le step `step-4c-audio.ts` fait surtout :

- lecture de `dialogue_script.json`,
- TTS existant,
- concat / mix basique,
- master WAV,
- manifest JSON.

Donc le vrai statut est :

- **livré** : audio dialogue-first structuré,
- **non livré** : sound design complet piloté par brief,
- **non livré** : pipeline ambiance / FX / musique,
- **non livré** : orchestration Apple Silicon spécifique,
- **non livré** : validation STT promise dans le plan.

#### 2) Le master audio n'est pas encore la source de vérité de la preview finale

Point critique : `step-5-prompts.ts` utilise bien les durées du master audio, **mais `step-6-generation.ts` continue à régénérer un `audioPath` TTS séparé** à partir de `structure.json`.

Conséquence :

- les prompts vidéo peuvent être calés sur le master audio,
- **mais la preview finale ne consomme pas encore naturellement le master audio produit au step 4c**,
- donc l'objectif “la vidéo est calée sur l'audio maître, pas l'inverse” est **seulement partiellement atteint**.

À ce stade, le pipeline a surtout :

- un **audio timing source** pour l'étape prompts,
- pas encore un **audio backbone unique** pour toute la chaîne.

#### 3) Il existe maintenant deux systèmes audio partiellement redondants

Le repo contient déjà une ancienne famille de modules audio :

- `src/lib/pipeline/audio-manifest.ts`
- `src/lib/pipeline/audio-assembler.ts`
- `src/lib/pipeline/tts-renderer.ts`

et maintenant une nouvelle famille :

- `src/lib/audio/tts-render.ts`
- `src/lib/audio/mix-scene.ts`
- `src/lib/audio/mix-master.ts`
- `src/lib/pipeline/steps/step-4c-audio.ts`

Le résultat actuel est **fonctionnel mais architecturalement ambigu**.

Risque :

- duplication de responsabilités,
- divergence de conventions (`audio_preview.wav` vs `master.wav`),
- dette de maintenance,
- incompréhension pour Claude aux prochaines itérations.

#### 4) Le reset pipeline est incohérent après passage à 10 étapes

`src/lib/pipeline/reset.ts` semble encore indexé selon l'ancienne numérotation logique des artefacts.

Exemple actuel :

- l'étape `6` efface `prompts.json`, alors que le step 6 est désormais **Audio Package** ;
- l'étape `7` efface `generation-manifest.json`, `clips`, `audio`, etc., alors que le step 7 est désormais **Prompts Seedance**.

Donc il y a un **angle mort critique de recovery / step-back / rerun**.

Tant que ce point n'est pas corrigé, il est dangereux de considérer le chantier comme stabilisé.

#### 5) La persistance `audio_asset` promise par le plan n'est pas vraiment branchée dans le step 4c actuel

Le plan parlait de persister un artefact audio en base. Le schéma `audioAsset` existe bien, mais la version actuelle de `step-4c-audio.ts` **ne semble pas faire cette persistance DB**.

Donc :

- le fichier disque existe,
- mais l'intégration data / back-office / auditabilité reste incomplète.

#### 6) Le runtime “Apple Silicon / Metal” promis n'est pas réellement au centre de l'exécution courante

Le plan parlait de probe Apple Silicon, Kokoro, Whisper, concurrency, etc. Dans la trajectoire réellement codée, ce n'est **pas le levier principal de l'orchestration step 4c actuelle**.

Donc le nom du plan reste plus ambitieux que le runtime réellement exploité.

### Lecture honnête du statut

Le statut réel n'est pas “8 tasks done = chantier clos”. Le statut honnête est plutôt :

- **Phase 1 livrée** : insertion d'un step audio stable, basé sur le script dialogué,
- **Phase 2 partiellement livrée** : utilisation des durées audio pour les prompts,
- **Phase 3 non livrée** : unification complète du pipeline autour d'un master audio unique,
- **Phase 4 non livrée** : sound design/musique/FX/validation avancée.

### Ce que je valide malgré tout

Je valide les choix suivants comme **bons pivots de maturité** :

- avoir préféré un step audio **simple mais stable** plutôt qu'un faux full-feature fragile ;
- avoir branché les durées audio dans `step-5-prompts.ts` ;
- avoir fait des fallbacks explicites ;
- avoir renuméroté le pipeline vers 10 étapes sans casser la compilation principale.

### Ce que je challenge explicitement

Je challenge les formulations ou sous-entendus suivants :

- **“les 8 tasks sont terminées”** → oui côté exécution locale Claude, **non côté promesse produit finale** ;
- **“audio master manifest alimente maintenant le contexte LLM”** → vrai, mais **ce n'est pas encore une source unique pour toute la chaîne média** ;
- **“pipeline audio Apple Silicon complet”** → trop fort par rapport à ce qui est effectivement branché.

### Priorités de reprise recommandées

#### P1 — Corriger la cohérence reset / recovery / step-back

Avant tout enrichissement fonctionnel, corriger `src/lib/pipeline/reset.ts` pour réaligner les artefacts avec les nouvelles étapes 6→10.

Sans cela, les reruns seront trompeurs et la stabilité apparente sera fragile.

#### P2 — Décider la source audio unique du pipeline

Choix à trancher explicitement :

- soit `audio/master.wav` devient la **source de vérité** pour preview/publication,
- soit le step 4c reste seulement un **pré-calage pour prompts**.

Mais il faut choisir, car l'état intermédiaire actuel mélange deux logiques audio.

#### P3 — Éliminer la duplication d'architecture audio

Décider quelle couche est canonique :

- `src/lib/pipeline/audio-manifest.ts` / `audio-assembler.ts`
- ou la nouvelle pile `src/lib/audio/*`

Puis :

- soit fusionner,
- soit déprécier clairement l'ancienne.

#### P4 — Rendre explicite le statut “dialogue-first V1” dans le document

Le document doit éviter d'induire en erreur le prochain agent.

Il faut donc formuler clairement que la version réellement livrée est :

- **V1 dialogue-first**,
- sans ambiance/FX/musique réels,
- sans runtime Apple Silicon pleinement exploité,
- avec master audio utilisé surtout pour les durées en amont.

### Message opérationnel à donner à Claude pour la suite

Claude doit considérer cette itération comme :

- **bonne base technique**,
- **pas encore le produit final**,
- **à consolider avant d'enrichir**.

Priorité absolue :

1. réaligner reset/recovery,  
2. choisir la source audio unique,  
3. supprimer les doublons d'architecture,  
4. seulement ensuite enrichir musique/FX/ambiance/validation.

### Verdict final Copilot

Le retour Claude mérite un **feu orange très positif** :

- **vert** sur l'exécution et la discipline de fallback,
- **orange** sur la cohérence d'architecture et la vérité produit,
- **pas encore vert complet** sur la cible finale “audio-first master-driven pipeline”.

En clair : **bon chantier, bon pivot, mais pas fin de chantier**.

---

## Fichiers impactés

### Créer

| Fichier | Responsabilité |
|---------|---------------|
| `src/lib/audio/scene-canon.ts` | Schéma canonique SceneAudioPackage + validation Zod |
| `src/lib/audio/scene-canon.test.ts` | Tests unitaires du canon |
| `src/lib/audio/tts-render.ts` | Rendu TTS par scène (dialogue → WAV par ligne) |
| `src/lib/audio/tts-render.test.ts` | Tests TTS render |
| `src/lib/audio/mix-scene.ts` | Mix mono-scène (dialogue + ambiance + FX → WAV scène) |
| `src/lib/audio/mix-scene.test.ts` | Tests mix scène |
| `src/lib/audio/mix-master.ts` | Assemblage timeline multi-scènes → WAV maître |
| `src/lib/audio/mix-master.test.ts` | Tests mix master |
| `src/lib/audio/metal-probe.ts` | Détection capabilities Metal / ANE sur Apple Silicon |
| `src/lib/audio/metal-probe.test.ts` | Tests probe |
| `src/lib/pipeline/steps/step-4c-audio.ts` | Step pipeline audio package |
| `src/lib/pipeline/steps/step-4c-audio.test.ts` | Tests step pipeline |

### Modifier

| Fichier | Modification |
|---------|-------------|
| `src/types/audio.ts` | Ajouter `SceneAudioPackage`, `AudioMasterManifest`, `InterSceneDependency` |
| `src/lib/pipeline/engine.ts` | Insérer `step4cAudio` dans le tableau STEPS |
| `src/lib/pipeline/constants.ts` | Ajouter step 4c dans PIPELINE_STEP_DEFINITIONS, renuméroter |
| `src/lib/pipeline/steps/step-5-prompts.ts` | Lire audio-master-manifest.json pour caler les durées |
| `src/lib/providers/types.ts` | Ajouter type `AudioMixProvider` dans BaseProvider.type union |

---

# LOT 1 — Canon audio

## Schéma canonique JSON d'une scène audio

```json
{
  "$schema": "SceneAudioPackage",
  "version": "1.0",
  "runId": "run_abc123",
  "sceneIndex": 0,
  "title": "L'appel",

  "narration": {
    "lines": [
      {
        "lineIndex": 0,
        "speaker": "narrateur",
        "text": "Il n'avait jamais vu la mer.",
        "tone": "intime",
        "pace": "slow",
        "emphasis": ["jamais"],
        "estimatedDurationS": 3.2
      }
    ],
    "silences": [
      { "afterLineIndex": 0, "durationS": 1.5, "purpose": "respiration" }
    ],
    "stageDirections": "Voix basse, presque murmurée"
  },

  "intention": {
    "emotion": "nostalgie",
    "narrativeRole": "exposition",
    "tensionLevel": 30,
    "videoPromptHint": "Homme de dos face à l'horizon, lumière dorée rasante"
  },

  "ambiance": {
    "description": "bord de mer, vent léger, mouettes lointaines",
    "intensity": "subtle",
    "stereoWidth": "wide",
    "sourceHint": "freesound:sea-ambient-01"
  },

  "fx": [
    {
      "triggerAt": "with_line",
      "lineIndex": 0,
      "description": "vague qui s'écrase doucement",
      "intensity": "soft",
      "sourceHint": null
    }
  ],

  "music": {
    "mood": "mélancolie douce",
    "tempo": "slow",
    "intensity": 25,
    "instrumentation": "piano solo",
    "placement": "under_dialogue",
    "volumeRelativeToDialogue": "background",
    "buildUp": null,
    "sourceHint": null
  },

  "timing": {
    "targetDurationS": 8.5,
    "minDurationS": 7.0,
    "maxDurationS": 10.0,
    "transitionIn": { "type": "fade_in", "durationMs": 500 },
    "transitionOut": { "type": "crossfade", "durationMs": 800 }
  },

  "dependencies": {
    "continuesAmbianceFrom": null,
    "continuesMusicFrom": null,
    "requiredBeforeScene": [1],
    "sharedSpeakers": ["narrateur"]
  }
}
```

## Manifest audio maître (multi-scènes)

```json
{
  "$schema": "AudioMasterManifest",
  "version": "1.0",
  "runId": "run_abc123",
  "totalDurationS": 45.2,
  "sampleRate": 44100,
  "channels": 2,
  "masterFilePath": "storage/runs/run_abc123/audio/master.wav",

  "scenes": [
    {
      "sceneIndex": 0,
      "startS": 0.0,
      "endS": 8.5,
      "durationS": 8.5,
      "ttsFilePath": "storage/runs/run_abc123/audio/scenes/0/tts.wav",
      "mixFilePath": "storage/runs/run_abc123/audio/scenes/0/mix.wav",
      "status": "assembled",
      "ttsProvider": "kokoro-local",
      "costEur": 0
    }
  ],

  "qualityChecks": {
    "allScenesRendered": true,
    "totalCostEur": 0,
    "sttValidation": {
      "enabled": true,
      "wer": 0.05,
      "provider": "faster-whisper"
    }
  },

  "generatedAt": "2026-04-24T10:00:00Z"
}
```

---

### Task 1: Types canoniques SceneAudioPackage

**Files:**
- Modify: `src/types/audio.ts`
- Create: `src/lib/audio/scene-canon.ts`
- Create: `src/lib/audio/scene-canon.test.ts`

- [ ] **Step 1: Écrire le test du canon**

```typescript
// src/lib/audio/scene-canon.test.ts
import { describe, it, expect } from 'vitest'
import { parseSceneAudioPackage, parseAudioMasterManifest } from './scene-canon'

describe('SceneAudioPackage', () => {
  it('valide un package scène complet', () => {
    const input = {
      version: '1.0',
      runId: 'run_test',
      sceneIndex: 0,
      title: 'Scène test',
      narration: {
        lines: [{
          lineIndex: 0, speaker: 'narrateur', text: 'Bonjour.',
          tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 1.5,
        }],
        silences: [],
        stageDirections: '',
      },
      intention: { emotion: 'neutre', narrativeRole: 'exposition', tensionLevel: 50, videoPromptHint: 'Test' },
      ambiance: { description: 'silence', intensity: 'subtle', stereoWidth: 'narrow' },
      fx: [],
      music: {
        mood: 'neutre', tempo: 'moderate', intensity: 50,
        instrumentation: 'none', placement: 'under_dialogue',
        volumeRelativeToDialogue: 'background',
      },
      timing: {
        targetDurationS: 5, minDurationS: 3, maxDurationS: 8,
        transitionIn: { type: 'cut', durationMs: 0 },
        transitionOut: { type: 'cut', durationMs: 0 },
      },
      dependencies: { sharedSpeakers: ['narrateur'] },
    }
    const result = parseSceneAudioPackage(input)
    expect(result.success).toBe(true)
  })

  it('rejette un package sans narration', () => {
    const result = parseSceneAudioPackage({ version: '1.0', sceneIndex: 0 })
    expect(result.success).toBe(false)
  })
})

describe('AudioMasterManifest', () => {
  it('valide un manifest vide (0 scènes)', () => {
    const result = parseAudioMasterManifest({
      version: '1.0', runId: 'run_test', totalDurationS: 0,
      sampleRate: 44100, channels: 2, masterFilePath: '/tmp/master.wav',
      scenes: [], qualityChecks: { allScenesRendered: true, totalCostEur: 0 },
      generatedAt: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd /Users/malik/Documents/claude-atelier/FILM\ CREW\ 🎬/app && npx vitest run src/lib/audio/scene-canon.test.ts`
Expected: FAIL — module `./scene-canon` introuvable

- [ ] **Step 3: Ajouter les types dans audio.ts**

Ajouter à la fin de `src/types/audio.ts` :

```typescript
// ─── Canon audio scène — v1.0 ───

export type SceneIntention = {
  emotion: string
  narrativeRole: string
  tensionLevel: number        // 0-100
  videoPromptHint: string
}

export type SceneTiming = {
  targetDurationS: number
  minDurationS: number
  maxDurationS: number
  transitionIn: AudioTransition
  transitionOut: AudioTransition
}

export type InterSceneDependency = {
  continuesAmbianceFrom?: number | null
  continuesMusicFrom?: number | null
  requiredBeforeScene?: number[]
  sharedSpeakers: string[]
}

export type SceneAudioPackage = {
  version: '1.0'
  runId: string
  sceneIndex: number
  title: string
  narration: {
    lines: DialogueLine[]
    silences: SilenceMarker[]
    stageDirections: string
  }
  intention: SceneIntention
  ambiance: AmbianceLayer
  fx: SoundFX[]
  music: Omit<SceneMusicIntent, 'sceneIndex'>
  timing: SceneTiming
  dependencies: InterSceneDependency
}

export type SceneAudioRenderStatus = {
  sceneIndex: number
  startS: number
  endS: number
  durationS: number
  ttsFilePath: string
  mixFilePath: string
  status: AudioAssetStatus
  ttsProvider: string
  costEur: number
}

export type AudioQualityChecks = {
  allScenesRendered: boolean
  totalCostEur: number
  sttValidation?: {
    enabled: boolean
    wer: number
    provider: string
  }
}

export type AudioMasterManifest = {
  version: '1.0'
  runId: string
  totalDurationS: number
  sampleRate: number
  channels: number
  masterFilePath: string
  scenes: SceneAudioRenderStatus[]
  qualityChecks: AudioQualityChecks
  generatedAt: string
}
```

- [ ] **Step 4: Implémenter scene-canon.ts avec validation Zod**

```typescript
// src/lib/audio/scene-canon.ts
import { z } from 'zod'
import type { SceneAudioPackage, AudioMasterManifest } from '@/types/audio'

const dialogueLineSchema = z.object({
  lineIndex: z.number().int().min(0),
  speaker: z.string().min(1),
  text: z.string().min(1),
  tone: z.string().min(1),
  pace: z.enum(['slow', 'normal', 'fast']),
  emphasis: z.array(z.string()),
  estimatedDurationS: z.number().positive(),
})

const silenceMarkerSchema = z.object({
  afterLineIndex: z.number().int().min(0),
  durationS: z.number().positive(),
  purpose: z.string().min(1),
})

const transitionSchema = z.object({
  type: z.enum(['cut', 'crossfade', 'fade_out', 'fade_in', 'swoosh']),
  durationMs: z.number().min(0),
})

const sceneAudioPackageSchema = z.object({
  version: z.literal('1.0'),
  runId: z.string().min(1),
  sceneIndex: z.number().int().min(0),
  title: z.string().min(1),
  narration: z.object({
    lines: z.array(dialogueLineSchema).min(1),
    silences: z.array(silenceMarkerSchema),
    stageDirections: z.string(),
  }),
  intention: z.object({
    emotion: z.string().min(1),
    narrativeRole: z.string().min(1),
    tensionLevel: z.number().min(0).max(100),
    videoPromptHint: z.string().min(1),
  }),
  ambiance: z.object({
    description: z.string().min(1),
    intensity: z.enum(['subtle', 'present', 'dominant']),
    stereoWidth: z.enum(['narrow', 'wide', 'immersive']),
    sourceHint: z.string().optional(),
  }),
  fx: z.array(z.object({
    triggerAt: z.enum(['start', 'end', 'with_line']),
    lineIndex: z.number().int().min(0).optional(),
    description: z.string().min(1),
    intensity: z.enum(['soft', 'medium', 'hard']),
    sourceHint: z.string().nullable().optional(),
  })),
  music: z.object({
    mood: z.string().min(1),
    tempo: z.enum(['slow', 'moderate', 'fast']),
    intensity: z.number().min(0).max(100),
    instrumentation: z.string().min(1),
    placement: z.enum(['under_dialogue', 'between_lines', 'full_scene']),
    volumeRelativeToDialogue: z.enum(['background', 'equal', 'dominant']),
    buildUp: z.object({
      from: z.number().min(0).max(100),
      to: z.number().min(0).max(100),
      curve: z.enum(['linear', 'exponential', 'sudden']),
    }).nullable().optional(),
    sourceHint: z.string().nullable().optional(),
  }),
  timing: z.object({
    targetDurationS: z.number().positive(),
    minDurationS: z.number().positive(),
    maxDurationS: z.number().positive(),
    transitionIn: transitionSchema,
    transitionOut: transitionSchema,
  }),
  dependencies: z.object({
    continuesAmbianceFrom: z.number().int().min(0).nullable().optional(),
    continuesMusicFrom: z.number().int().min(0).nullable().optional(),
    requiredBeforeScene: z.array(z.number().int().min(0)).optional(),
    sharedSpeakers: z.array(z.string()),
  }),
})

const masterManifestSchema = z.object({
  version: z.literal('1.0'),
  runId: z.string().min(1),
  totalDurationS: z.number().min(0),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().min(1).max(2),
  masterFilePath: z.string().min(1),
  scenes: z.array(z.object({
    sceneIndex: z.number().int().min(0),
    startS: z.number().min(0),
    endS: z.number().min(0),
    durationS: z.number().min(0),
    ttsFilePath: z.string().min(1),
    mixFilePath: z.string().min(1),
    status: z.enum(['draft', 'assembled', 'validated', 'rejected']),
    ttsProvider: z.string().min(1),
    costEur: z.number().min(0),
  })),
  qualityChecks: z.object({
    allScenesRendered: z.boolean(),
    totalCostEur: z.number().min(0),
    sttValidation: z.object({
      enabled: z.boolean(),
      wer: z.number().min(0).max(1),
      provider: z.string().min(1),
    }).optional(),
  }),
  generatedAt: z.string(),
})

export function parseSceneAudioPackage(data: unknown): { success: true; data: SceneAudioPackage } | { success: false; errors: string[] } {
  const result = sceneAudioPackageSchema.safeParse(data)
  if (result.success) return { success: true, data: result.data as SceneAudioPackage }
  return { success: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }
}

export function parseAudioMasterManifest(data: unknown): { success: true; data: AudioMasterManifest } | { success: false; errors: string[] } {
  const result = masterManifestSchema.safeParse(data)
  if (result.success) return { success: true, data: result.data as AudioMasterManifest }
  return { success: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd /Users/malik/Documents/claude-atelier/FILM\ CREW\ 🎬/app && npx vitest run src/lib/audio/scene-canon.test.ts`
Expected: 2 tests PASS

- [ ] **Step 6: Commit LOT 1**

```bash
git add src/types/audio.ts src/lib/audio/scene-canon.ts src/lib/audio/scene-canon.test.ts
git commit -m "feat(audio): canon scène audio + manifest maître avec validation Zod"
```

---

# LOT 2 — Runtime local Apple Silicon

## Stack locale retenue

| Composant | Outil | Metal/ANE | Justification |
|-----------|-------|-----------|---------------|
| **TTS** | Kokoro (localhost:8880) | Metal via MLX backend | Déjà intégré, voix FR, 0 coût, ~2x realtime sur M1+ |
| **TTS fallback** | macOS `say` → ffmpeg | CoreAudio natif | Toujours dispo, qualité moindre |
| **Mix audio** | FFmpeg `amix` + `adelay` | VideoToolbox pour encode | Installé, filtergraph puissant, 0 coût |
| **STT validation** | faster-whisper (Python) | CoreML/Metal via ctranslate2 | Déjà utilisé dans step-7, WER < 10% pour FR |
| **Silence detect** | FFmpeg `silencedetect` | — | Gratuit, fiable |
| **Probe durée** | FFmpeg `ffprobe` | — | Déjà dans `ffmpeg-media.ts` |

### Pourquoi PAS d'autres outils ?

- **Coqui TTS** : plus maintenu, lourd, pas de Metal natif
- **Bark** : trop lent (10x realtime), pas de streaming
- **AudioCraft/MusicGen** : Metal support expérimental, 7GB RAM, hors scope LOT 2
- **SoX** : redondant avec FFmpeg déjà installé

---

### Task 2: Probe Metal / Apple Silicon

**Files:**
- Create: `src/lib/audio/metal-probe.ts`
- Create: `src/lib/audio/metal-probe.test.ts`

- [ ] **Step 1: Écrire le test**

```typescript
// src/lib/audio/metal-probe.test.ts
import { describe, it, expect } from 'vitest'
import { probeAppleSilicon } from './metal-probe'

describe('probeAppleSilicon', () => {
  it('retourne un objet avec les capabilities', async () => {
    const result = await probeAppleSilicon()
    expect(result).toHaveProperty('isMac')
    expect(result).toHaveProperty('chip')
    expect(result).toHaveProperty('metalSupport')
    expect(result).toHaveProperty('ffmpegVideoToolbox')
    expect(result).toHaveProperty('kokoroAvailable')
    expect(result).toHaveProperty('whisperAvailable')
    expect(typeof result.isMac).toBe('boolean')
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `npx vitest run src/lib/audio/metal-probe.test.ts`
Expected: FAIL

- [ ] **Step 3: Implémenter metal-probe.ts**

```typescript
// src/lib/audio/metal-probe.ts
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export type AppleSiliconCapabilities = {
  isMac: boolean
  chip: string | null            // "Apple M1 Pro", "Apple M2 Max", etc.
  metalSupport: boolean
  ffmpegVideoToolbox: boolean
  kokoroAvailable: boolean
  whisperAvailable: boolean
  recommendedConcurrency: number // nombre de scènes TTS en parallèle
}

async function tryExec(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 5000 })
    return stdout.trim()
  } catch {
    return null
  }
}

export async function probeAppleSilicon(): Promise<AppleSiliconCapabilities> {
  const platform = process.platform
  const isMac = platform === 'darwin'

  let chip: string | null = null
  let metalSupport = false
  let ffmpegVideoToolbox = false
  let kokoroAvailable = false
  let whisperAvailable = false

  if (isMac) {
    // Chip detection
    const sysctl = await tryExec('sysctl -n machdep.cpu.brand_string')
    chip = sysctl

    // Metal = tout Apple Silicon (M1+) l'a
    metalSupport = !!chip?.includes('Apple')

    // FFmpeg VideoToolbox
    const encoders = await tryExec('ffmpeg -hide_banner -encoders 2>/dev/null | grep videotoolbox')
    ffmpegVideoToolbox = !!encoders

    // Kokoro health
    try {
      const res = await fetch('http://localhost:8880/health', { signal: AbortSignal.timeout(2000) })
      kokoroAvailable = res.ok
    } catch { /* down */ }

    // faster-whisper
    const whisper = await tryExec('python3 -c "import faster_whisper; print(1)" 2>/dev/null')
    whisperAvailable = whisper === '1'
  }

  // Concurrency : M1=2, M2/M3 Pro=3, Max/Ultra=4
  let recommendedConcurrency = 1
  if (chip?.includes('Ultra')) recommendedConcurrency = 4
  else if (chip?.includes('Max')) recommendedConcurrency = 4
  else if (chip?.includes('Pro')) recommendedConcurrency = 3
  else if (chip?.includes('Apple')) recommendedConcurrency = 2

  return { isMac, chip, metalSupport, ffmpegVideoToolbox, kokoroAvailable, whisperAvailable, recommendedConcurrency }
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/audio/metal-probe.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/metal-probe.ts src/lib/audio/metal-probe.test.ts
git commit -m "feat(audio): probe Apple Silicon capabilities (Metal, Kokoro, Whisper)"
```

---

### Task 3: TTS Render par scène

**Files:**
- Create: `src/lib/audio/tts-render.ts`
- Create: `src/lib/audio/tts-render.test.ts`

- [ ] **Step 1: Écrire le test**

```typescript
// src/lib/audio/tts-render.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderSceneTTS } from './tts-render'
import type { SceneAudioPackage } from '@/types/audio'

// Mock du provider TTS
vi.mock('@/lib/providers/registry', () => ({
  registry: {
    getByType: () => [{
      name: 'mock-tts',
      type: 'tts',
      healthCheck: async () => ({ status: 'free', lastCheck: new Date().toISOString() }),
      estimateCost: () => 0,
      synthesize: async (text: string, _v: string, _l: string, dir?: string) => ({
        filePath: `${dir}/tts-mock-${Date.now()}.wav`,
        duration: text.split(/\s+/).length / 2.5, // ~150 mots/min
        costEur: 0,
      }),
    }],
    getBest: async () => null,
  },
}))

const minimalScene: SceneAudioPackage = {
  version: '1.0',
  runId: 'run_test',
  sceneIndex: 0,
  title: 'Test',
  narration: {
    lines: [
      { lineIndex: 0, speaker: 'narrateur', text: 'Bonjour le monde.', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 2 },
      { lineIndex: 1, speaker: 'narrateur', text: 'Fin.', tone: 'neutre', pace: 'normal', emphasis: [], estimatedDurationS: 1 },
    ],
    silences: [{ afterLineIndex: 0, durationS: 0.5, purpose: 'respiration' }],
    stageDirections: '',
  },
  intention: { emotion: 'neutre', narrativeRole: 'exposition', tensionLevel: 50, videoPromptHint: '' },
  ambiance: { description: 'silence', intensity: 'subtle', stereoWidth: 'narrow' },
  fx: [],
  music: { mood: 'neutre', tempo: 'moderate', intensity: 50, instrumentation: 'none', placement: 'under_dialogue', volumeRelativeToDialogue: 'background' },
  timing: { targetDurationS: 5, minDurationS: 3, maxDurationS: 8, transitionIn: { type: 'cut', durationMs: 0 }, transitionOut: { type: 'cut', durationMs: 0 } },
  dependencies: { sharedSpeakers: ['narrateur'] },
}

describe('renderSceneTTS', () => {
  it('produit un résultat avec les WAV par ligne + WAV concaténé', async () => {
    const result = await renderSceneTTS(minimalScene, '/tmp/test-audio')
    expect(result.lineFiles).toHaveLength(2)
    expect(result.totalDurationS).toBeGreaterThan(0)
    expect(result.provider).toBe('mock-tts')
    expect(result.costEur).toBe(0)
  })
})
```

- [ ] **Step 2: Vérifier échec**

Run: `npx vitest run src/lib/audio/tts-render.test.ts`
Expected: FAIL

- [ ] **Step 3: Implémenter tts-render.ts**

```typescript
// src/lib/audio/tts-render.ts
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { spawn } from 'child_process'
import { registry } from '@/lib/providers/registry'
import type { TTSProvider, AudioResult } from '@/lib/providers/types'
import type { SceneAudioPackage, DialogueLine } from '@/types/audio'
import { logger } from '@/lib/logger'

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'
const TTS_PRIORITY = (process.env.TTS_PRIORITY || 'kokoro-local,system-tts').split(',').map(s => s.trim())

export type TTSLineResult = {
  lineIndex: number
  filePath: string
  durationS: number
}

export type SceneTTSResult = {
  sceneIndex: number
  lineFiles: TTSLineResult[]
  concatFilePath: string
  totalDurationS: number
  provider: string
  costEur: number
}

function generateSilenceWav(durationS: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`,
      '-t', String(durationS),
      '-y', outputPath,
    ]
    const proc = spawn(FFMPEG_BIN, args)
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`silence gen exit ${code}`)))
    proc.on('error', (err) => reject(err))
  })
}

function concatWavFiles(files: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Utiliser le filtre concat pour éviter les problèmes d'en-tête WAV
    const inputs = files.flatMap(f => ['-i', f])
    const filter = files.map((_, i) => `[${i}:a]`).join('') + `concat=n=${files.length}:v=0:a=1[out]`
    const args = [...inputs, '-filter_complex', filter, '-map', '[out]', '-y', outputPath]
    const proc = spawn(FFMPEG_BIN, args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`concat exit ${code}: ${stderr.slice(-200)}`)))
    proc.on('error', (err) => reject(err))
  })
}

async function selectTTSProvider(): Promise<TTSProvider> {
  const allTTS = registry.getByType('tts') as TTSProvider[]
  // Respecter l'ordre de priorité TTS_PRIORITY
  for (const name of TTS_PRIORITY) {
    const provider = allTTS.find(p => p.name === name)
    if (!provider) continue
    const health = await provider.healthCheck()
    if (health.status === 'free' || health.status === 'degraded') return provider
  }
  // Fallback: premier provider disponible
  for (const provider of allTTS) {
    const health = await provider.healthCheck()
    if (health.status !== 'down') return provider
  }
  throw new Error('Aucun provider TTS disponible')
}

export async function renderSceneTTS(scene: SceneAudioPackage, outputDir: string): Promise<SceneTTSResult> {
  const sceneDir = join(outputDir, `scenes`, String(scene.sceneIndex))
  await mkdir(sceneDir, { recursive: true })

  const ttsProvider = await selectTTSProvider()
  const lineFiles: TTSLineResult[] = []
  const segmentPaths: string[] = []
  let totalCost = 0

  for (const line of scene.narration.lines) {
    const result = await ttsProvider.synthesize(line.text, 'default', 'fr', sceneDir)
    const lineResult: TTSLineResult = {
      lineIndex: line.lineIndex,
      filePath: result.filePath,
      durationS: result.duration,
    }
    lineFiles.push(lineResult)
    segmentPaths.push(result.filePath)
    totalCost += result.costEur

    // Insérer un silence après cette ligne si spécifié
    const silence = scene.narration.silences.find(s => s.afterLineIndex === line.lineIndex)
    if (silence) {
      const silencePath = join(sceneDir, `silence-after-${line.lineIndex}.wav`)
      await generateSilenceWav(silence.durationS, silencePath)
      segmentPaths.push(silencePath)
    }
  }

  // Concaténer tous les segments en un seul WAV
  const concatFilePath = join(sceneDir, 'tts.wav')
  if (segmentPaths.length === 1) {
    // Un seul fichier, pas besoin de concat
    const { copyFile } = await import('fs/promises')
    await copyFile(segmentPaths[0], concatFilePath)
  } else if (segmentPaths.length > 1) {
    await concatWavFiles(segmentPaths, concatFilePath)
  }

  const totalDurationS = lineFiles.reduce((sum, l) => sum + l.durationS, 0)
    + scene.narration.silences.reduce((sum, s) => sum + s.durationS, 0)

  logger.info({
    event: 'scene_tts_rendered',
    sceneIndex: scene.sceneIndex,
    lines: lineFiles.length,
    totalDurationS,
    provider: ttsProvider.name,
  })

  return {
    sceneIndex: scene.sceneIndex,
    lineFiles,
    concatFilePath,
    totalDurationS,
    provider: ttsProvider.name,
    costEur: totalCost,
  }
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/audio/tts-render.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/tts-render.ts src/lib/audio/tts-render.test.ts
git commit -m "feat(audio): TTS render par scène avec failover provider"
```

---

### Task 4: Mix mono-scène (dialogue + ambiance + FX)

**Files:**
- Create: `src/lib/audio/mix-scene.ts`
- Create: `src/lib/audio/mix-scene.test.ts`

- [ ] **Step 1: Écrire le test**

```typescript
// src/lib/audio/mix-scene.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildSceneMixCommand } from './mix-scene'

describe('buildSceneMixCommand', () => {
  it('génère un filtergraph FFmpeg avec dialogue seul', () => {
    const cmd = buildSceneMixCommand({
      ttsPath: '/tmp/tts.wav',
      ambiancePath: null,
      fxPaths: [],
      musicPath: null,
      outputPath: '/tmp/mix.wav',
      volumes: { dialogue: 1.0, ambiance: 0.3, fx: 0.6, music: 0.12 },
      targetDurationS: 10,
    })
    expect(cmd.args).toContain('-i')
    expect(cmd.args).toContain('/tmp/tts.wav')
    expect(cmd.args).toContain('/tmp/mix.wav')
  })

  it('génère un amix à 3 entrées avec ambiance et musique', () => {
    const cmd = buildSceneMixCommand({
      ttsPath: '/tmp/tts.wav',
      ambiancePath: '/tmp/ambiance.wav',
      fxPaths: [],
      musicPath: '/tmp/music.wav',
      outputPath: '/tmp/mix.wav',
      volumes: { dialogue: 1.0, ambiance: 0.3, fx: 0.6, music: 0.12 },
      targetDurationS: 10,
    })
    expect(cmd.args.join(' ')).toContain('amix')
  })
})
```

- [ ] **Step 2: Vérifier échec**

Run: `npx vitest run src/lib/audio/mix-scene.test.ts`
Expected: FAIL

- [ ] **Step 3: Implémenter mix-scene.ts**

```typescript
// src/lib/audio/mix-scene.ts
import { spawn } from 'child_process'

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'

export type MixVolumes = {
  dialogue: number   // 1.0
  ambiance: number   // 0.3
  fx: number         // 0.6
  music: number      // 0.12
}

export type SceneMixConfig = {
  ttsPath: string
  ambiancePath: string | null
  fxPaths: string[]
  musicPath: string | null
  outputPath: string
  volumes: MixVolumes
  targetDurationS: number
}

export type FFmpegCommand = {
  bin: string
  args: string[]
}

export function buildSceneMixCommand(config: SceneMixConfig): FFmpegCommand {
  const { ttsPath, ambiancePath, fxPaths, musicPath, outputPath, volumes, targetDurationS } = config

  // Collecter toutes les entrées audio
  const inputs: string[] = [ttsPath]
  const volumeFilters: string[] = [`[0:a]volume=${volumes.dialogue}[d]`]
  const mixLabels: string[] = ['[d]']
  let inputIdx = 1

  if (ambiancePath) {
    inputs.push(ambiancePath)
    volumeFilters.push(`[${inputIdx}:a]aloop=loop=-1:size=2e+09,atrim=0:${targetDurationS},volume=${volumes.ambiance}[amb]`)
    mixLabels.push('[amb]')
    inputIdx++
  }

  for (let i = 0; i < fxPaths.length; i++) {
    inputs.push(fxPaths[i])
    volumeFilters.push(`[${inputIdx}:a]volume=${volumes.fx}[fx${i}]`)
    mixLabels.push(`[fx${i}]`)
    inputIdx++
  }

  if (musicPath) {
    inputs.push(musicPath)
    volumeFilters.push(`[${inputIdx}:a]aloop=loop=-1:size=2e+09,atrim=0:${targetDurationS},volume=${volumes.music}[mus]`)
    mixLabels.push('[mus]')
    inputIdx++
  }

  const args: string[] = []
  for (const input of inputs) {
    args.push('-i', input)
  }

  if (mixLabels.length === 1) {
    // Dialogue seul — pas de mix
    args.push('-y', outputPath)
  } else {
    const filterParts = [
      ...volumeFilters,
      `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2[out]`,
    ]
    args.push('-filter_complex', filterParts.join(';'))
    args.push('-map', '[out]', '-y', outputPath)
  }

  return { bin: FFMPEG_BIN, args }
}

export function mixScene(config: SceneMixConfig): Promise<void> {
  const cmd = buildSceneMixCommand(config)
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd.bin, cmd.args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`mix exit ${code}: ${stderr.slice(-300)}`)))
    proc.on('error', (err) => reject(err))
  })
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/audio/mix-scene.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/mix-scene.ts src/lib/audio/mix-scene.test.ts
git commit -m "feat(audio): mix mono-scène FFmpeg (dialogue + ambiance + FX + musique)"
```

---

### Task 5: Mix master multi-scènes

**Files:**
- Create: `src/lib/audio/mix-master.ts`
- Create: `src/lib/audio/mix-master.test.ts`

- [ ] **Step 1: Écrire le test**

```typescript
// src/lib/audio/mix-master.test.ts
import { describe, it, expect } from 'vitest'
import { buildMasterConcatList, computeTimeline } from './mix-master'
import type { SceneAudioPackage } from '@/types/audio'

describe('computeTimeline', () => {
  it('calcule les offsets cumulés corrects', () => {
    const sceneDurations = [
      { sceneIndex: 0, durationS: 5.0, transitionOutMs: 500 },
      { sceneIndex: 1, durationS: 8.0, transitionOutMs: 800 },
      { sceneIndex: 2, durationS: 3.0, transitionOutMs: 0 },
    ]
    const timeline = computeTimeline(sceneDurations)
    expect(timeline).toHaveLength(3)
    expect(timeline[0].startS).toBe(0)
    expect(timeline[0].endS).toBeCloseTo(5.0)
    // La scène 1 démarre après la scène 0 moins le crossfade
    expect(timeline[1].startS).toBeCloseTo(4.5) // 5.0 - 0.5s crossfade
    expect(timeline[2].startS).toBeCloseTo(11.7) // 4.5 + 8.0 - 0.8s
  })
})

describe('buildMasterConcatList', () => {
  it('produit le fichier concat FFmpeg', () => {
    const files = ['/a/0/mix.wav', '/a/1/mix.wav']
    const result = buildMasterConcatList(files)
    expect(result).toContain("file '/a/0/mix.wav'")
    expect(result).toContain("file '/a/1/mix.wav'")
  })
})
```

- [ ] **Step 2: Vérifier échec**

Run: `npx vitest run src/lib/audio/mix-master.test.ts`
Expected: FAIL

- [ ] **Step 3: Implémenter mix-master.ts**

```typescript
// src/lib/audio/mix-master.ts
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { spawn } from 'child_process'
import type { AudioMasterManifest, SceneAudioRenderStatus } from '@/types/audio'
import { logger } from '@/lib/logger'

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'

export type SceneDurationInfo = {
  sceneIndex: number
  durationS: number
  transitionOutMs: number
}

export type TimelineEntry = {
  sceneIndex: number
  startS: number
  endS: number
  durationS: number
}

export function computeTimeline(scenes: SceneDurationInfo[]): TimelineEntry[] {
  const timeline: TimelineEntry[] = []
  let cursor = 0

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    const startS = cursor
    const endS = startS + scene.durationS
    timeline.push({ sceneIndex: scene.sceneIndex, startS, endS, durationS: scene.durationS })
    // Prochaine scène : recule du crossfade de la transition sortante
    cursor = endS - scene.transitionOutMs / 1000
  }

  return timeline
}

export function buildMasterConcatList(mixFilePaths: string[]): string {
  return mixFilePaths.map(f => `file '${f}'`).join('\n')
}

function concatWithCrossfade(files: string[], outputPath: string): Promise<void> {
  // Simple concat (crossfades gérés en amont au niveau scène)
  return new Promise((resolve, reject) => {
    const inputs = files.flatMap(f => ['-i', f])
    const filter = files.map((_, i) => `[${i}:a]`).join('') + `concat=n=${files.length}:v=0:a=1[out]`
    const args = [...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '44100', '-ac', '2', '-y', outputPath]
    const proc = spawn(FFMPEG_BIN, args)
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`master concat exit ${code}: ${stderr.slice(-300)}`)))
    proc.on('error', (err) => reject(err))
  })
}

export async function assembleMaster(
  sceneResults: SceneAudioRenderStatus[],
  outputDir: string,
  runId: string,
): Promise<AudioMasterManifest> {
  await mkdir(outputDir, { recursive: true })

  const mixFiles = sceneResults.map(s => s.mixFilePath)
  const masterPath = join(outputDir, 'master.wav')

  if (mixFiles.length === 0) {
    throw new Error('Aucune scène audio à assembler')
  }

  await concatWithCrossfade(mixFiles, masterPath)

  // Compute timeline
  const timeline = computeTimeline(sceneResults.map(s => ({
    sceneIndex: s.sceneIndex,
    durationS: s.durationS,
    transitionOutMs: 0, // les transitions sont gérées en mix-scene
  })))

  // Enrichir les sceneResults avec les offsets
  const enrichedScenes: SceneAudioRenderStatus[] = sceneResults.map((s, i) => ({
    ...s,
    startS: timeline[i].startS,
    endS: timeline[i].endS,
  }))

  const totalDurationS = enrichedScenes.reduce((sum, s) => Math.max(sum, s.endS), 0)
  const totalCostEur = enrichedScenes.reduce((sum, s) => sum + s.costEur, 0)

  const manifest: AudioMasterManifest = {
    version: '1.0',
    runId,
    totalDurationS,
    sampleRate: 44100,
    channels: 2,
    masterFilePath: masterPath,
    scenes: enrichedScenes,
    qualityChecks: {
      allScenesRendered: enrichedScenes.every(s => s.status === 'assembled'),
      totalCostEur,
    },
    generatedAt: new Date().toISOString(),
  }

  await writeFile(join(outputDir, 'audio-master-manifest.json'), JSON.stringify(manifest, null, 2))

  logger.info({
    event: 'audio_master_assembled',
    runId,
    totalDurationS,
    sceneCount: enrichedScenes.length,
    totalCostEur,
  })

  return manifest
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/audio/mix-master.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/mix-master.ts src/lib/audio/mix-master.test.ts
git commit -m "feat(audio): assemblage master multi-scènes avec timeline"
```

---

# LOT 3 — Intégration pipeline

## Nouveau flux pipeline

```
Step 1  Idée
Step 2  Brainstorm (agents → brief.json avec sections Sami/Jade/Remi/Theo)
Step 3  JSON structuré (structure.json + director-plan.json + dialogue-script.json)
Step 4a Blueprint visuel
Step 4b Storyboard
Step 4c AUDIO PACKAGE ← NOUVEAU
        ├── Lit brief.json sections audio (Sami, Jade, Remi)
        ├── Lit structure.json pour les scènes
        ├── LLM génère SceneAudioPackage[] (canon) depuis les sections du brief
        ├── TTS render par scène (Kokoro local)
        ├── Mix par scène (FFmpeg amix)
        ├── Assemblage master (FFmpeg concat)
        ├── Validation STT optionnelle (faster-whisper)
        ├── Écrit audio-master-manifest.json
        ├── Écrit les WAV dans storage/runs/{id}/audio/
        └── Persiste en DB (audioAsset)
Step 5  Prompts vidéo ← MODIFIÉ : lit audio-master-manifest.json pour durées exactes
Step 6  Génération vidéo
Step 7  Preview ← déjà compatible (lit audioPath depuis manifest)
Step 8  Publication
```

### Critères d'acceptation

| Critère | Vérification |
|---------|-------------|
| Le canon JSON valide avec Zod | `parseSceneAudioPackage` retourne `success: true` |
| TTS Kokoro génère du WAV à 44100Hz | `ffprobe` sur chaque fichier |
| Mix scène produit un WAV unique par scène | Fichier existe, durée > 0s |
| Master WAV couvre toutes les scènes | `manifest.qualityChecks.allScenesRendered === true` |
| Step 5 utilise les durées audio | Prompt contient `duration_s` issu du manifest |
| Validation humaine possible | `audioAsset.status` peut être `validated` ou `rejected` |
| Pipeline ne casse pas si audio skip | Step 4c graceful degradation → step 5 fallback sur durées estimées |
| Perf : < 30s pour 5 scènes sur M1 | Mesuré via `logger` timestamps |

---

### Task 6: Step 4c audio dans le pipeline

**Files:**
- Create: `src/lib/pipeline/steps/step-4c-audio.ts`
- Create: `src/lib/pipeline/steps/step-4c-audio.test.ts`
- Modify: `src/lib/pipeline/engine.ts:14-34`
- Modify: `src/lib/pipeline/constants.ts:1-11`

- [ ] **Step 1: Écrire le test**

```typescript
// src/lib/pipeline/steps/step-4c-audio.test.ts
import { describe, it, expect, vi } from 'vitest'
import { step4cAudio } from './step-4c-audio'

vi.mock('@/lib/providers/registry', () => ({
  registry: {
    getByType: () => [{
      name: 'mock-tts',
      type: 'tts',
      healthCheck: async () => ({ status: 'free', lastCheck: new Date().toISOString() }),
      estimateCost: () => 0,
      synthesize: async (_t: string, _v: string, _l: string, dir?: string) => ({
        filePath: `${dir}/mock.wav`, duration: 3, costEur: 0,
      }),
    }],
    getBest: async () => null,
  },
}))

describe('step4cAudio', () => {
  it('a le bon numéro et nom', () => {
    expect(step4cAudio.name).toBe('Audio Package')
    expect(step4cAudio.stepNumber).toBe(6) // après storyboard (5)
  })
})
```

- [ ] **Step 2: Vérifier échec**

Run: `npx vitest run src/lib/pipeline/steps/step-4c-audio.test.ts`
Expected: FAIL

- [ ] **Step 3: Implémenter step-4c-audio.ts**

```typescript
// src/lib/pipeline/steps/step-4c-audio.ts
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import type { PipelineStep, StepContext, StepResult } from '../types'
import type { MeetingBrief } from '@/types/agent'
import type { SceneAudioPackage, AudioMasterManifest } from '@/types/audio'
import { parseSceneAudioPackage } from '@/lib/audio/scene-canon'
import { renderSceneTTS } from '@/lib/audio/tts-render'
import { mixScene, type MixVolumes } from '@/lib/audio/mix-scene'
import { assembleMaster } from '@/lib/audio/mix-master'
import { probeAppleSilicon } from '@/lib/audio/metal-probe'
import { logger } from '@/lib/logger'
import { getStepLlmConfig } from '@/lib/runs/project-config'
import { resolveLlmTarget } from '@/lib/llm/target'
import { db } from '@/lib/db/connection'
import { audioAsset } from '@/lib/db/schema'

const DEFAULT_VOLUMES: MixVolumes = {
  dialogue: 1.0,
  ambiance: 0.3,
  fx: 0.6,
  music: 0.12,
}

async function generateSceneAudioPackages(
  brief: MeetingBrief,
  structure: { scenes: { index: number; description: string; dialogue: string; duration_s: number }[] },
  ctx: StepContext,
): Promise<SceneAudioPackage[]> {
  // Extraire les sections audio du brief (Sami, Jade, Remi, Theo)
  const samiSection = brief.sections.find(s => s.agent === 'sami')?.content ?? ''
  const jadeSection = brief.sections.find(s => s.agent === 'jade')?.content ?? ''
  const remiSection = brief.sections.find(s => s.agent === 'remi')?.content ?? ''
  const theoSection = brief.sections.find(s => s.agent === 'theo')?.content ?? ''

  const prompt = `Tu es un directeur audio pour une vidéo courte. À partir du brief des agents et de la structure des scènes, génère un tableau JSON de SceneAudioPackage pour chaque scène.

## Brief audio
### Dialoguiste (Sami)
${samiSection}

### Sound Designer (Jade)
${jadeSection}

### Superviseur Musique (Remi)
${remiSection}

### Éditeur Rythme (Theo)
${theoSection}

## Scènes
${JSON.stringify(structure.scenes, null, 2)}

## Format attendu
Retourne UNIQUEMENT un tableau JSON valide. Chaque élément respecte ce schéma :
- version: "1.0"
- runId: "${ctx.runId}"
- sceneIndex, title, narration (lines + silences + stageDirections)
- intention (emotion, narrativeRole, tensionLevel 0-100, videoPromptHint)
- ambiance (description, intensity, stereoWidth)
- fx (tableau, peut être vide)
- music (mood, tempo, intensity, instrumentation, placement, volumeRelativeToDialogue)
- timing (targetDurationS, minDurationS, maxDurationS, transitionIn, transitionOut)
- dependencies (continuesAmbianceFrom, continuesMusicFrom, requiredBeforeScene, sharedSpeakers)

Assure une cohérence inter-scènes : ambiances qui se prolongent, tension musicale progressive, speakers partagés.`

  const llmConfig = await getStepLlmConfig(ctx.runId, 6)
  const target = resolveLlmTarget(llmConfig)

  const result = await executeWithFailover<LLMProvider>('llm', async (provider) => {
    return provider.chat(
      [{ role: 'user', content: prompt }],
      { model: target.model, temperature: 0.3, maxTokens: 8000, host: target.host, headers: target.headers },
    )
  })

  // Parser le JSON depuis la réponse LLM
  const jsonMatch = result.content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('LLM n\'a pas retourné un tableau JSON valide')

  const rawPackages: unknown[] = JSON.parse(jsonMatch[0])
  const packages: SceneAudioPackage[] = []

  for (const raw of rawPackages) {
    const parsed = parseSceneAudioPackage(raw)
    if (parsed.success) {
      packages.push(parsed.data)
    } else {
      logger.warn({ event: 'scene_audio_parse_failed', errors: parsed.errors })
    }
  }

  return packages
}

export const step4cAudio: PipelineStep = {
  name: 'Audio Package',
  stepNumber: 6,

  async execute(ctx: StepContext): Promise<StepResult> {
    const audioDir = join(ctx.storagePath, 'audio')
    await mkdir(audioDir, { recursive: true })

    // 1. Lire le brief et la structure
    let brief: MeetingBrief
    let structure: { scenes: { index: number; description: string; dialogue: string; duration_s: number }[] }
    try {
      brief = JSON.parse(await readFile(join(ctx.storagePath, 'brief.json'), 'utf-8'))
      structure = JSON.parse(await readFile(join(ctx.storagePath, 'structure.json'), 'utf-8'))
    } catch (e) {
      return { success: false, costEur: 0, outputData: null, error: `Fichiers brief/structure manquants: ${(e as Error).message}` }
    }

    // 2. Probe capabilities
    const capabilities = await probeAppleSilicon()
    logger.info({ event: 'audio_capabilities', ...capabilities })

    // 3. Générer les SceneAudioPackage via LLM
    let packages: SceneAudioPackage[]
    let llmCost = 0
    try {
      packages = await generateSceneAudioPackages(brief, structure, ctx)
      // Sauvegarder les packages bruts
      await writeFile(join(audioDir, 'scene-packages.json'), JSON.stringify(packages, null, 2))
    } catch (e) {
      return { success: false, costEur: 0, outputData: null, error: `Génération packages audio échouée: ${(e as Error).message}` }
    }

    if (packages.length === 0) {
      return { success: false, costEur: llmCost, outputData: null, error: 'Aucun package audio valide généré' }
    }

    // 4. TTS render par scène (parallélisme selon capabilities)
    const concurrency = capabilities.recommendedConcurrency
    const ttsResults = []
    for (let i = 0; i < packages.length; i += concurrency) {
      const batch = packages.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map(pkg => renderSceneTTS(pkg, audioDir))
      )
      ttsResults.push(...batchResults)
    }

    // 5. Mix par scène
    const sceneStatuses = []
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i]
      const tts = ttsResults[i]
      const mixPath = join(audioDir, 'scenes', String(pkg.sceneIndex), 'mix.wav')

      await mixScene({
        ttsPath: tts.concatFilePath,
        ambiancePath: null, // LOT futur : résolution sources ambiance
        fxPaths: [],        // LOT futur : résolution sources FX
        musicPath: null,    // LOT futur : résolution sources musique
        outputPath: mixPath,
        volumes: DEFAULT_VOLUMES,
        targetDurationS: pkg.timing.targetDurationS,
      })

      sceneStatuses.push({
        sceneIndex: pkg.sceneIndex,
        startS: 0, // sera recalculé par assembleMaster
        endS: tts.totalDurationS,
        durationS: tts.totalDurationS,
        ttsFilePath: tts.concatFilePath,
        mixFilePath: mixPath,
        status: 'assembled' as const,
        ttsProvider: tts.provider,
        costEur: tts.costEur,
      })
    }

    // 6. Assemblage master
    const manifest = await assembleMaster(sceneStatuses, audioDir, ctx.runId)

    // 7. Persister en DB
    const { randomUUID } = await import('crypto')
    await db.insert(audioAsset).values({
      id: randomUUID(),
      runId: ctx.runId,
      type: 'audio_preview',
      data: manifest,
      filePath: manifest.masterFilePath,
      durationS: manifest.totalDurationS,
      status: 'assembled',
    })

    return {
      success: true,
      costEur: manifest.qualityChecks.totalCostEur + llmCost,
      outputData: {
        masterFilePath: manifest.masterFilePath,
        totalDurationS: manifest.totalDurationS,
        sceneCount: manifest.scenes.length,
        allRendered: manifest.qualityChecks.allScenesRendered,
      },
    }
  },
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/pipeline/steps/step-4c-audio.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/steps/step-4c-audio.ts src/lib/pipeline/steps/step-4c-audio.test.ts
git commit -m "feat(audio): step 4c pipeline — audio package complet (TTS + mix + master)"
```

---

### Task 7: Intégrer step 4c dans engine + constants

**Files:**
- Modify: `src/lib/pipeline/constants.ts`
- Modify: `src/lib/pipeline/engine.ts`

- [ ] **Step 1: Mettre à jour constants.ts**

Remplacer `PIPELINE_STEP_DEFINITIONS` par :

```typescript
export const PIPELINE_STEP_DEFINITIONS = [
  { stepNumber: 1, name: 'Idée' },
  { stepNumber: 2, name: 'Brainstorm' },
  { stepNumber: 3, name: 'JSON structuré' },
  { stepNumber: 4, name: 'Blueprint visuel' },
  { stepNumber: 5, name: 'Storyboard' },
  { stepNumber: 6, name: 'Audio Package' },
  { stepNumber: 7, name: 'Prompts vidéo' },
  { stepNumber: 8, name: 'Génération' },
  { stepNumber: 9, name: 'Preview' },
  { stepNumber: 10, name: 'Publication' },
] as const
```

- [ ] **Step 2: Mettre à jour engine.ts — import + STEPS**

Ajouter l'import :
```typescript
import { step4cAudio } from './steps/step-4c-audio'
```

Insérer dans le tableau STEPS après `step4Storyboard` :
```typescript
const STEPS: PipelineStep[] = [
  step1Idea,
  step2Brainstorm,
  step3Json,
  step4VisualBlueprint,
  step4Storyboard,
  step4cAudio,       // ← NOUVEAU
  step5Prompts,
  step6Generation,
  step7Preview,
  step8Publish,
]
```

- [ ] **Step 3: Vérifier que le pipeline compile**

Run: `cd /Users/malik/Documents/claude-atelier/FILM\ CREW\ 🎬/app && npx tsc --noEmit`
Expected: 0 erreurs

- [ ] **Step 4: Commit**

```bash
git add src/lib/pipeline/constants.ts src/lib/pipeline/engine.ts
git commit -m "feat(audio): intégrer step 4c audio dans le pipeline (10 steps)"
```

---

### Task 8: Step 5 lit les durées audio

**Files:**
- Modify: `src/lib/pipeline/steps/step-5-prompts.ts`

- [ ] **Step 1: Ajouter la lecture du manifest audio dans step-5-prompts.ts**

Au début de la fonction `execute`, après la lecture de `structure.json`, ajouter :

```typescript
// Lire les durées audio si le package audio a été généré
let audioDurations: Map<number, number> | null = null
try {
  const audioManifestRaw = await readFile(join(ctx.storagePath, 'audio', 'audio-master-manifest.json'), 'utf-8')
  const audioManifest = JSON.parse(audioManifestRaw)
  audioDurations = new Map(
    audioManifest.scenes.map((s: { sceneIndex: number; durationS: number }) => [s.sceneIndex, s.durationS])
  )
  logger.info({ event: 'audio_durations_loaded', scenes: audioDurations.size })
} catch {
  logger.info({ event: 'audio_durations_unavailable', message: 'Fallback sur durées estimées' })
}
```

Puis, lors de la construction des prompts par scène, remplacer `duration_s` par la durée audio si disponible :

```typescript
const sceneDuration = audioDurations?.get(scene.index) ?? scene.duration_s
```

- [ ] **Step 2: Vérifier que le pipeline compile**

Run: `npx tsc --noEmit`
Expected: 0 erreurs

- [ ] **Step 3: Commit**

```bash
git add src/lib/pipeline/steps/step-5-prompts.ts
git commit -m "feat(audio): step 5 utilise les durées audio exactes du manifest"
```

---

## Storage structure finale

```
storage/runs/{runId}/
├── brief.json                          # Step 2
├── structure.json                      # Step 3
├── director-plan.json                  # Step 3
├── storyboard-blueprint.json           # Step 4a
├── storyboard/                         # Step 4b
├── audio/                              # Step 4c ← NOUVEAU
│   ├── scene-packages.json             #   Canon LLM brut
│   ├── audio-master-manifest.json      #   Manifest final
│   ├── master.wav                      #   Audio maître assemblé
│   └── scenes/
│       ├── 0/
│       │   ├── tts-kokoro-*.wav        #   WAV par ligne
│       │   ├── silence-after-*.wav     #   Silences
│       │   ├── tts.wav                 #   Concat dialogues
│       │   └── mix.wav                 #   Mix final scène
│       ├── 1/ ...
│       └── N/ ...
├── prompts.json                        # Step 5 (durées calées sur audio)
├── videos/                             # Step 6
├── final/                              # Step 7
└── preview-manifest.json               # Step 7
```

---

## Résumé des risques et mitigations

| Risque | Mitigation |
|--------|-----------|
| Kokoro down | Failover vers `system-tts` (macOS `say`) |
| LLM génère un canon invalide | Validation Zod + log des erreurs, skip scènes invalides |
| FFmpeg amix échoue | Fallback : dialogue seul sans mix |
| Durée audio diverge fortement de la cible | Log warning, step 5 utilise durée réelle |
| RAM insuffisante pour TTS parallèle | Concurrency adaptative via `probeAppleSilicon()` |
| Step 4c échoue complètement | Pipeline continue — step 5 fallback sur durées estimées |
