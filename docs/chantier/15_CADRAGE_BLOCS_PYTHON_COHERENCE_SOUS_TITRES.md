# Cadrage chantier — blocs Python restants, cohérence visuelle, sous-titres précis, face tracking

Date : 24 avril 2026  
Projet : `FILM CREW`

---

## But du document

Ce document sert à cadrer proprement le **chantier restant le plus structurant** du produit.

Objectif :

- remettre l’état réel du produit à plat,
- corriger les faux négatifs du type “feature absente” alors qu’une base existe déjà,
- isoler ce qui manque **vraiment**,
- prioriser les gros blocs techniques restants,
- préparer une implémentation propre côté **Python local + TypeScript**,
- éviter de lancer un lot “fourre-tout” qui consomme du temps, des crédits et du focus.

En une phrase :

**le socle app/pipeline est déjà très avancé ; les plus gros trous restants sont des blocs runtime avancés, principalement Python local, autour de la précision média, de la cohérence visuelle et du packaging qualité.**

---

## Résumé exécutif

### Niveau d’avancement réaliste

Le produit est **largement plus avancé qu’un prototype** :

- pipeline principal en place,
- génération prompts provider-aware en place,
- failover/providers/safety déjà sérieux,
- export et preview déjà crédibles,
- briques virales YouTube déjà amorcées,
- sous-titres burnés déjà présents,
- UX cockpit / runs / re-gen déjà très avancée.

### Les 3 gros morceaux réellement restants

1. **Face tracking 9:16**
2. **Score CLIP / cohérence visuelle**
3. **WhisperX / faster-whisper word-level + sous-titres animés Hormozi**

### Important

Le diagnostic “Whisper totalement absent” ou “YouTube viral absent” doit être nuancé :

- **YouTube viral** : base déjà présente,
- **sous-titres burnés** : base déjà présente,
- **WhisperX mot par mot** : absent,
- **face tracking réel** : absent,
- **CLIP scoring réel** : absent.

Autrement dit :

**le terrain existe, mais pas encore les moteurs de précision avancée.**

---

## État réel du produit

## Ce qui existe déjà

### Pipeline média principal

Le produit sait déjà :

- structurer un run,
- générer storyboard / prompts / génération / preview / publish,
- exposer les prompts scène par scène,
- re-générer une scène,
- appliquer des garde-fous coût/provider,
- gérer une logique provider-aware pour les prompts vidéo,
- imposer des contraintes anti-fond studio + profondeur + TikTok 9:16.

### Sous-titres burnés

Le projet a déjà une base sous-titres FFmpeg exploitable :

- génération de `subtitles.srt`,
- `force_style` ASS/FFmpeg,
- configuration de :
  - police,
  - taille,
  - couleur,
  - outline,
  - marge verticale basse.

Cela signifie :

- **base sous-titres déjà réelle**, mais
- **timing encore approximatif**, pas mot par mot.

### Module viral YouTube — base réelle

Le projet contient déjà des briques virales crédibles :

- parsing de segments,
- contexte source YouTube,
- traitement transcript / sous-titres YouTube existants,
- manifests et types viraux,
- export shorts 9:16 alpha,
- tests unitaires associés.

Conclusion :

- **le module viral n’est pas vide**,
- mais **les couches premium (face tracking, Hormozi, timing mot à mot) ne sont pas encore livrées**.

### Coût / preview / publication / safety

Le produit a déjà :

- des briques d’estimation coût backend,
- des protections de génération payante,
- une logique preview / re-gen sérieuse,
- des providers monitorés,
- une base d’export / publication multi-plateforme.

---

## Ce qui manque vraiment

## Bloc A — FR25 + FR45

### WhisperX / faster-whisper word-level

Manque réel :

- transcription locale précise mot par mot,
- alignement temporel mot à mot,
- structure réutilisable pour sous-titres avancés,
- précision attendue pour un rendu type short social premium.

### Sous-titres animés Hormozi

Manque réel :

- surlignage mot par mot,
- animation synchronisée,
- mode “mots impactants” piloté par règles ou IA,
- presets d’emplacement explicites (`top`, `center`, `bottom`),
- logique feed-safe / zone captions / lecture mobile.

### Ce qui existe déjà mais ne suffit pas

Le pipeline sous-titres actuel repose encore sur :

- un timing proportionnel au nombre de caractères,
- un rendu SRT burné classique.

C’est suffisant pour une **alpha honnête**, pas pour un produit “Hormozi-grade”.

---

## Bloc B — FR46

### Face tracking 9:16

Manque réel :

