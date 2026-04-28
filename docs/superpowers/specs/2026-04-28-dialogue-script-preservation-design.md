# Spec — Préservation dramatique brief → dialogue_script (Bloc P1-P4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date :** 2026-04-28
**Scope :** Bloc P1-P4 (colonne vertébrale du nouveau pipeline audio narratif)
**Statut :** spec à valider avant `writing-plans`

---

## 1. Objectifs

1. **Préserver l'intention dramatique** écrite par l'agent Sami jusque dans `dialogue_script.json`, sans réécriture par un appel LLM final.
2. **Imposer un roster de personnages** figé dès l'ouverture de la réunion, propagé dans tous les prompts.
3. **Forcer Sami à produire du JSON structuré** (lignes, speakers, intent, subtext, beats) au lieu d'un texte libre qui se fait ensuite extraire à la regex.
4. **Enrichir `MeetingSceneOutlineItem`** avec un schéma dramatique (beat, charactersPresent, dialogueLines[]) à la place d'un `dialogue: string` plat.
5. **Bannir le mode « narrateur mystérieux » par défaut.** Le rôle `narrator` n'apparaît que si le run est explicitement en `narrationMode: 'voiceover'`.
6. **Rendre le pipeline déterministe scène-à-scène** : continuité entre scènes traçable et validée.

## 2. Non-objectifs

- Ne couvre pas la phase 5 (transcript fenêtre glissante, validation Zod globale, suppression `slice(0, 700)`) → spec séparé P5.
- Ne couvre pas la phase 6 (durées libres par scène, tuning temperature/maxTokens) → spec séparé P6.
- Ne change pas les agents Jade/Rémi/Théo (sound design, musique, rythme) — ils continuent à écrire leur section en prose libre. Seul Sami passe au format JSON.
- Ne touche pas au step 4 (visual blueprint), au step 4c (audio render) ni au step 5 (prompts vidéo). Ces consommateurs lisent toujours `dialogue_script.json` mais avec un schéma enrichi rétro-compatible.
- N'introduit pas de nouvel appel LLM dans la phase finale (le but est au contraire d'en supprimer un).
- Pas de UI nouvelle. Les artefacts produits sont visibles via les routes `deliverables` existantes.

## 3. Schémas et types

### 3.1 Nouveaux types — `app/src/types/agent.ts`

```ts
export type NarrationMode = 'dialogue' | 'voiceover'
// 'dialogue' (défaut) : pas de narrator, uniquement personnages
// 'voiceover'         : narrator autorisé en plus des personnages

export type CharacterVoiceProfile = {
  register: 'grave' | 'medium' | 'aigu'
  tempo: 'lent' | 'normal' | 'rapide'
  accent?: string
  signatureWords?: string[]   // 1-3 mots-tics récurrents
}

export type Character = {
  id: string                  // slug stable : "alex", "noor", "narrator"
  name: string
  archetype: string           // "antagoniste pragmatique", "mentor désabusé"
  voiceProfile: CharacterVoiceProfile
  arcGoal: string             // ce qu'il veut sur la durée totale
  arcStakes: string           // ce qu'il perd s'il échoue
  isNarrator?: boolean        // true uniquement si narrationMode='voiceover'
}

export type CharacterRoster = {
  runId: string
  narrationMode: NarrationMode
  characters: Character[]     // 2-4 entries (pas de narrator par défaut)
  premise: string             // 1-2 phrases du conflit central
  createdAt: string
}

export type SceneBeatType =
  | 'setup' | 'inciting' | 'rising' | 'turn' | 'climax' | 'resolution'

export type SceneBeat = {
  beatId: string              // "B1-confrontation"
  type: SceneBeatType
  emotionStart: string        // "calme méfiant"
  emotionEnd: string          // "rage froide"
  tensionLevel: number        // 0-100 (niveau atteint en fin de scène)
  conflict: string            // "Alex veut la vérité, Noor protège son frère"
  stakes: string              // "Si Alex apprend, Noor perd sa famille"
}
```

### 3.2 Type augmenté — `MeetingSceneOutlineItem`

```ts
// AVANT
export type MeetingSceneOutlineItem = {
  index: number
  title: string
  description: string
  dialogue: string             // ← string plate (supprimée)
  camera: string
  lighting: string
  duration_s: number
  foreground?: string
  midground?: string
  background?: string
  emotion?: string
  narrativeRole?: string
}

// APRÈS
export type MeetingSceneOutlineItem = {
  index: number
  title: string
  description: string
  // dialogue: string  ← REMPLACÉ
  dialogueLines: BriefDialogueLine[]   // structure ci-dessous
  beat: SceneBeat                       // obligatoire
  charactersPresent: string[]           // refs Character.id
  continuityFromPreviousScene: string   // 1 phrase, vide pour scène 1
  camera: string
  lighting: string
  duration_s: number
  foreground?: string
  midground?: string
  background?: string
}
```

### 3.3 Nouveau type — `BriefDialogueLine`

C'est le format produit par Sami et préservé 1:1 jusqu'à `dialogue_script.json`.

