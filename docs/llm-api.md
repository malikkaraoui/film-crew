# FILM CREW — LLM API Reference

> API surface conçue pour être pilotée directement depuis une session Claude, Copilot ou tout autre agent LLM.  
> Base URL : `http://localhost:3000` (dev) ou l'URL de déploiement Vercel.  
> Authentification : aucune (API locale/interne — ne pas exposer publiquement sans ajouter un middleware d'auth).

---

## Vue d'ensemble

FILM CREW expose une surface `/api/bot/*` pensée exclusivement pour les LLM. Ces endpoints parlent un langage machine-first :

- Snapshots complets en une requête (observation → décision → action)
- `nextAction` embarqué dans chaque réponse (le LLM n'a jamais à inférer quoi faire ensuite)
- `controlUrl` dans chaque run (l'URL d'action est toujours dans la réponse)
- Erreurs structurées avec `code` machine-lisible

### Loop de base pour un LLM

```
1. GET /api/bot/status            → suis-je orienté ? y a-t-il un run actif ?
2. POST /api/bot/bootstrap        → créer chaîne + run si nécessaire
3. GET /api/bot/runs/{id}/control → observer l'état complet du run
4. POST /api/bot/runs/{id}/control { action } → agir
5. Répéter 3–4 jusqu'à status = completed
```

---

## Endpoints bot

### `GET /api/bot/status`

**Orientation en une requête.** Retourne ce qui tourne et ce qui attend, sans appeler les providers.

```http
GET /api/bot/status
```

**Réponse 200**

```json
{
  "data": {
    "activeRun": {
      "id": "uuid",
      "idea": "Tutoriel Python pour débutants",
      "status": "running",
      "currentStep": 3,
      "progressPct": 22,
      "nextAction": {
        "kind": "wait",
        "label": "Attendre la fin du step courant",
        "reason": "Étape 3 tourne en ce moment.",
        "stepNumber": 3
      },
      "controlUrl": "/api/bot/runs/{id}/control"
    },
    "queue": {
      "running": 1,
      "pending": 2,
      "pendingIds": ["uuid-a", "uuid-b"]
    },
    "timestamp": "2026-04-28T09:00:00.000Z"
  }
}
```

`activeRun` est `null` si aucun run ne tourne.

---

### `GET /api/bot/runs`

**Liste LLM-friendly des runs** avec `nextAction` et `progressPct` embarqués.

```http
GET /api/bot/runs?limit=20&status=all
```

| Query param | Valeurs | Défaut |
|-------------|---------|--------|
| `limit`     | 1–100   | 20     |
| `status`    | `all` \| `running` \| `pending` \| `paused` \| `completed` \| `failed` \| `killed` | `all` |

**Réponse 200**

```json
{
  "data": {
    "runs": [
      {
        "id": "uuid",
        "idea": "Tutoriel Python pour débutants",
        "status": "pending",
        "currentStep": 1,
        "progressPct": 0,
        "nextAction": {
          "kind": "launch_current_step",
          "label": "Lancer Brainstorm",
          "reason": "Le run est prêt : aucune validation requise avant le lancement.",
          "stepNumber": 1
        },
        "costEur": 0,
        "createdAt": "2026-04-28T09:00:00.000Z",
        "updatedAt": "2026-04-28T09:00:00.000Z",
        "controlUrl": "/api/bot/runs/{id}/control"
      }
    ],
    "total": 42,
    "returned": 20
  }
}
```

---

### `POST /api/bot/bootstrap`

**Créer une chaîne + un run en une seule requête.** Point d'entrée principal pour démarrer une production.

```http
POST /api/bot/bootstrap
Content-Type: application/json
```

**Corps minimal**

```json
{
  "chainName": "Ma Chaîne Tech",
  "idea": "Les 5 erreurs Python que tout débutant fait"
}
```

**Corps complet**

```json
{
  "chainId": "uuid-existant",
  "chainName": "Ma Chaîne Tech",
  "langSource": "fr",
  "audience": "développeurs débutants",

  "idea": "Les 5 erreurs Python que tout débutant fait",
  "type": "tutoriel",
  "styleTemplate": "dynamic",

  "meetingLlmMode": "local",
  "meetingLlmModel": "qwen3",

  "autoStart": false,

  "outputConfig": {
    "videoCount": 1,
    "fullVideoDurationS": 60,
    "sceneDurationS": 10
  },

  "referenceImages": {
    "urls": ["https://example.com/ref.jpg"],
    "paths": ["nom-fichier.jpg"],
    "items": [
      { "base64": "...", "contentType": "image/jpeg", "fileName": "ref.jpg" }
    ]
  },

  "questionnaire": {
    "tone": "éducatif",
    "hook": "chiffre choc"
  }
}
```

**Champs clés**

| Champ | Description |
|-------|-------------|
| `chainId` | UUID d'une chaîne existante (prioritaire sur `chainName`) |
| `chainName` | Nom de chaîne — crée si absent, recherche insensible à la casse sinon |
| `idea` | Idée brute du run — **requis pour créer un run** |
| `autoStart` | Si `true`, lance le pipeline immédiatement (bloque si un run est déjà actif) |
| `meetingLlmMode` | `local` (Ollama) \| `cloud` (Anthropic) \| `openrouter` |
| `meetingLlmModel` | Modèle à utiliser pour l'étape 2 (ex. `claude-sonnet-4-6`, `qwen3`) |
| `referenceImages.paths` | Chemins relatifs depuis le dossier `image-drop/` |

**Réponse 201**

```json
{
  "data": {
    "chain": { "id": "uuid", "name": "Ma Chaîne Tech", ... },
    "chainCreated": true,
    "run": { "id": "uuid", "idea": "...", "status": "pending", "projectConfig": { ... } },
    "normalized": {
      "templateId": "dynamic",
      "questionnaire": { "tone": "éducatif" },
      "localImageDropDir": "/path/to/image-drop"
    },
    "urls": {
      "chain": "http://localhost:3000/chains/{id}",
      "run": "http://localhost:3000/runs/{id}"
    }
  }
}
```

> Si `idea` est absent, retourne seulement la chaîne (200/201) sans créer de run.

---

### `GET /api/bot/runs/{id}/control`

**Snapshot complet pour décision LLM.** À appeler avant chaque action et après chaque `refreshAfterMs`.

```http
GET /api/bot/runs/{id}/control
```

**Réponse 200**

```json
{
  "data": {
    "run": {
      "id": "uuid",
      "idea": "Les 5 erreurs Python",
      "status": "paused",
      "statusLabel": "En attente de validation",
      "currentStep": 2,
      "currentStepLabel": "Réunion des agents",
      "currentStepStatus": "completed",
      "currentStepError": null,
      "costEur": 0.003,
      "createdAt": "2026-04-28T09:00:00.000Z",
      "updatedAt": "2026-04-28T09:05:00.000Z",
      "projectConfig": { "meetingLlmMode": "local", "meetingLlmModel": "qwen3", ... }
    },
    "observation": {
      "progressPct": 22,
      "completedSteps": 2,
      "totalSteps": 9,
      "nextAction": {
        "kind": "approve_and_launch_next_step",
        "label": "Valider puis lancer l'étape suivante",
        "reason": "En attente de validation — le run attend ta décision.",
        "stepNumber": 3
      },
      "liveEvents": [
        {
          "at": "2026-04-28T09:05:00.000Z",
          "level": "info",
          "source": "step",
          "title": "Étape 2 terminée",
          "detail": "Réunion des agents"
        }
      ],
      "refreshAfterMs": 0
    },
    "meeting": {
      "available": true,
      "traceCount": 12,
      "sectionCount": 5,
      "briefSummary": "Vidéo en 5 scènes sur les erreurs Python courantes...",
      "verdict": {
        "status": "pass",
        "summary": "Brief exploitable, sections présentes, suite débloquable.",
        "recommendedAction": "approve_and_continue",
        "checks": []
      },
      "lastTraces": []
    },
    "urls": {
      "run": "/runs/{id}",
      "meeting": "/api/runs/{id}/meeting",
      "progress": "/api/runs/{id}/progress",
      "traces": "/api/runs/{id}/traces",
      "failoverLog": "/api/runs/{id}/failover-log"
    }
  }
}
```

**Champs critiques pour la décision LLM**

| Champ | Usage |
|-------|-------|
| `observation.nextAction.kind` | Dictée l'action à envoyer au POST |
| `observation.refreshAfterMs` | Si > 0, attendre avant de re-GET (run en cours) |
| `meeting.verdict.recommendedAction` | Guide la décision sur l'étape 2 |
| `run.currentStepError` | Non-null = step en erreur, candidat à `launch_current_step` |

---

### `POST /api/bot/runs/{id}/control`

**Déclencher une action sur le run.** Retourne l'action effectuée + snapshot mis à jour.

```http
POST /api/bot/runs/{id}/control
Content-Type: application/json
```

#### Actions disponibles

| `action` | Quand l'utiliser | Prérequis |
|----------|-----------------|-----------|
| `launch_current_step` | `nextAction.kind === "launch_current_step"` | run en `pending` ou `failed` |
| `approve_current_step` | Valider le livrable sans lancer la suite | run en `paused`, step en `completed` |
| `approve_and_launch_next_step` | `nextAction.kind === "approve_and_launch_next_step"` | run en `paused`, step en `completed` |
| `rerun_meeting` | `meeting.verdict.recommendedAction === "rerun_meeting"` | run non en cours d'exécution |
| `kill` | Arrêter un run bloqué ou runaway | run non terminal |

#### Exemple — lancer l'étape courante

```json
{ "action": "launch_current_step" }
```

#### Exemple — lancer avec LLM spécifique

```json
{
  "action": "launch_current_step",
  "llmMode": "cloud",
  "llmModel": "claude-sonnet-4-6"
}
```

#### Exemple — valider et enchaîner

```json
{ "action": "approve_and_launch_next_step" }
```

#### Exemple — relancer la réunion (étape 2)

```json
{
  "action": "rerun_meeting",
  "llmMode": "local",
  "llmModel": "qwen3"
}
```

#### Exemple — confirmer une génération payante (étape 8)

```json
{
  "action": "launch_current_step",
  "confirmPaidGeneration": true,
  "confirmationText": "GENERATION PAYANTE",
  "acknowledgedSceneCount": 6
}
```

#### Exemple — tuer un run

```json
{ "action": "kill" }
```

**Réponse 200**

```json
{
  "data": {
    "action": "approve_and_launch_next_step",
    "result": { "started": true, "stepNumber": 3, "rerun": false },
    "snapshot": { ... }
  }
}
```

---

## Workflow complet — du zéro au run lancé

```bash
# 1. Orientation
GET /api/bot/status

# 2. Créer la chaîne + run
POST /api/bot/bootstrap
{
  "chainName": "Tech FR",
  "idea": "Les 5 erreurs Python que tout débutant fait",
  "meetingLlmMode": "local",
  "meetingLlmModel": "qwen3"
}
# → retourne run.id = "abc-123"

# 3. Observer
GET /api/bot/runs/abc-123/control
# → nextAction.kind = "launch_current_step" (étape 1)

# 4. Lancer l'étape 1
POST /api/bot/runs/abc-123/control
{ "action": "launch_current_step" }

# 5. Polling jusqu'à refreshAfterMs = 0
GET /api/bot/runs/abc-123/control   # refreshAfterMs = 3000 → attendre 3s
GET /api/bot/runs/abc-123/control   # refreshAfterMs = 0 → agir

# 6. Valider et enchaîner sur toutes les étapes
POST /api/bot/runs/abc-123/control
{ "action": "approve_and_launch_next_step" }

# ... répéter 5–6 jusqu'à status = "completed"
```

---

## Workflow — étape 2 (réunion des agents)

L'étape 2 est la plus importante : elle produit le brief structuré qui pilote toute la suite.

```bash
# Lancer la réunion
POST /api/bot/runs/{id}/control
{ "action": "launch_current_step", "llmMode": "local", "llmModel": "qwen3" }

# Attendre (refreshAfterMs > 0 pendant l'exécution)
GET /api/bot/runs/{id}/control  # → meeting.verdict.status = "pending"

# Quand terminée : lire le verdict
GET /api/bot/runs/{id}/control
# meeting.verdict.status = "pass"     → approve_and_launch_next_step
# meeting.verdict.status = "warn"     → inspecter meeting.verdict.checks, décider
# meeting.verdict.status = "fail"     → rerun_meeting
# meeting.verdict.recommendedAction  → action recommandée directe

# Relancer si nécessaire
POST /api/bot/runs/{id}/control
{ "action": "rerun_meeting", "llmMode": "cloud", "llmModel": "claude-sonnet-4-6" }
```

---

## Workflow — génération payante (étape 8)

L'étape 8 génère les clips vidéo (provider payant). Une double confirmation est requise.

```bash
# 1. Observer pour connaître le nombre de scènes
GET /api/bot/runs/{id}/control
# → run.currentStep = 8
# → nextAction.kind = "launch_current_step"

# 2. Tenter de lancer sans confirmation → erreur
POST /api/bot/runs/{id}/control
{ "action": "launch_current_step" }
# → 409 PAID_GENERATION_CONFIRMATION_REQUIRED
#   details.expectedSceneCount = 6

# 3. Confirmer et lancer
POST /api/bot/runs/{id}/control
{
  "action": "launch_current_step",
  "confirmPaidGeneration": true,
  "confirmationText": "GENERATION PAYANTE",
  "acknowledgedSceneCount": 6
}
```

---

## Endpoints complémentaires utiles

Ces endpoints n'ont pas le préfixe `/bot` mais restent utiles pour un LLM.

### Progression détaillée

```http
GET /api/runs/{id}/progress
```

Retourne step par step : `status`, `durationMs`, `costEur`, `error` pour chaque étape.

### Brief + traces de la réunion

```http
GET /api/runs/{id}/meeting
```

Retourne le brief structuré complet et les traces agents.

Relancer la réunion directement (alternative au bot control) :
```http
POST /api/runs/{id}/meeting
{ "force": true, "meetingLlmMode": "cloud", "meetingLlmModel": "claude-sonnet-4-6" }
```

### Logs de debug

```http
GET /api/runs/{id}/logs?limit=300
```

### Modèles LLM disponibles

```http
GET /api/llm/models?provider=all
```

### Santé des providers

```http
GET /api/providers
```

### File d'attente

```http
GET /api/queue
```

### Tuer un run (hors bot control)

```http
POST /api/runs/{id}/kill
```

---

## Codes d'erreur

Toutes les erreurs suivent le format :

```json
{ "error": { "code": "ERROR_CODE", "message": "...", "details": {} } }
```

| Code | HTTP | Description |
|------|------|-------------|
| `NOT_FOUND` | 404 | Ressource introuvable |
| `VALIDATION_ERROR` | 400 | Paramètre invalide ou manquant |
| `INVALID_STATE` | 409 | L'action n'est pas applicable dans l'état courant |
| `RUN_ACTIVE` | 409 | Un autre run est déjà en cours |
| `CHAIN_ARCHIVED` | 409 | Chaîne archivée — restaurer avant de créer un run |
| `MEETING_ALREADY_RUNNING` | 409 | Réunion étape 2 déjà en cours |
| `MEETING_ALREADY_COMPLETED` | 409 | Brief déjà produit — utiliser `force: true` pour relancer |
| `PAID_GENERATION_CONFIRMATION_REQUIRED` | 409 | Étape 8 nécessite confirmation explicite |
| `PAID_GENERATION_TEXT_MISMATCH` | 409 | `confirmationText` ne correspond pas à `"GENERATION PAYANTE"` |
| `PAID_GENERATION_SCENE_COUNT_MISMATCH` | 409 | `acknowledgedSceneCount` ne correspond pas au nombre réel |
| `BOT_CONTROL_GET_ERROR` | 500 | Erreur lecture snapshot |
| `BOT_CONTROL_POST_ERROR` | 500 | Erreur exécution action |
| `BOT_STATUS_ERROR` | 500 | Erreur lecture statut |
| `BOT_RUNS_ERROR` | 500 | Erreur lecture liste runs |

---

## Référence des `nextAction.kind`

| Kind | Signification |
|------|---------------|
| `launch_current_step` | Lancer l'étape courante (`pending` ou `failed`) |
| `approve_current_step` | Valider sans lancer la suivante |
| `approve_and_launch_next_step` | Valider + lancer la suivante |
| `wait` | Run en cours d'exécution — re-GET après `refreshAfterMs` ms |
| `none` | Run terminal ou état indéterminé — aucune action disponible |

---

## Référence des `meeting.verdict`

| `status` | `recommendedAction` | Que faire |
|----------|--------------------|-----------| 
| `missing` | `inspect_manually` | Lancer l'étape 2 via `launch_current_step` |
| `pending` | `wait` | Attendre la fin de la réunion |
| `pass` | `approve_and_continue` | `approve_and_launch_next_step` |
| `warn` | `inspect_manually` | Lire `verdict.checks` — décider de valider ou relancer |
| `fail` | `rerun_meeting` | Action `rerun_meeting` |

---

## Pipeline — étapes de référence

| Étape | Nom | LLM-backed | Payant |
|-------|-----|-----------|--------|
| 1 | Brainstorm | ✓ | Non |
| 2 | Réunion des agents | ✓ | Non |
| 3 | Structure JSON | ✓ | Non |
| 4 | Blueprint visuel | ✓ | Non |
| 5 | Storyboard | Non | Non |
| 6 | Audio (TTS + mix) | Non | Possible |
| 7 | Prompts Seedance | ✓ | Non |
| 8 | Génération vidéo | Non | **Oui** |
| 9 | Preview + export | Non | Non |