- détection visage/visages,
- recadrage auto dynamique 9:16,
- maintien du sujet dans la safe zone,
- arbitrage mono-visage / multi-visages,
- mode split-screen si plusieurs visages simultanés,
- fallback si aucun visage détecté.

### Pourquoi ce bloc est critique

Sans face tracking :

- le module viral reste partiellement “statique”,
- le crop vertical peut rater le sujet,
- les shorts conversationnels / interview / podcast restent fragiles,
- la qualité perçue social/mobile reste inférieure à la promesse cible.

---

## Bloc C — FR5

### Score CLIP / cohérence visuelle

Manque réel :

- scoring local de similarité visuelle,
- agrégation cohérence,
- seuils d’alerte,
- exposition UI simple.

### Point clé produit

Le score ne doit pas être pensé uniquement comme :

- “cohérence entre vidéos d’une chaîne”

mais aussi comme :

- “cohérence entre les clips de 10s qui composent une même vidéo finale”.

### Donc il faut 2 niveaux de cohérence

#### 1. Cohérence intra-run / intra-vidéo

Comparer les scènes/clips d’un même run :

- personnage,
- palette,
- lumière,
- décor,
- matière,
- grain / style.

Exemple UI :

- `Cohérence interne vidéo : 84%`

#### 2. Cohérence inter-vidéos / chaîne

Comparer des runs récents d’une même chaîne :

- tonalité visuelle,
- ADN de lumière,
- texture,
- cadrage récurrent,
- constance branding.

Exemple UI :

- `Cohérence chaîne : 79%`

---

## Ce qui est partiel mais pas vide

## YouTube / viral

### Réalité

- extraction/parsing/base produit : **déjà amorcée**,
- face tracking : **non livré**,
- Hormozi : **non livré**,
- vrai timing word-level : **non livré**.

### Bonne formulation produit

Le module viral est :

- **déjà présent en base**,
- **encore incomplet en finition premium**.

## Sous-titres

### Réalité

Ce qui est déjà là :

- police,
- taille,
- couleur,
- outline,
- marge basse.

Ce qui manque encore :

- `top / center / bottom` clair,
- presets UI d’emplacement,
- mot par mot,
- animation impact words.

### Bonne formulation produit

Les sous-titres sont :

- **présents en version burn classique**,
- **pas encore au niveau social premium mot à mot**.

## Estimation coût pré-run

La brique backend existe déjà. Le manque principal semble être :

- la visibilité / activation claire côté UI avant lancement.

## Recherche web agents

La structure existe en partie, mais l’intégration produit n’est pas encore au niveau d’une feature utilisateur fermée.

---

## Ordre d’implémentation recommandé

## Priorité 1 — WhisperX / faster-whisper + nouveau contrat sous-titres

### Pourquoi en premier

Parce que ce bloc :

- améliore immédiatement la qualité perçue,
- bénéficie à la preview et au viral,
- débloque FR25 et prépare FR45,
- repose sur un besoin produit universel.

### Ce qu’il faut livrer

#### Phase 1

- script Python de transcription locale,
- sortie JSON segment + mot + timestamps,
- intégration TS pour remplacer le timing proportionnel,
- SRT/VTT exacts,
- compatibilité avec le pipeline actuel.

#### Phase 2

- mode sous-titres animés mot par mot,
- presets position : `top`, `center`, `bottom`,
- réglages style plus complets,
- surbrillance mot actif.

#### Phase 3

- mode “mots impactants” IA ou heuristique,
- style Hormozi configurable.

---

## Priorité 2 — Face tracking 9:16

### Pourquoi ensuite

Parce que :

- énorme valeur pour le viral,
- résultat très visible,
- fort impact mobile/TikTok/Shorts,
- indépendant du scoring CLIP.

### Ce qu’il faut livrer

#### Phase 1

- détection visage mono-sujet,
- trajectoire crop 9:16 simple,
- lissage mouvement,
- fallback center crop si pas de visage.

#### Phase 2

- multi-visages,
- stratégie focus dominant,
- split-screen si nécessaire.

#### Phase 3

- préférences UX / presets,
- debug visual overlay.

---

## Priorité 3 — Score CLIP cohérence

### Pourquoi après

Parce que :

- utile pour la qualité,
- très fort pour le pilotage,
- mais moins bloquant que sous-titres précis et face tracking pour la perception utilisateur directe.

### Ce qu’il faut livrer

#### Phase 1

- embeddings CLIP locaux,
- score intra-run,
- score inter-runs d’une chaîne,
- JSON de résultats.

#### Phase 2

- UI compacte,
- seuils vert/orange/rouge,
- signal de dérive visuelle.

#### Phase 3

- pondération brand kit / template / provider.

---

## Priorité 4 — Qualité / DevEx