```ts
export type BriefDialogueLine = {
  characterId: string         // ref Character.id (jamais "narrateur" sans narrationMode)
  text: string                // texte exact de la réplique
  intent: string              // "accuser", "esquiver", "menacer", "céder"
  subtext?: string            // ce qu'il ne dit pas
  reactsToLineIndex?: number  // continuité dramatique intra-scène
  // tone/pace/emphasis ajoutés en aval par buildDialogueScript (étape d'enrichissement)
}
```

### 3.4 Type augmenté — `DialogueLine` (audio.ts)

```ts
// AVANT
export type DialogueLine = {
  lineIndex: number
  speaker: string                       // ← string libre, devient strict
  text: string
  tone: string
  pace: 'slow'|'normal'|'fast'
  emphasis: string[]
  estimatedDurationS: number
}

// APRÈS
export type DialogueLine = {
  lineIndex: number
  characterId: string                   // ← strict, ref roster
  text: string                          // copié verbatim depuis BriefDialogueLine
  intent: string                        // ← propagé
  subtext?: string                      // ← propagé
  reactsToLineIndex?: number            // ← propagé
  tone: Tone                            // ajouté par buildDialogueScript ; alias de l'enum actuel : 'neutre'|'urgent'|'intime'|'ironique'|'grave'|'enthousiaste'|'mystérieux'
  pace: 'slow'|'normal'|'fast'
  emphasis: string[]
  estimatedDurationS: number
}
```

### 3.5 Type augmenté — `DialogueScene`

```ts
export type DialogueScene = {
  sceneIndex: number
  title: string
  durationTargetS: number
  beat: SceneBeat                       // ← obligatoire
  charactersPresent: string[]           // ← obligatoire
  openingHook: string                   // 1ʳᵉ phrase qui re-cale le contexte
  closingHook: string                   // ce qui pousse vers la scène suivante
  lines: DialogueLine[]                 // min 1 si charactersPresent non vide
  silences: SilenceMarker[]
  stageDirections: string
  continuityFromPreviousScene: string   // ← obligatoire (vide pour scène 1)
}
```

### 3.6 Type augmenté — `DialogueScript`

```ts
export type DialogueScript = {
  runId: string
  language: string
  narrationMode: NarrationMode          // ← propagé depuis CharacterRoster
  totalDurationTargetS: number
  premise: string                       // ← propagé
  characters: Character[]               // ← roster figé
  scenes: DialogueScene[]
}
```

### 3.7 Schémas Zod

Créer `app/src/lib/schemas/audio.ts` avec :
- `characterSchema`, `characterRosterSchema`
- `sceneBeatSchema`, `briefDialogueLineSchema`
- `meetingSceneOutlineItemSchema` (avec `dialogueLines: z.array(briefDialogueLineSchema).min(1)` quand `charactersPresent.length > 0`)
- `dialogueLineSchema`, `dialogueSceneSchema`, `dialogueScriptSchema`

Toutes les écritures fichier (`brief.json`, `structure.json`, `dialogue_script.json`, `characters.json`) doivent passer par `schema.parse()` strict — pas de `safeParse` silencieux.

## 4. Flux de données

### 4.1 Vue d'ensemble

```
idée brute + narrationMode
  └─► [Phase 0 — Mia roster]           NEW (LLM #1)
        sortie : characters.json
                 = CharacterRoster
                 = roster figé pour le run
  └─► [Phase 1-6 — Réunion 10 agents]  inchangée sur les agents non-Sami
        roster injecté dans tous les prompts (contextual prelude)
  └─► [Phase 7 — Sections brief]
        Sami → JSON forcé (LLM #2 dédié)
        sortie : brief_dialogue.json   NEW
                 = { sceneIndex → BriefDialogueLine[] }
        autres agents (lenny/laura/nael/emilie/nico/jade/remi/theo) → prose libre (inchangé)
        sortie : sections[] dans brief.json
  └─► [Phase 8 — Mia conclusion]       inchangée
  └─► [Phase 9 — buildSceneOutline]    LLM enrichi
        input : sections + transcript + brief_dialogue.json
        sortie : sceneOutline[] enrichi
                 (dialogueLines, beat, charactersPresent, continuity)
        règle : dialogueLines[] copiées DEPUIS brief_dialogue.json
                (le LLM ne peut que confirmer / réordonner par scène)
  └─► brief.json
        + characters: CharacterRoster
        + sections: ... (Sami section reste un texte court de synthèse)
        + sceneOutline: MeetingSceneOutlineItem[] (enrichi)
  └─► [step-3 LLM #1 → structure.json] inchangé fonctionnellement
        consomme sceneOutline pour aligner
  └─► [step-3 préservation 1:1 → dialogue_script.json]   REFACTORÉ
        ⊘ plus de LLM par défaut
        ✓ copie verbatim des dialogueLines depuis sceneOutline
        ✓ enrichissement tone/pace/emphasis :
            - heuristique déterministe (par défaut)
            - OU appel LLM CIBLÉ scène par scène (si configuré)
        ✓ caractérisation cohérente : tone dérivé du voiceProfile
                                        + intent + emotion de beat
```