- Playwright E2E,
- pytest Python,
- hook pre-push,
- GitHub Actions.

Ce bloc est important, mais il ne doit pas passer avant les moteurs Python si l’objectif reste la fermeture produit des features manquantes les plus visibles.

---

## Architecture cible recommandée

## Principe

Ne pas injecter de logique Python directement “en vrac” dans le pipeline.

Il faut au contraire créer une **petite couche d’outillage média local** propre, versionnable, testable, appelable depuis TypeScript.

### Cible

- TypeScript = orchestration produit / pipeline / UI / manifests
- Python = runtime local média avancé
- contrat JSON explicite entre les deux

---

## Arborescence recommandée

Dans `app/` :

- `scripts/python/whisper/`
- `scripts/python/face_tracking/`
- `scripts/python/clip_score/`
- `scripts/python/common/`
- `tests/python/`

Exemple cible :

- `scripts/python/whisper/transcribe_word_level.py`
- `scripts/python/whisper/render_hormozi_segments.py`
- `scripts/python/face_tracking/crop_faces_916.py`
- `scripts/python/face_tracking/split_screen_faces.py`
- `scripts/python/clip_score/score_visual_coherence.py`
- `scripts/python/common/io_contracts.py`

---

## Contrats JSON recommandés

## Contrat A — Word-level transcript

Entrée TypeScript -> Python :

- audio path,
- langue attendue,
- modèle,
- mode word-level,
- tolérance,
- destination output.

Sortie Python -> TypeScript :

- `language`
- `duration_s`
- `segments[]`
  - `start_s`
  - `end_s`
  - `text`
  - `words[]`
    - `word`
    - `start_s`
    - `end_s`
    - `confidence`

### But

Cette structure doit devenir la **source canonique** de vérité pour :

- SRT,
- VTT,
- sous-titres animés,
- mots impactants,
- future édition fine.

---

## Contrat B — Face tracking crop

Entrée :

- vidéo source,
- ratio cible `9:16`,
- mode mono ou multi-visage,
- sensibilité detection,
- marge sujet,
- lissage,
- fallback policy.

Sortie :

- `sourceFilePath`
- `outputFilePath`
- `modeUsed`
- `facesDetected`
- `segments[]`
  - `start_s`
  - `end_s`
  - `crop`
    - `x`
    - `y`
    - `width`
    - `height`
- `fallbackApplied`
- `debugOverlayPath?`

### But

Rendre le comportement :

- traçable,
- testable,
- explicable dans l’UI.

---

## Contrat C — CLIP coherence

Entrée :

- liste d’images clé ou frames extraites,
- scope :
  - `run`
  - `chain`
- référence optionnelle,
- mode :
  - `intra_video`
  - `inter_video`

Sortie :

- `scope`
- `globalScore`
- `pairs[]`
  - `a`
  - `b`
  - `score`
- `label`
- `explanation`
- `alerts[]`

### But

Obtenir un score produit simple, mais reposant sur une base explicable.

---

## Recommandations techniques macOS / local

## Whisper

### Options réalistes

#### Option 1 — `faster-whisper`

Avantages :

- plus simple,
- plus léger,
- bonne base pour la transcription précise.

#### Option 2 — `whisperx`

Avantages :

- alignement plus fin,
- plus proche de la cible word-level premium.

Inconvénients :

- setup plus lourd,
- dépendances plus sensibles.

### Recommandation

- commencer par **`faster-whisper`** si l’objectif est d’atterrir vite,
- basculer ou étendre vers **`whisperx`** si l’alignement final le justifie.

---

## CLIP local sur macOS

### Piste

- PyTorch + MPS si stable,
- fallback CPU si besoin.

### Important

Le score CLIP est un module qualité, pas un runtime temps réel critique.

Donc :

- un fallback CPU acceptable est tolérable,
- la fiabilité prime sur la performance absolue.

---

## Face tracking

### Pistes réalistes

- `MediaPipe`
- `InsightFace`
- éventuellement OpenCV pour l’orchestration / suivi / debug.

### Recommandation pragmatique

- démarrer avec la solution la plus simple à fiabiliser en local macOS,
- ne pas sur-ingénierer le multi-face au premier lot,
- livrer d’abord un **mono-visage propre + fallback honnête**.

---

## Découpage de lot recommandé

## Lot 1 — Sous-titres précis

### Scope

- transcription locale fiable,
- JSON mot par mot,
- SRT/VTT exacts,
- position `top/center/bottom`,
- intégration pipeline preview/viral.

### Hors scope

- mode impact words complexe,
- animations premium complètes.

### Done

- le timing n’est plus proportionnel au texte,
- les sous-titres peuvent être placés correctement,
- les manifests exposent la structure word-level.

---

## Lot 2 — Hormozi

### Scope

- mot actif highlight,
- couleurs configurables,
- style social premium,
- export burné.

### Hors scope

- NLP lourd / sémantique avancée des mots impactants.

### Done

- un short peut avoir un rendu mot à mot lisible et premium.

---

## Lot 3 — Face tracking

### Scope

- crop mono-visage 9:16,
- lissage,
- fallback honnête.

### Done

- le sujet reste dans le cadre sur un short vertical standard.

---

## Lot 4 — Multi-face

### Scope

- stratégie 2 personnes,
- split-screen ou focus dominant.

### Done

- cas interview/podcast traité proprement.

---

## Lot 5 — CLIP coherence

### Scope

- score intra-run,
- score inter-chaîne,
- affichage simple,
- alerte dérive.

### Done

- la qualité visuelle devient pilotable, pas seulement intuitive.

---

## Risques principaux

| ID | Risque | Impact | Réponse recommandée |
|----|--------|--------|---------------------|
| R1 | Setup Python trop lourd trop tôt | Fort | livrer en phases, commencer par un lot Whisper simple |
| R2 | MPS instable sur certains modèles | Moyen | fallback CPU propre |
| R3 | Face tracking multi-visage explose le scope | Fort | mono-visage d’abord |
| R4 | Hormozi sans word-level réel devient cosmétique | Fort | ne pas lancer FR45 avant FR25 réel |
| R5 | Score CLIP trop opaque pour l’utilisateur | Moyen | labels + seuils + explication simple |
| R6 | Le chantier repart en lot fourre-tout | Très fort | un bloc majeur à la fois, critères de done stricts |

---

## Décisions produit recommandées

| ID | Décision | Recommandation |
|----|----------|----------------|
| D1 | Le score cohérence doit-il être double ? | Oui : intra-vidéo + inter-chaîne |
| D2 | WhisperX obligatoire dès le départ ? | Non : `faster-whisper` d’abord si plus vite livrable |
| D3 | Face tracking multi-visage dans le premier lot ? | Non |
| D4 | Les sous-titres doivent-ils intégrer la position ? | Oui, explicitement |
| D5 | Le CLIP score doit-il bloquer un export ? | Non au début, signal seulement |

---

## Critères de réussite de ce chantier

Le chantier sera bien cadré si, à la fermeture, on peut dire :

1. les sous-titres ne reposent plus sur une approximation grossière,
2. le module viral gère correctement la lecture mobile verticale,
3. la cohérence visuelle devient mesurable,
4. les blocs Python sont intégrés proprement et testables,
5. l’utilisateur voit une vraie montée de qualité, pas juste des cases cochées.

---

## Recommandation nette

Le bon ordre est :

1. **Whisper / sous-titres précis / position**
2. **Hormozi**
3. **Face tracking 9:16**
4. **CLIP coherence**
5. **Playwright / pytest / hooks / CI**

En une phrase :

**on commence par la précision texte/temps, puis la lisibilité mobile, puis le cadrage intelligent, puis la mesure qualité.**

---

## Protocole opératoire — travail parallèle Claude / consolidation main

Ce chantier doit être exécuté de façon **séquentielle, lot par lot**, sur **une autre branche que `main`**.

### Règles de fonctionnement

1. Claude travaille sur **une branche dédiée chantier**.
2. Claude ne traite **qu’un seul lot à la fois**.
3. À la fin de chaque lot, Claude doit :
  - s’arrêter,
  - remplir la **zone de compte rendu du lot** dans ce fichier,
  - committer localement sur sa branche,
  - pousser sa branche,
  - attendre la **validation explicite Copilot / Malik** avant de commencer le lot suivant.
4. Aucun passage au lot suivant sans :
  - compte rendu rempli,
  - tests/commandes notés,
  - SHA de commit noté,
  - verdict de validation.
5. `main` reste la branche de consolidation des fonctions actuelles ; ce chantier avance donc en parallèle sans polluer le tronc principal avant validation.

### Règle Git impérative

- branche de travail recommandée : `feat/python-media-precision` ou équivalent explicite,
- un commit minimum par lot validé,
- push après chaque lot validé,
- pas de squash silencieux entre plusieurs lots non validés,
- le SHA poussé pour le lot doit être reporté dans la zone de compte rendu correspondante.

### Règle de stop obligatoire pour Claude

Quand un lot est terminé, Claude doit :

- mettre à jour ce fichier,
- écrire ce qui a été fait,
- écrire comment cela a été fait,
- lister les fichiers touchés,
- noter les commandes/tests exécutés,
- noter les limites restantes,
- noter le commit et la branche,
- s’arrêter et attendre validation.