### 4.2 Détail Phase 0 — Mia roster

**`narrationMode` n'est PAS produit par Mia.** Il est **lu depuis le run / projectConfig** comme un paramètre d'entrée, et passé en input au prompt Mia. Mia produit alors un roster *compatible* avec ce mode (zéro narrator si `dialogue`, narrator optionnel si `voiceover`).

Source de vérité pour `narrationMode` :
- nouveau champ `OutputConfig.narrationMode: NarrationMode` (ou `RunConfig.narrationMode`, à choisir au moment du plan selon là où s'attache le mieux le concept de cadrage du run)
- valeur par défaut : `'dialogue'`
- exposé dans la création du run (`POST /api/runs`) et dans `projectConfig`
- propagé dans `MeetingCoordinator` constructor : `narrationMode: NarrationMode`

Nouveau prompt système Mia (en plus de l'ouverture). Avant la Phase 1 actuelle, Mia reçoit `narrationMode` en input et produit :

```json
{
  "premise": "Alex débarque chez Noor sans prévenir. Une lettre vient de tout faire basculer.",
  "characters": [
    {
      "id": "alex",
      "name": "Alex",
      "archetype": "frère revenant en quête de vérité",
      "voiceProfile": { "register": "medium", "tempo": "rapide", "signatureWords": ["regarde-moi"] },
      "arcGoal": "Obtenir la vérité sur la disparition du père",
      "arcStakes": "Sans cette vérité, il continue de mentir à sa propre fille"
    },
    {
      "id": "noor",
      "name": "Noor",
      "archetype": "sœur protectrice et coupable",
      "voiceProfile": { "register": "grave", "tempo": "lent", "signatureWords": ["pas maintenant"] },
      "arcGoal": "Empêcher Alex de découvrir la lettre",
      "arcStakes": "Si Alex apprend, elle perd la garde de leur mère"
    }
  ]
}
```

Contraintes :
- `narrationMode` est figé en input du prompt et **non modifiable** par Mia
- 2-4 personnages (validation Zod : `min(2).max(4)`)
- `narrationMode: 'voiceover'` autorise un personnage avec `isNarrator: true` en plus, et seulement à cette condition
- Si `narrationMode: 'dialogue'`, aucun personnage n'a `isNarrator: true` (validation Zod stricte côté code après le retour LLM, indépendante de ce que Mia tente)
- L'ID doit être un slug `[a-z][a-z0-9_-]{1,30}`

Le roster (avec `narrationMode` ajouté en code après le retour LLM) est écrit dans `app/storage/runs/{runId}/characters.json` puis injecté en `contextualPrelude` dans **toutes** les phases suivantes via une fonction `buildRosterContext(roster)` ajoutée à `coordinator.ts`.

### 4.3 Détail Phase 7 — Sami JSON forcé

Nouveau system prompt pour Sami (override `writeBriefSection` quand `agent === 'sami'`) :

```
Tu es Sami, dialoguiste. Tu écris le script dialogué scène par scène en JSON STRICT.

Contraintes :
- chaque ligne a un characterId qui DOIT exister dans le roster fourni
- chaque ligne a un intent (verbe d'action dramatique)
- subtext optionnel mais encouragé pour les lignes de tension
- alterne les speakers : pas plus de 2 lignes consécutives du même personnage
- minimum 4 lignes par scène avec ≥ 2 personnages présents
- jamais de characterId 'narrator' ou 'narrateur' sauf si narrationMode='voiceover'

Schéma de sortie :
{
  "scenes": [
    {
      "sceneIndex": 1,
      "lines": [
        { "characterId": "alex", "text": "...", "intent": "...", "subtext": "...", "reactsToLineIndex": null }
      ]
    }
  ]
}

Retourne UNIQUEMENT du JSON valide.
```

Le résultat parsé est validé Zod, puis écrit dans `brief_dialogue.json`. Sami écrit aussi une **section synthèse en prose** (200-400 chars) pour `brief.json.sections[]`, mais c'est purement descriptif — la source canonique des dialogues est `brief_dialogue.json`.

### 4.4 Détail Phase 9 — buildSceneOutline

**Principe : aucun LLM ne touche jamais aux `dialogueLines`. Aucune réécriture, aucune recopie. L'attachement est 100 % code.**

Le prompt `buildSceneOutline` est modifié pour produire **uniquement** :
- `beat: SceneBeat` (type, emotionStart, emotionEnd, tensionLevel, conflict, stakes)
- `description`
- `camera`
- `lighting`
- `continuityFromPreviousScene`
- `foreground / midground / background`
- `duration_s` (optionnel — peut être laissé au lock outputConfig)

Le LLM **ne reçoit même pas** les `dialogueLines` complètes en sortie attendue. Il reçoit en *contexte de lecture* le `brief_dialogue.json` (pour comprendre la dramaturgie de chaque scène et choisir le bon `beat`), mais le schéma de sortie qu'on lui impose n'inclut **pas** `dialogueLines`.

Après le retour LLM, **en code** (Node, hors LLM) :
1. Pour chaque scène produite par le LLM, on récupère `briefDialogue.scenes[sceneIndex].lines`
2. On copie verbatim ces `BriefDialogueLine[]` dans `outline.dialogueLines[]`
3. On dérive `charactersPresent = unique(dialogueLines.map(l => l.characterId))`
4. On valide Zod l'`outline` complet

**Garantie 1:1 stricte par construction :** puisque le LLM n'a jamais l'occasion d'écrire un `text`, aucune divergence n'est possible. Plus besoin de validation multiset ni de retry pour cause de paraphrase.

Conséquence pour la section Étape 4 (ordre d'implémentation interne) : la sous-tâche 4.3 « validation post-LLM multiset » est supprimée — remplacée par « attachement code des dialogueLines depuis brief_dialogue.json ».

### 4.5 Détail step-3 — buildDialogueScript refactoré

`buildDialogueScript` actuel ([step-3-json.ts:159-260](app/src/lib/pipeline/steps/step-3-json.ts#L159-L260)) est remplacé par `buildDialogueScriptFromOutline` :

```ts
async function buildDialogueScriptFromOutline(
  ctx: StepContext,
  brief: MeetingBrief,
  roster: CharacterRoster,
): Promise<{ script: DialogueScript; costEur: number }> {
  // 1. Pas de LLM. Copie verbatim depuis brief.sceneOutline.
  // 2. Pour chaque scène, pour chaque BriefDialogueLine :
  //    - recopier text, characterId, intent, subtext, reactsToLineIndex
  //    - dériver tone : voir 4.5.1 (basé sur beat + intent + subtext)
  //    - dériver pace : voir 4.5.2 (basé sur intent + voiceProfile.tempo en défaut)
  //    - dériver emphasis : signatureWords ∩ text, sinon top 1-2 mots > 4 chars
  //    - estimatedDurationS : compteWords(text) / 3
  // 3. silences : si reactsToLineIndex présent, silence 0.5s avant cette ligne
  // 4. closingHook : dernière ligne narrative de la scène
  // 5. openingHook : première ligne ou continuityFromPreviousScene
}
```

Pas d'appel LLM par défaut. **Coût supplémentaire = 0 €** sur cette étape.

Option de configuration future (NON dans P1-P4) : si `projectConfig.dialogueScriptEnrichment.useLlm === true`, ajouter un appel LLM par scène pour raffiner tone/pace/emphasis. Hors scope ici.

#### 4.5.1 Dérivation `tone` — primaire = beat + intent + subtext

Le `tone` d'une ligne est **principalement** le résultat de :
- `beat.emotionEnd` (la couleur émotionnelle dominante de la scène à cet endroit)
- `intent` (l'action dramatique de la ligne : « accuser », « esquiver », « menacer », « céder », « rassurer »…)
- présence/absence de `subtext` (s'il y a un subtext, le tone est rarement « neutre »)

Mapping heuristique implémenté dans `dialogue-derivation.ts` (table d'arbres de décision, pas un LLM) :

| intent (ou famille) | emotionEnd contient | tone dérivé |
|---|---|---|
| accuser / confronter / dénoncer | colère, rage, déception | `urgent` |
| menacer / intimider | peur, tension, danger | `grave` |
| esquiver / mentir / minimiser | doute, malaise, méfiance | `mystérieux` |
| céder / avouer / pardonner | apaisement, vulnérabilité | `intime` |
| ironiser / moquer | tension, malaise | `ironique` |
| rassurer / consoler | calme, tendresse | `intime` |
| annoncer / révéler | choc, surprise | `urgent` |
| raconter / décrire (factuel, sans subtext) | n'importe | `neutre` |
| (aucune correspondance) | n'importe | fallback `neutre` |

`voiceProfile` n'**impose pas** le tone. Il sert à :
- la couleur vocale globale du personnage (casting TTS)
- le `pace` par défaut (`voiceProfile.tempo` → `pace`)
- le mapping voix → fichier TTS dans le step audio
- les `signatureWords` pour le ranking de l'`emphasis`

Si on a un personnage avec `voiceProfile.register: 'grave'`, ses lignes ne sont pas toutes en tone `grave`. Une ligne d'aveu intime de ce personnage reste `intime`. Le register colore la voix, pas l'intention dramatique.

#### 4.5.2 Dérivation `pace` — primaire = intent, secondaire = voiceProfile.tempo

| intent (famille) | pace dérivé |
|---|---|
| menacer, accuser, presser, urgent | `fast` |
| céder, avouer, intimer une pause | `slow` |
| (autre) | fallback `voiceProfile.tempo` ou `normal` |

Donc une réplique brève d'un personnage qui parle d'habitude lentement peut être `fast` si l'intent l'exige.

#### 4.5.3 Dérivation `emphasis`

1. Intersection `voiceProfile.signatureWords ∩ text.split` (limité à 1-2 mots)
2. Si vide : top 1-2 mots du `text` filtré (longueur > 4, hors stop-words FR)
3. Si vide : `[]`

### 4.6 Suppression du fallback "narrateur mystérieux"

Suppression complète de `buildFallbackDialogueLines` ([scene-dialogue.ts:73-87](app/src/lib/meeting/scene-dialogue.ts#L73-L87)).

Si à un moment du pipeline, une scène se retrouve avec `dialogueLines: []` ET `charactersPresent` non vide → throw avec un message explicite. Aucune génération automatique de "narrateur mystérieux".

Cas particuliers tolérés :
- `charactersPresent: []` ET `narrationMode: 'voiceover'` ET narrator présent dans roster → narrator parle seul, OK
- `charactersPresent: []` ET `narrationMode: 'dialogue'` → erreur explicite "scène sans personnage en mode dialogue"
- scène muette intentionnelle → autorisée seulement si `dialogueLines: []` ET `beat.type === 'setup'` ET `durationTargetS <= 3`

### 4.7 Helpers obsolètes à supprimer

- `extractBriefSceneDialogues` ([scene-dialogue.ts:27-49](app/src/lib/meeting/scene-dialogue.ts#L27-L49)) — extraction regex qui aplatissait les répliques
- `splitBriefIntoSceneBlocks` ([scene-dialogue.ts:18-25](app/src/lib/meeting/scene-dialogue.ts#L18-L25)) — parsing fragile
- `extractQuotedDialogue` ([scene-dialogue.ts:12-16](app/src/lib/meeting/scene-dialogue.ts#L12-L16)) — `.join(' ')` lossy
- `backfillSceneOutlineDialogue` ([scene-dialogue.ts:51-66](app/src/lib/meeting/scene-dialogue.ts#L51-L66)) — backfill depuis string
- `normalizeDialogueScenesWithFallback` ([scene-dialogue.ts:89-133](app/src/lib/meeting/scene-dialogue.ts#L89-L133)) — fallback hardcodé
- `buildFallbackDialogueLines` ([scene-dialogue.ts:73-87](app/src/lib/meeting/scene-dialogue.ts#L73-L87)) — narrateur mystérieux

Remplacés par : `lib/meeting/dialogue-extractor.ts` (nouveau, parsing du JSON Sami uniquement) et `lib/pipeline/dialogue-derivation.ts` (nouveau, dérivation tone/pace/emphasis depuis beat+voiceProfile).

## 5. Points de migration

### 5.1 Stockage runs existants

Les runs antérieurs ont :
- `brief.json` sans `characters` ni roster
- `brief.json.sceneOutline[].dialogue: string` (au lieu de `dialogueLines[]`)
- pas de `brief_dialogue.json`
- pas de `characters.json`
- `dialogue_script.json` (quand présent) avec `speaker: string` au lieu de `characterId`

**Décision : pas de migration automatique.** Les runs existants restent dans l'ancien format. Pour les ré-exécuter, il faut un reset (étapes 2 et 3) — déjà supporté par `lib/pipeline/reset.ts` ([reset.ts:7-8](app/src/lib/pipeline/reset.ts#L7-L8)).

À ajouter dans `reset.ts` : `2: ['brief.json', 'characters.json', 'brief_dialogue.json']` et `3: [...existant]`.

### 5.2 Lecteurs en aval

Repérer les lecteurs de `dialogue_script.json` et adapter :

| Lecteur | Adaptation |
|---|---|
| [tts-renderer.ts:47](app/src/lib/pipeline/tts-renderer.ts#L47) | Lit `lines[].text` → inchangé. Lit `lines[].speaker` → remplacer par `lines[].characterId` |
| [step-4c-audio.ts:81](app/src/lib/pipeline/steps/step-4c-audio.ts#L81) | Idem |
| [subtitle-generator.ts:42-44](app/src/lib/pipeline/subtitle-generator.ts#L42-L44) | Lit `lines[].text` → inchangé |
| Tests `__tests__/tts-renderer.test.ts`, `subtitle-generator.test.ts`, `step-4c-audio.test.ts`, `e2e-pipeline-audio.test.ts` | Mettre à jour les fixtures (speaker → characterId) |

### 5.3 Compatibilité runtime

Pour préserver les runs en cours pendant le déploiement :
- Si `brief.json` lu n'a pas de `characters` → step 3 throw "ce run a été créé avec l'ancien pipeline, reset l'étape 2"
- Pas de tentative de retro-fitting silencieux

## 6. Règles de validation

### R1 — Roster figé
- `characters.json` produit en Phase 0, ne change plus du run
- Toutes les phases ultérieures lisent ce fichier en début de prompt
- Aucune phase ne peut introduire un `characterId` absent du roster (validation Zod)

### R2 — Sami en JSON
- La section Sami du brief.json est descriptive (200-400 chars de synthèse)
- La source canonique est `brief_dialogue.json`, validé Zod strict
- Si Sami échoue à produire du JSON valide après 2 retries → step 2 échoue (pas de fallback prose)

### R3 — Préservation 1:1 (no-rewrite)
- `buildDialogueScriptFromOutline` ne fait aucun appel LLM par défaut
- Le `text` de chaque `DialogueLine` est strictement égal au `text` du `BriefDialogueLine` source
- Test unitaire : pour 100 lignes synthétiques, `dialogueScript.scenes[i].lines.map(l => l.text)` doit égaler `briefDialogue.scenes[i].lines.map(l => l.text)`

### R4 — Beat obligatoire
- Chaque `MeetingSceneOutlineItem` a un `beat` complet (Zod throw si manquant)
- Chaque `DialogueScene` a un `beat` complet
- **Pas de contrainte sur la monotonie de `tensionLevel` dans P1-P4.** La validation « `tensionLevel` non-décroissant sauf sur resolution/setup » est repoussée à P6 (avec le tuning rythmique). Dans P1-P4, on accepte n'importe quelle séquence de tensions.

### R5 — Pas de narrator par défaut (NOUVELLE — demande utilisateur)
- `narrationMode: 'dialogue'` (défaut) → aucun `Character` n'a `isNarrator: true`
- `narrationMode: 'voiceover'` → exactement zéro ou un `Character` avec `isNarrator: true`
- Aucun `characterId === 'narrator'` ni `'narrateur'` n'est autorisé sans un `Character` correspondant dans le roster
- Validation Zod sur le roster + sur chaque ligne

### R6 — Continuité scène-à-scène
- `continuityFromPreviousScene` non vide pour `sceneIndex > 1` (Zod throw si vide)
- **Pas de hard validation sur le partage de personnages** entre scènes consécutives. La règle « ≥ 1 characterId partagé entre scènes consécutives » est supprimée du bloc P1-P4. Si un saut de personnages est dramaturgiquement souhaité, il passe sans erreur.
- En option, un `logger.info` peut tracer les ruptures de roster scène à scène pour observabilité, sans bloquer.

### R7 — Alternance des voix (soft rule)
- Dans `lines[]` d'une scène avec ≥ 2 personnages présents, **on cherche** à ne pas avoir plus de 2 lignes consécutives du même `characterId`
- Politique : 1 retry du prompt Sami si la règle est violée. **Pas de throw** si le retry produit toujours une violation : on accepte le résultat et on log un warning. Cette règle reste donc soft / best-effort, pas un hard fail.

### R8 — Subtext et intent obligatoires
- `intent` non vide pour 100% des lignes
- `subtext` optionnel mais encouragé (pas de validation dure)

## 7. Impacts sur compatibilité runs existants

| Run | Comportement |
|---|---|
| Run jamais exécuté (idée brute uniquement) | OK, suit le nouveau pipeline |
| Run avec `brief.json` ancien format, étape 2 complétée | Step 3 throw explicite : « reset étape 2 nécessaire — ancien format de brief » |
| Run avec `dialogue_script.json` ancien format, étape 3 complétée, étape 4 ou + en cours | Lectures aval (tts-renderer, step-4c-audio, subtitle) cassent sur `lines[].speaker` → ajouter un adaptateur de lecture transitoire qui mappe `speaker → characterId` à la lecture seulement (read-only shim, retiré quand tous les runs anciens sont purgés) |
| Run en cours d'exécution au moment du déploiement | Comportement indéfini si on déploie au milieu d'un run. Recommandation : déployer hors fenêtre de batch (le run quotidien TikTok est lancé matin, déployer le soir) |

**Décision opérationnelle :** ajouter un read-only shim dans `tts-renderer.ts` et `step-4c-audio.ts` qui accepte les deux formats (`speaker` ou `characterId`) à la lecture, **sans** réécrire. Le shim est marqué `@deprecated` et supprimé en P5.

## 8. Critères d'acceptation

### 8.1 Critères fonctionnels mesurables

Sur un run test avec idée « 3 personnages, confrontation autour d'un secret, 90s, narrationMode='dialogue' » :

- [ ] `characters.json` existe, contient 2-4 personnages, aucun avec `isNarrator: true`
- [ ] `brief_dialogue.json` existe, valide Zod, contient ≥ 4 lignes par scène
- [ ] `brief.json.sceneOutline[i].dialogueLines` non vide pour 100% des scènes
- [ ] Aucune scène avec `dialogueLines.length === 0` en mode dialogue
- [ ] `dialogue_script.json.characters` égale `characters.json.characters` (verbatim)
- [ ] `dialogue_script.json.scenes[i].lines.map(l => l.text)` égale (multiset) `brief_dialogue.json.scenes[i].lines.map(l => l.text)` pour 100% des scènes
- [ ] Aucun `lines[i].characterId === 'narrator'` ni `'narrateur'` dans le `dialogue_script.json` produit
- [ ] Aucun `lines[i].tone === 'mystérieux'` n'apparaît par dérivation par défaut. `tone` est dérivé de `beat.emotionEnd × voiceProfile.register` via la table de mapping documentée dans `dialogue-derivation.ts` ; `mystérieux` n'est dérivé que si `beat.emotionEnd` contient explicitement « mystère » ou « doute »
- [ ] Pour ≥ 60 % des scènes : `lines.filter(l => l.characterId !== 'narrator').length >= 3`
- [ ] Soft check (warning, pas blocking) : alternance des voix respectée dans ≥ 80 % des scènes à ≥ 2 personnages

### 8.2 Critères de coût et performance

- [ ] Coût LLM total du run reste dans la même fourchette qu'avant ±20 % (1 appel ajouté Phase 0, 1 appel ajouté Phase 7-Sami JSON, 1 appel **supprimé** dans buildDialogueScript)
- [ ] Durée totale du run ≤ durée actuelle + 30 s (les appels ajoutés sont compensés par la suppression de l'appel final)

### 8.3 Critères de robustesse

- [ ] Aucun `console.log` ou `logger.warn` silencieux qui masque une violation de schéma
- [ ] Toutes les écritures fichier (`characters.json`, `brief_dialogue.json`, `brief.json`, `structure.json`, `dialogue_script.json`) passent `schema.parse()` strict
- [ ] Test unitaire de préservation 1:1 sur ≥ 100 lignes synthétiques
- [ ] Test e2e qui exécute le pipeline complet sur une idée canonique et vérifie tous les critères 8.1

## 9. Ordre d'implémentation interne

Au sein du bloc P1-P4, séquence recommandée :

### Étape 1 — Schémas et types
- [ ] 1.1 Ajouter les nouveaux types dans `app/src/types/agent.ts` : `NarrationMode`, `Character`, `CharacterRoster`, `CharacterVoiceProfile`, `SceneBeat`, `SceneBeatType`, `BriefDialogueLine`
- [ ] 1.2 Augmenter `MeetingSceneOutlineItem` (remplacer `dialogue: string` par `dialogueLines: BriefDialogueLine[]`, ajouter `beat`, `charactersPresent`, `continuityFromPreviousScene`)
- [ ] 1.3 Augmenter `DialogueLine`, `DialogueScene`, `DialogueScript` dans `app/src/types/audio.ts`
- [ ] 1.4 Créer `app/src/lib/schemas/audio.ts` avec tous les schémas Zod
- [ ] 1.5 Tests unitaires sur les schémas (cas valides + cas invalides ciblés)

### Étape 2 — Phase 0 (roster)
- [ ] 2.1 Ajouter `MeetingCoordinator.runRosterPhase()` qui produit `CharacterRoster`
- [ ] 2.2 Modifier `MEETING_ORDER` ou la séquence dans `runMeeting()` pour insérer la Phase 0 avant Phase 1
- [ ] 2.3 Écrire `characters.json` dans `storagePath`
- [ ] 2.4 Ajouter `buildRosterContext(roster)` et l'injecter en `contextualPrelude` dans toutes les phases existantes
- [ ] 2.5 Test unitaire : roster valide produit, narrationMode respecté
- [ ] 2.6 Mettre à jour `lib/pipeline/reset.ts` (`2: ['brief.json', 'characters.json', 'brief_dialogue.json']`)

### Étape 3 — Sami en JSON
- [ ] 3.1 Créer un nouveau profil Sami avec system prompt JSON-strict
- [ ] 3.2 Modifier `BaseAgent.writeBriefSection` ou créer `BaseAgent.writeStructuredDialogue` pour Sami spécifiquement
- [ ] 3.3 Sami écrit `brief_dialogue.json` (validé Zod) + une section synthèse courte pour `brief.sections[]`
- [ ] 3.4 Retry 2 fois si JSON invalide ou si validation Zod échoue
- [ ] 3.5 Test unitaire avec mock LLM : Sami produit JSON valide, alternance speakers respectée

### Étape 4 — sceneOutline enrichi
- [ ] 4.1 Modifier `buildSceneOutline` pour recevoir `briefDialogue` et `roster` en input
- [ ] 4.2 Modifier le prompt pour produire le nouveau schéma (beat, charactersPresent, dialogueLines copiées, continuity)
- [ ] 4.3 Validation post-LLM : `outline.dialogueLines.text` ⊂ `briefDialogue.lines.text` (multiset). Retry 1 fois si non. Throw si toujours non.
- [ ] 4.4 Supprimer `extractBriefSceneDialogues`, `splitBriefIntoSceneBlocks`, `extractQuotedDialogue`, `backfillSceneOutlineDialogue` de `scene-dialogue.ts`
- [ ] 4.5 Tests unitaires : sceneOutline avec dialogueLines préservées, beat valide, narrative continuity validée

### Étape 5 — Préservation 1:1 dans step-3
- [ ] 5.1 Créer `app/src/lib/pipeline/dialogue-derivation.ts` avec `deriveToneFromBeat`, `derivePaceFromVoiceProfile`, `deriveEmphasis`, `estimateDuration`
- [ ] 5.2 Créer `buildDialogueScriptFromOutline` (zéro LLM) dans `step-3-json.ts` ou `lib/pipeline/dialogue-script-builder.ts`
- [ ] 5.3 Remplacer `buildDialogueScript` (LLM) par `buildDialogueScriptFromOutline` dans `step-3-json.ts:441`
- [ ] 5.4 Supprimer `buildFallbackDialogueLines` et `normalizeDialogueScenesWithFallback`
- [ ] 5.5 Adapter le shim de lecture `speaker → characterId` dans `tts-renderer.ts` et `step-4c-audio.ts` (avec marqueur `@deprecated`)
- [ ] 5.6 Mettre à jour les fixtures de test
- [ ] 5.7 Test e2e sur un fixture brief_dialogue → sceneOutline → dialogue_script avec assertion de préservation 1:1

### Étape 6 — Validation et critères d'acceptation
- [ ] 6.1 Exécuter le run test « 3 personnages confrontation 90s » et vérifier les 11 critères 8.1
- [ ] 6.2 Mesurer coût et durée pour valider 8.2
- [ ] 6.3 Lancer la suite Vitest complète, corriger les régressions
- [ ] 6.4 Lancer un run TikTok réel en mode shadow (ne pas publier) pour valider la qualité subjective

## 10. Fichiers principaux à modifier

| Fichier | Type de changement |
|---|---|
| `app/src/types/agent.ts` | + types Character, CharacterRoster, SceneBeat, BriefDialogueLine, NarrationMode ; modif `MeetingSceneOutlineItem` |
| `app/src/types/audio.ts` | modif `DialogueLine`, `DialogueScene`, `DialogueScript` |
| `app/src/lib/schemas/audio.ts` | NOUVEAU — schémas Zod stricts |
| `app/src/lib/agents/profiles.ts` | modif Mia (Phase 0), modif Sami (JSON-strict) |
| `app/src/lib/agents/coordinator.ts` | + Phase 0, + buildRosterContext, modif buildSceneOutline (signature + prompt + validation 1:1) |
| `app/src/lib/agents/base-agent.ts` | + writeStructuredDialogue (ou variante writeBriefSection avec mode JSON) |
| `app/src/lib/meeting/scene-dialogue.ts` | suppression de 5 helpers obsolètes ; ne garde rien ou juste `estimateDuration` si déplacé |
| `app/src/lib/meeting/dialogue-extractor.ts` | NOUVEAU — parsing du JSON Sami → BriefDialogueLine[] |
| `app/src/lib/pipeline/dialogue-derivation.ts` | NOUVEAU — heuristiques tone/pace/emphasis |
| `app/src/lib/pipeline/dialogue-script-builder.ts` | NOUVEAU — buildDialogueScriptFromOutline (zéro LLM) |
| `app/src/lib/pipeline/steps/step-3-json.ts` | refacto buildDialogueScript → appelle dialogue-script-builder ; suppression normalize/fallback |
| `app/src/lib/pipeline/reset.ts` | + characters.json + brief_dialogue.json à l'étape 2 |
| `app/src/lib/pipeline/tts-renderer.ts` | shim speaker → characterId @deprecated |
| `app/src/lib/pipeline/steps/step-4c-audio.ts` | shim speaker → characterId @deprecated |
| `app/src/lib/api/bot-run-control.ts` (et test) | adapter buildMeetingVerdict si nécessaire |
| Tests `__tests__/*` | fixtures speaker → characterId |

## 11. Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Sami refuse systématiquement de produire du JSON valide (modèle local trop faible) | Pipeline bloqué | Retry 2× ; en dernier recours, fallback vers un sous-modèle plus capable défini dans `projectConfig.fallbackLlm`. Ne pas tomber dans la prose libre. |
| Le LLM en buildSceneOutline reformule subtilement les `text` de Sami (ponctuation, casse) | Validation 1:1 multiset échoue trop souvent | Normalisation tolérante côté validation (trim, NFD Unicode, casse-insensitive) MAIS pas de re-paraphrase. Si après normalisation toujours différent → throw. |
| Coût LLM augmente (Phase 0 + Sami JSON dédié) | Budget mensuel dépassé | Phase 0 = prompt court (~500 tokens), Sami JSON = ~2000 tokens. Compensé par suppression de buildDialogueScript LLM (~3000 tokens). Net attendu : neutre à -10 %. |
| Runs existants en cours cassent au déploiement | Run quotidien TikTok perdu | Déployer hors fenêtre du run quotidien. Le run quotidien est matin → déployer le soir. |
| Régression sur tts-renderer / subtitle-generator | Step 4c échoue silencieusement | Tests e2e existants couvrent les cas, à mettre à jour avec les nouvelles fixtures avant merge. Le shim transitoire absorbe les runs anciens en lecture. |

## 12. Glossaire

- **Roster** : liste figée des personnages d'un run (2-4 personnages, narrator optionnel selon narrationMode)
- **Beat** : unité dramatique d'une scène avec type, émotion, niveau de tension, conflit, enjeu
- **Préservation 1:1** : le texte d'une réplique écrite par Sami est copié verbatim jusque dans `dialogue_script.json`, sans réécriture LLM
- **Narrator** : voix-off non incarnée. N'existe que si `narrationMode: 'voiceover'` est explicitement activé
- **Continuity** : lien narratif entre scènes consécutives (un personnage commun, une émotion qui prolonge, une cause qui devient effet)