---

## Plan de lots précis

Le chantier est découpé ci-dessous en **lots suffisamment petits pour être démontrables**, mais assez complets pour produire une vraie progression produit.

---

## Lot 1A — Transcription locale word-level canonique

### Objectif

Créer le premier runtime Python local de transcription exploitable par le pipeline, avec une sortie JSON mot par mot servant de source canonique.

### Scope exact

- créer le script Python de transcription locale,
- choisir l’implémentation initiale (`faster-whisper` en priorité si plus simple à stabiliser),
- produire un JSON avec segments + mots + timestamps,
- définir le contrat TS ↔ Python,
- ajouter l’appel TypeScript minimal,
- permettre un run local sur un fichier audio de test.

### Hors scope explicite

- rendu Hormozi,
- UI avancée,
- face tracking,
- score CLIP,
- mots impactants.

### Preuve attendue

- un JSON word-level généré localement,
- un test ou script de démonstration reproductible,
- contrat JSON documenté et stable.

### Condition d’arrêt du lot

Le lot s’arrête dès que la transcription word-level locale fonctionne de bout en bout et que le JSON canonique est produit proprement.

### Validation attendue par Copilot / Malik

- structure JSON propre,
- commande reproductible,
- dépendances réalistes sur macOS,
- pas d’effet de bord sur le pipeline actuel.

### Zone de compte rendu Claude — Lot 1A

**Statut** : `LIVRÉ`

**Branche de travail** : `feat/python-media-precision`

**Commit SHA** : `9e6b7ac`

**Résumé de livraison** : Premier runtime Python local de transcription word-level fonctionnel, avec contrat JSON canonique, bridge TypeScript, et preuve d'exécution sur un fichier audio réel du pipeline.

**Ce qui a été fait** :

- Script Python `transcribe_word_level.py` avec faster-whisper 1.2.1
- Contrat JSON canonique : segments[] → words[] avec start_s/end_s/confidence par mot
- Bridge TypeScript `whisper-bridge.ts` : spawn Python, parse JSON, fallback null si erreur
- Types TypeScript exportés : WhisperTranscript, WhisperSegment, WhisperWord, WhisperInput
- Requirements Python minimales (faster-whisper>=1.1.0)
- Test Vitest (6 cas) validant la structure du contrat JSON
- Exécution réelle sur un fichier TTS du pipeline (40.9s audio → 94 mots, 2.55s traitement)

**Comment cela a été fait** :

- faster-whisper choisi car plus simple/léger que whisperx, compatible macOS CPU (CTranslate2 int8)
- Le script utilise le contrat IO existant (`scripts/common/io.py`) — JSON stdin/stdout
- Le bridge TS retourne `null` en cas d'échec → le pipeline existant peut conserver son fallback proportionnel
- venv Python créé dans `.venv/` (déjà dans .gitignore)
- Modèle `tiny` utilisé pour le test (téléchargé automatiquement via HuggingFace)

**Fichiers créés / modifiés** :

- `scripts/python/whisper/transcribe_word_level.py` — CRÉÉ
- `scripts/python/whisper/requirements.txt` — CRÉÉ
- `src/lib/pipeline/whisper-bridge.ts` — CRÉÉ
- `src/lib/pipeline/__tests__/whisper-bridge.test.ts` — CRÉÉ

**Commandes / tests exécutés** :

- `python3 -m venv .venv && .venv/bin/pip install faster-whisper` → OK (1.2.1)
- `echo '{"audio_path":"...wav","language":"fr","model_size":"tiny"}' | .venv/bin/python scripts/python/whisper/transcribe_word_level.py` → JSON word-level complet
- `npx vitest run src/lib/pipeline/__tests__/whisper-bridge.test.ts` → 6/6 passed
- `npx tsc --noEmit --skipLibCheck` → 0 erreur

**Résultat observé** :

- Transcription réelle : 40.9s d'audio → 9 segments, 94 mots, timestamps mot par mot
- Temps de traitement : 2.55s (modèle tiny, CPU int8)
- Chargement modèle : 3.23s (première exécution, mise en cache ensuite)
- Confidence par mot : 0.0013 à 0.9981 (utile pour le futur filtrage Hormozi)

**Limites connues / reste à faire avant lot suivant** :

- CPU uniquement (MPS pas supporté par CTranslate2 sur macOS) — acceptable pour un runtime local
- Le bridge TS n'est pas encore branché dans step-7-preview.ts (c'est le scope du Lot 1B)
- Le modèle `tiny` est rapide mais moins précis — le modèle `base` ou `small` sera recommandé en production
- Le HF_TOKEN n'est pas configuré — avertissement HuggingFace mais fonctionnel sans
- Pas de gestion de progrès intermédiaire (report_progress) — non nécessaire pour le Lot 1A

**Demande de validation Copilot / Malik** :

- La structure JSON est-elle conforme à vos attentes ?
- Le choix faster-whisper (vs whisperx) convient-il pour la suite ?
- Le scope Lot 1A est-il considéré comme fermé ?
- Feu vert pour passer au Lot 1B (intégration pipeline SRT/VTT exacts) ?

---

## Lot 1B — Intégration pipeline SRT/VTT exacts

### Objectif

Remplacer le timing proportionnel approximatif par une génération SRT/VTT fondée sur la sortie word-level réelle.

### Scope exact

- brancher le JSON word-level dans le pipeline TypeScript,
- générer un SRT exact,
- générer un VTT exact si pertinent,
- conserver un fallback clair si le moteur Python n’est pas disponible,
- éviter toute régression sur la preview actuelle.

### Hors scope explicite

- animation mot actif,
- UI avancée des styles,
- face tracking,
- score CLIP.

### Preuve attendue

- plus aucun timing principal basé sur le comptage de caractères dans le chemin nominal,
- fichier(s) de sous-titres exacts générés,
- test(s) couvrant le nouveau flux.

### Condition d’arrêt du lot

Le lot s’arrête dès que le pipeline principal lit le JSON word-level et produit un sous-titrage temporel exact.

### Validation attendue par Copilot / Malik

- remplacement effectif du timing approximatif,
- fallback propre,
- compatibilité preview/export.

### Zone de compte rendu Claude — Lot 1B

**Statut** : `LIVRÉ`

**Branche de travail** : `feat/python-media-precision`

**Commit SHA** : `920f192`

**Résumé de livraison** : Le chemin nominal de génération SRT utilise désormais le transcript word-level faster-whisper quand disponible. Fallback automatique sur le timing proportionnel si Python échoue.

**Ce qui a été fait** :

- `generateSRTFromWhisper(segments, outputDir)` ajoutée dans `subtitles.ts` — produit un SRT avec timestamps exacts des mots whisper
- Découpage automatique des segments longs (>8s) en sous-blocs basés sur les timestamps des mots
- `step-7-preview.ts` : tente `transcribeWordLevel()` → si succès → `generateSRTFromWhisper()` → sinon → fallback `generateSRT()` (proportionnel)
- Nouveau champ manifest : `subtitleSource: 'whisper' | 'proportional' | null`
- Le transcript word-level JSON est aussi sauvé dans `final/transcript-word-level.json` pour exploitation future (Hormozi, etc.)
- 4 nouveaux tests Lot 1B (SRT exact, découpage segments longs, rejet si vide, fallback proportionnel)

**Comment cela a été fait** :

- `generateSRTFromWhisper` itère sur les segments whisper et utilise directement `start_s`/`end_s` comme timestamps SRT
- Pour les segments >8s, elle découpe aux frontières de mots en accumulant les mots jusqu'à dépasser 8s
- Dans `step-7-preview.ts`, le bloc SRT essaie d'abord whisper (via `transcribeWordLevel()`), puis fallback sur l'ancien code proportionnel si `srtPath` est encore null
- `subtitleSource` dans le manifest permet de tracer quel chemin a été emprunté

**Fichiers créés / modifiés** :

- `src/lib/pipeline/subtitles.ts` — MODIFIÉ (ajout `generateSRTFromWhisper`)
- `src/lib/pipeline/steps/step-7-preview.ts` — MODIFIÉ (branchement whisper + fallback + `subtitleSource`)
- `src/lib/pipeline/__tests__/whisper-bridge.test.ts` — MODIFIÉ (4 tests Lot 1B ajoutés)

**Commandes / tests exécutés** :

- `npx tsc --noEmit --skipLibCheck` → 0 erreur
- `npx vitest run src/lib/pipeline/__tests__/whisper-bridge.test.ts` → 10/10 passed
- `npx vitest run src/lib/pipeline/__tests__/` → 234/234 passed, 0 régression

**Résultat observé** :

- SRT exact : timestamps directement issus de faster-whisper (ex: `00:00:00,000 --> 00:00:02,500`)
- Découpage >8s : segment de 18s découpé en 2+ sous-blocs aux frontières de mots
- Fallback : si whisper échoue → ancien timing proportionnel, pipeline continue
- Manifest : `subtitleSource` = `'whisper'` ou `'proportional'` selon le chemin emprunté

**Limites connues / reste à faire avant lot suivant** :

- Pas de génération VTT (SRT uniquement) — suffisant pour le burn FFmpeg actuel
- Le transcript JSON est sauvé mais pas encore exploité pour Hormozi (Lot 2A)
- `PYTHON_BIN` par défaut = `python3` — si le venv n'est pas dans le PATH, il faut configurer `PYTHON_BIN=.venv/bin/python`
- Le modèle whisper est hardcodé `base` dans step-7-preview — pourrait être configurable via env

**Demande de validation Copilot / Malik** :

- Le branchement whisper → fallback proportionnel est-il conforme ?
- Le champ `subtitleSource` dans le manifest convient-il ?
- Feu vert pour le Lot 1C (positionnement sous-titres top/center/bottom) ?

---

## Lot 1C — Positionnement sous-titres et options produit de base

### Objectif

Passer d’un simple `marginBottom` à une logique produit explicite `top / center / bottom` pour les sous-titres.

### Scope exact

- définir un modèle de positionnement stable,
- brancher ce modèle dans le rendu FFmpeg/ASS,
- exposer les presets de position dans le pipeline si nécessaire,
- conserver police/taille/couleur déjà existants,
- vérifier la lecture mobile.

### Hors scope explicite

- animation mot par mot,
- détection automatique des zones sûres complexe,
- face tracking,
- score CLIP.

### Preuve attendue

- trois positions distinctes réellement rendues,
- comportement documenté,
- pas de rupture sur le burn actuel.

### Condition d’arrêt du lot

Le lot s’arrête dès que les sous-titres peuvent être rendus proprement en haut, au centre ou en bas, avec une implémentation claire.

### Validation attendue par Copilot / Malik

- positions visuellement distinctes,
- logique simple à maintenir,
- cohérence mobile.

### Zone de compte rendu Claude — Lot 1C

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Lot 2A — Sous-titres animés mot actif (base Hormozi)

### Objectif

Poser une première version premium mot par mot avec surbrillance du mot actif synchronisé.

### Scope exact

- exploiter les timestamps word-level,
- rendre un mot actif visible,
- définir un style de base configurable,
- produire un export burné lisible.

### Hors scope explicite

- sélection IA des mots impactants,
- styles avancés multiples,
- face tracking,
- CLIP.

### Preuve attendue

- vidéo ou rendu où le mot actif suit réellement l’audio,
- configuration minimale des couleurs/styles.

### Condition d’arrêt du lot

Le lot s’arrête dès que la surbrillance du mot actif fonctionne de façon stable et démontrable.

### Validation attendue par Copilot / Malik

- lisibilité,
- synchro crédible,
- absence d’effet cosmétique trompeur.

### Zone de compte rendu Claude — Lot 2A

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Lot 2B — Mots impactants / style Hormozi enrichi

### Objectif

Ajouter la logique “mots impactants” et enrichir le style Hormozi sans casser la base mot actif.

### Scope exact

- définir une heuristique ou un mode IA pour les mots impactants,
- permettre couleur/variation spécifique,
- enrichir le style visuel.

### Hors scope explicite

- face tracking,
- score CLIP.

### Preuve attendue

- différence visible entre mot actif simple et mot impactant,
- comportement configurable.

### Condition d’arrêt du lot

Le lot s’arrête dès qu’un rendu Hormozi enrichi est démontrable sans fragiliser le sous-titrage de base.

### Validation attendue par Copilot / Malik

- gain visuel réel,
- pas de sur-ingénierie opaque.

### Zone de compte rendu Claude — Lot 2B

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Lot 3A — Face tracking mono-visage 9:16

### Objectif

Livrer un recadrage vertical intelligent mono-visage réellement exploitable.

### Scope exact

- détection visage,
- crop 9:16 dynamique,
- lissage,
- fallback center crop si aucun visage.

### Hors scope explicite

- split-screen,
- arbitrage multi-visages avancé,
- CLIP.

### Preuve attendue

- un clip vertical où le visage reste dans la zone utile,
- JSON/manifest du crop.

### Condition d’arrêt du lot

Le lot s’arrête dès qu’un cas mono-visage standard fonctionne de bout en bout en local.

### Validation attendue par Copilot / Malik

- stabilité du cadre,
- fallback honnête,
- traçabilité technique.

### Zone de compte rendu Claude — Lot 3A

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Lot 3B — Multi-visages et split-screen

### Objectif

Traiter les cas interview / podcast / deux visages simultanés.

### Scope exact

- détection multi-visages,
- stratégie focus dominant ou split-screen,
- debug overlay si utile.

### Hors scope explicite

- CLIP.

### Preuve attendue

- au moins un cas multi-visage correctement géré,
- comportement documenté.

### Condition d’arrêt du lot

Le lot s’arrête dès qu’un cas multi-visage réel est supporté de façon démontrable.

### Validation attendue par Copilot / Malik

- valeur réelle pour les shorts conversationnels,
- complexité maîtrisée.

### Zone de compte rendu Claude — Lot 3B

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Lot 4A — Score CLIP intra-vidéo

### Objectif

Mesurer la cohérence des clips d’une même vidéo / d’un même run.

### Scope exact

- extraction d’images clé ou frames,
- embeddings CLIP,
- score global intra-run,
- sortie JSON explicable.

### Hors scope explicite

- comparaison inter-chaîne.

### Preuve attendue

- score intra-vidéo calculé,
- structure exploitable en UI.

### Condition d’arrêt du lot

Le lot s’arrête dès qu’un run peut produire un score de cohérence interne stable et traçable.

### Validation attendue par Copilot / Malik

- score compréhensible,
- utilité réelle pour piloter les sorties.

### Zone de compte rendu Claude — Lot 4A

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Lot 4B — Score CLIP inter-vidéos / chaîne

### Objectif

Mesurer la cohérence visuelle de plusieurs runs d’une même chaîne.

### Scope exact

- comparaison de runs récents,
- score chaîne,
- labels simples,
- alertes de dérive.

### Hors scope explicite

- blocage dur des exports.

### Preuve attendue

- score chaîne calculé,
- interprétation simple,
- base d’affichage UI prête.

### Condition d’arrêt du lot

Le lot s’arrête dès qu’une chaîne peut exposer un score de cohérence global avec logique de dérive visuelle.

### Validation attendue par Copilot / Malik

- lisibilité produit,
- utilité réelle pour piloter l’identité visuelle.

### Zone de compte rendu Claude — Lot 4B

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Lot 5 — Qualité / DevEx / garde-fous d’exécution

### Objectif

Encadrer les nouveaux blocs Python par un minimum de qualité et d’automatisation.

### Scope exact

- tests Python `pytest`,
- socle Playwright E2E si pertinent,
- hook pre-push,
- workflow CI minimal.

### Hors scope explicite

- refonte complète de la qualité globale du repo.

### Preuve attendue

- exécution automatique d’un socle de vérifications avant push ou en CI.

### Condition d’arrêt du lot

Le lot s’arrête dès qu’un garde-fou crédible entoure les nouveaux blocs Python et leurs points d’intégration TS.

### Validation attendue par Copilot / Malik

- couverture minimale utile,
- coût de maintenance raisonnable.

### Zone de compte rendu Claude — Lot 5

**Statut** : `TODO / EN COURS / LIVRÉ / VALIDÉ`

**Branche de travail** :

**Commit SHA** :

**Résumé de livraison** :

**Ce qui a été fait** :

- 

**Comment cela a été fait** :

- 

**Fichiers créés / modifiés** :

- 

**Commandes / tests exécutés** :

- 

**Résultat observé** :

- 

**Limites connues / reste à faire avant lot suivant** :

- 

**Demande de validation Copilot / Malik** :

- 

---

## Checklist de validation Copilot pour chaque lot

Avant de valider un lot, Copilot doit vérifier au minimum :

- [ ] le scope annoncé du lot a bien été respecté,
- [ ] Claude n’a pas dérivé vers le lot suivant,
- [ ] ce fichier a bien été annoté,
- [ ] la branche et le SHA sont bien renseignés,
- [ ] les tests/commandes exécutés sont notés,
- [ ] les limites restantes sont explicites,
- [ ] le push a été effectué sur la branche dédiée,
- [ ] le lot est soit validé, soit renvoyé avec remarques précises.

---

## Prompt prêt à coller dans Claude

Tu peux donner ceci à Claude pour lancer ce chantier en parallèle :

> On part du document `CHANTIER_PROMESSE_CIBLE/15_CADRAGE_BLOCS_PYTHON_COHERENCE_SOUS_TITRES.md`.  
> Ce document est la source de vérité du chantier.  
> Tu travailles sur une branche dédiée, séparée de `main`.  
> Tu dois traiter **un seul lot à la fois**, strictement dans l’ordre indiqué.  
> Quand un lot est terminé :  
> 1. tu remplis la zone de compte rendu du lot dans ce même fichier,  
> 2. tu notes précisément ce que tu as fait et comment,  
> 3. tu notes les fichiers modifiés, commandes, tests, limites restantes, branche et SHA,  
> 4. tu commit et push sur ta branche,  
> 5. tu t’arrêtes et tu attends une validation explicite de Copilot / Malik avant de commencer le lot suivant.  
> Interdiction de dériver sur le lot suivant sans validation.  
> Commence uniquement par le **Lot 1A**.
