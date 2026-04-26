# Cadrage C2 / C3 / C4 — Suite structurée après `C1`

Date : 25 avril 2026  
Projet : `FILM CREW`

---

## But

Figer la **suite logique après `C1`** sans ouvrir trop tôt plusieurs chantiers en parallèle.

Ce document ne sert **pas** à lancer immédiatement `C2`, `C3` et `C4`.
Il sert à :

- nommer clairement les étages suivants,
- éviter les dérives de scope après `C1`,
- donner une trajectoire lisible à Claude et à l'opérateur,
- préserver une logique produit long terme cohérente.

---

## Positionnement global

Le bloc `A1 → B8` a clos la **couche audio-first V1**.
Le chantier `C1` ouvre la **publication réelle pilotée par l'audio canonique**.

La suite naturelle n'est pas un refacto diffus.
La suite naturelle est une montée en capacité par étages :

1. `C1` — rendre la publication réelle mono-plateforme propre et pilotable,  
2. `C2` — étendre ce contrat de sortie à plusieurs destinations,  
3. `C3` — rendre l'exploitation robuste dans la durée,  
4. `C4` — boucler la publication vers l'apprentissage produit.

---

## Principe directeur

> L'audio canonique ne doit pas seulement fabriquer juste.  
> Il doit d'abord gouverner la sortie réelle (`C1`),  
> puis la distribution (`C2`),  
> puis l'exploitation (`C3`),  
> puis l'optimisation produit (`C4`).

---

## C2 — Distribution multi-cibles pilotée par un contrat unique

> ⚠️ **ANGLE MORT MAJEUR — L'existant n'est pas nommé ici.**
>
> Les lots `11B` (YouTube Shorts réel, `videoId k5w9lzyGJn8`) et `10A` (TikTok sandbox réel) ont déjà livré :
> - une `platform-types`, une `factory`, un `publish-manifest.json`,
> - un `TikTokPublisher` et un `YouTubeShortsPublisher` opérationnels.
>
> C2 **ne part pas de zéro**. Il part d'une architecture publisher fonctionnelle mais incomplète.
>
> **Ce qui est absent ici :** nommer ce qui existe, ce qui manque, et pourquoi le contrat actuel ne suffit pas.
> Sans ça, Claude risque de reconstruire ce qui existe déjà — ou de l'implémenter différemment.
>
> Action à faire avant d'ouvrir C2 : inventorier `app/src/publishers/` et `publish-manifest.json`.

### But

Étendre la logique de `C1` à **plusieurs destinations de sortie**, sans casser la traçabilité issue du run audio canonique.

### Pourquoi ce chantier est pertinent

Une publication mono-plateforme propre prouve que la chaîne est opérable.
Mais tant que chaque destination reste un cas particulier, la diffusion reste fragile.

`C2` sert à éviter :

- les branches ad hoc par plateforme,
- les métadonnées incohérentes selon la cible,
- les résultats de publication incomparables,
- les sorties non alignées avec le run canonique.

### Cible

La cible de `C2` est :

> un **contrat de distribution multi-cibles lisible**, où plusieurs destinations peuvent être alimentées à partir du même paquet canonique de publication.

### Inclus

- définition d'une abstraction claire de destination,
- adaptation contrôlée des métadonnées par cible,
- résultat séparé par destination,
- état clair par canal de diffusion,
- tests ciblés par destination.

### Exclus pour l'instant

- orchestration marketing avancée,
- règles de scoring / auto-optimisation,
- diffusion massive multi-comptes,
- personnalisation créative lourde par plateforme.

### Découpage recommandé

#### C2.1 — Contrat de destination

But : définir comment une cible de publication est décrite et validée.

> ⚠️ **ANGLE MORT — Risque de double avec `C1.1`.**
>
> `C1.1` livre un "paquet de publication propre" avec un contrat d'artefacts explicite.
> `C2.1` veut définir "comment une cible est décrite et validée".
>
> Ces deux périmètres **se chevauchent** si C1.1 n'est pas borné à "paquet canonique → une cible".
>
> La règle à poser maintenant : **C1.1 fixe le paquet canonique. C2.1 étend ce paquet à plusieurs cibles. Zéro redéfinition du paquet.**
>
> Sinon C2.1 ouvre implicitement un refacto de C1.1 — exactement ce qu'on veut éviter.

À produire :

- type / schéma de destination,
- mapping clair entre paquet canonique et destination,
- contrat de sortie par cible.

#### C2.2 — Première seconde cible

But : prouver que le modèle n'est pas mono-usage.

> ⚠️ **ANGLE MORT — La cible n'est pas nommée.**
>
> "Une deuxième destination réelle ou dry-runnable" est trop vague pour piloter Claude sans dérive.
>
> Questions sans réponse ici :
> - Est-ce **TikTok production** (vs sandbox actuel) ? Le plus logique — même publisher, seuls les credentials changent.
> - Est-ce **Instagram Reels** ? Format 9:16 compatible, mais API Meta plus complexe, nouveau publisher à écrire.
> - Est-ce une destination **dry-run only** pour valider le modèle sans publication réelle ?
>
> **Décision à prendre avant d'ouvrir C2.2 :** nommer explicitement la deuxième plateforme cible.
>
> Recommandation : TikTok production d'abord. Prouve le modèle multi-cibles sans nouveau publisher, et ferme la dette sandbox actuelle.

À produire :

- une deuxième destination réelle ou dry-runnable,
- compatibilité du paquet canonique,
- résultat lisible par plateforme.

#### C2.3 — Résultat agrégé multi-cibles

But : obtenir une lecture d'ensemble fiable.

> ⚠️ **ANGLE MORT — Le `publish-manifest.json` actuel est mono-résultat.**
>
> Aujourd'hui il y a un manifest par run, pour une plateforme.
> C2.3 nécessite soit un manifest multi-résultats, soit un fichier d'agrégation séparé.
>
> La décision architecturale (étendre l'existant vs nouveau fichier) doit être prise avant d'écrire du code.
> Sinon Claude improvise — et on se retrouve avec une structure incompatible avec C3 et C4.

À produire :

- statut global,
- statuts détaillés par cible,
- run relançable sans ambiguïté.

### Critère de succès

- une même sortie canonique peut être distribuée vers plusieurs cibles,
- chaque cible expose un résultat lisible,
- l'opérateur comprend immédiatement ce qui a été tenté, réussi, échoué.

---

## C3 — Exploitation robuste / observabilité / reprise

> ⚠️ **ANGLE MORT MAJEUR — C3 est partiellement déjà livré.**
>
> Les lots `12A`, `12B`, `12C` ont livré :
> - `GET /api/queue` (visibilité runtime),
> - `GET /api/runs/{id}/progress` (statut + progressPct),
> - `POST /api/runs/{id}/kill` (contrôle d'exécution),
> - Recovery automatique des zombies (`status=failed` persisté, queue propre),
> - Taxonomie normalisée : `pending / running / killed / failed / success`.
>
> C3 tel qu'écrit **ignore complètement cet acquis**.
>
> Avant d'ouvrir C3, nommer les **vrais gaps** — ce qui manque vraiment après 12A/12B/12C :
> - Le journal d'exécution est-il lisible pour un non-développeur ?
> - Le retry est-il normé ou encore bricolé manuellement ?
> - L'historique des runs est-il exploitable sur plusieurs jours ?
>
> Sans cet inventaire, C3 duplique 12A/12B/12C au lieu de les consolider.

### But

Passer d'un système qui "publie" à un système qui **s'exploite proprement dans le temps**.

### Pourquoi ce chantier est pertinent

Même si `C1` et `C2` produisent et distribuent bien, la valeur réelle reste limitée si :

- on ne sait pas relire un run,
- on ne comprend pas l'état exact d'une publication,
- un retry demande du bricolage,
- la reprise après incident n'est pas normée.

`C3` traite la fiabilité opérationnelle.

### Cible

La cible de `C3` est :

> une **exploitation robuste, traçable, relançable**, où chaque run de publication possède un état clair, un historique lisible et une mécanique de reprise contrôlée.

### Inclus

- statuts normalisés,
- historique d'exécution exploitable,
- erreurs explicites,
- retries maîtrisés,
- garde-fous opérateur.

### Exclus pour l'instant

- dashboard UI lourd,
- observabilité temps réel sophistiquée,
- alerting multi-canaux avancé,
- analytics produit détaillées.

### Découpage recommandé

#### C3.1 — Modèle d'état unifié

But : uniformiser les statuts et transitions d'état.

> ⚠️ **ANGLE MORT — Ce modèle existe déjà.**
>
> La taxonomie `pending / running / killed / failed / success` est livrée et testée (`367/367` tests, 12B/12C).
>
> C3.1 ne doit pas recréer ce modèle. Il doit :
> - **documenter** ce qui existe,
> - **identifier les gaps** réels — ex : avec C2 multi-cibles, un run peut avoir une cible SUCCESS et une autre FAILED. Un état `partial_success` est-il nécessaire ?
> - **compléter uniquement ce qui manque**.
>
> C'est là que C3.1 a une vraie valeur ajoutée : pas sur les états simples déjà normalisés, mais sur les états composites apparus avec le multi-cibles.

À produire :

- taxonomie d'état unique,
- règles de transition,
- distinction claire entre succès, échec, retry, abandon.

#### C3.2 — Historique et traçabilité opérateur

But : rendre un run relisible après coup.

> ⚠️ **ANGLE MORT — Frontière floue avec `C1.4`.**
>
> `C1.4` livre : contrôle opérateur / lecture d'état / raison d'échec explicite / prochaine action évidente.
> `C3.2` livre : journal d'exécution utile / lecture rapide du dernier état connu.
>
> Ces périmètres se chevauchent.
>
> **Règle à fixer maintenant :**
> - C1.4 = état d'un run **en cours** (temps réel, un seul run).
> - C3.2 = historique **multi-runs dans le temps** (post-mortem, comparaison sur N runs).
>
> Sans cette distinction posée par écrit, Claude va soit dupliquer C1.4, soit l'étendre au-delà de son scope.

À produire :

- journal d'exécution utile,
- rattachement clair aux artefacts de sortie,
- lecture rapide du dernier état connu.

#### C3.3 — Reprise / relance propre

But : éviter le bricolage manuel.

> ⚠️ **ANGLE MORT — Le retry est orphelin entre trois lots.**
>
> `C1.3` : "reprise / relance maîtrisée."
> `C1.4` : "prochaine action évidente."
> `C3.3` : "règles de retry explicites / reprise bornée selon l'état courant."
>
> Trois endroits touchent au retry sans qu'aucun soit propriétaire.
>
> **Décision à trancher maintenant** (avant de coder C1.3) :
> - **Option A :** C1.3 livre le retry pour un run simple (une cible). C3.3 généralise (multi-cibles, borné, abandon après N tentatives).
> - **Option B :** Tout le retry va dans C3.3. C1.3 s'arrête à "état persisté proprement".
>
> L'option A est recommandée : C1.3 reste court et prouvable, C3.3 consolide.
> Mais ne pas laisser cette décision flotter — elle génère de la dette de scope.

À produire :

- règles de retry explicites,
- reprise bornée selon l'état courant,
- résultats de relance non ambigus.

### Critère de succès

- l'opérateur sait lire l'état exact d'un run,
- la raison d'échec est explicite,
- la prochaine action est évidente,
- un retry ne réintroduit pas de dette cachée.

---

## C4 — Boucle de feedback produit / optimisation pilotée par la réalité

> ⚠️ **ANGLE MORT — Le critère d'entrée dans C4 n'est pas opérationnel.**
>
> La règle actuelle : "ouvrir C4 seulement quand la matière réelle publiée existe."
> Mais cette condition est **déjà partiellement remplie** : TikTok sandbox réel (`publishId` réel), YouTube Shorts réel (`videoId k5w9lzyGJn8`).
>
> La vraie question est : combien de publications issues du **pipeline canonique complet** doivent exister ?
> - 1 seule suffit-elle à définir le contrat de retour ?
> - Ou faut-il N runs pour avoir des données utiles ?
>
> **Critère recommandé :**
> C4 s'ouvre quand C1 + C2 ont produit au moins **3 publications réelles traçables** depuis le run canonique, avec un `publish-manifest.json SUCCESS` archivé par run.

### But

Faire en sorte que la publication réelle ne soit plus la fin du pipeline, mais le début d'une **boucle d'apprentissage produit**.

### Pourquoi ce chantier est pertinent

Une chaîne audio-first mature ne doit pas seulement produire et publier ; elle doit aussi apprendre de ce qui a été réellement diffusé.

Sans `C4`, on a :

- une bonne fabrication,
- une bonne publication,
- mais pas encore de boucle de progrès structurée.

### Cible

La cible de `C4` est :

> une **boucle de feedback exploitable**, où les sorties réelles, leurs identifiants, leurs statuts et leurs résultats nourrissent l'amélioration future du produit.

### Inclus

- récupération des identifiants finaux de publication,
- rapprochement entre run et sortie réelle,
- métadonnées de retour exploitables,
- base minimale pour optimiser templates / prompts / montage plus tard.

### Exclus pour l'instant

- scoring marketing sophistiqué,
- recommandation automatique par IA,
- boucle d'optimisation temps réel,
- A/B testing avancé multi-plateformes.

### Découpage recommandé

#### C4.1 — Captation du retour réel

But : sauvegarder les informations qui décrivent la sortie réellement publiée.

> ⚠️ **ANGLE MORT — C4.1 est partiellement déjà livré.**
>
> `publish-manifest.json` contient déjà : `status: SUCCESS`, `publishId` TikTok, `videoId` YouTube.
> La captation par run existe. Ce qui manque c'est la **persistance structurée dans le temps**.
>
> Aujourd'hui les manifests sont isolés par run, pas indexés globalement.
>
> **Ce que C4.1 doit réellement livrer :** un index global des publications réelles (pas juste un manifest par run), avec rattachement au run canonique source.
>
> Sans ça, C4.2 (comparaison run ↔ sortie réelle) n'a rien à comparer sur la durée.

À produire :

- IDs / URLs / timestamps utiles,
- rattachement clair au run source,
- contrat de persistance du retour réel.

#### C4.2 — Lecture comparative run ↔ sortie réelle

But : rendre visible ce qui a été produit versus ce qui a été effectivement diffusé.

> ⚠️ **ANGLE MORT — La comparaison suppose une durée, pas un instantané.**
>
> Aujourd'hui un run produit une preview et un paquet de publication. La "sortie réelle" est dans le même run — la comparaison intra-run est triviale.
>
> La valeur de C4.2 n'apparaît que si on compare **N runs sur une période** :
> - Quel taux de publication réelle vs runs créés ?
> - Quel délai entre run et publication effective ?
> - Quels écarts entre preview et publication finale ?
>
> C4.2 doit être une comparaison **temporelle multi-runs**, pas un audit post-hoc d'un run unique.
> Sinon on redéveloppe ce que C1.4 (contrôle opérateur) fait déjà.

À produire :

- rapprochement simple entre preview, paquet de publication et sortie finale,
- écarts visibles et explicites.

#### C4.3 — Base d'optimisation future

But : préparer le terrain pour une amélioration produit pilotée par le réel.

> ⚠️ **ANGLE MORT — C4.3 est le lot le plus vague du document entier.**
>
> "Données minimales réutilisables" et "points d'accroche pour itérations futures" ne donnent aucune prise à Claude.
> Ce lot risque de devenir une fourre-tout ou un méta-chantier sans livrable clair.
>
> Pour que C4.3 soit pilotable, **nommer les leviers candidats** :
> - Prompts de génération (pour améliorer le script audio) ?
> - Templates de montage (pour améliorer la vidéo) ?
> - Paramètres TTS (voix, débit, émotion) ?
> - Durée / format / accroche (pour améliorer la rétention) ?
>
> **Recommandation : réserver C4.3 après C4.1 + C4.2.** Sa définition émergera naturellement des premières données réelles.
> Ne pas spécifier C4.3 maintenant — spécifier maintenant c'est inventer des besoins sans données.

À produire :

- données minimales réutilisables,
- points d'accroche pour itérations futures,
- zéro ambiguïté sur la provenance des signaux.

### Critère de succès

- la publication finale nourrit un historique exploitable,
- on peut rattacher un résultat réel à son run canonique,
- le produit dispose d'une base claire pour s'améliorer sans repartir de zéro.

---

## Ordre recommandé après `C1`

1. `C2` — Distribution multi-cibles propre  
2. `C3` — Exploitation robuste / reprise / observabilité  
3. `C4` — Feedback produit / optimisation

> ⚠️ **ANGLE MORT SUR L'ORDRE — C3 est plus mûr que C2.**
>
> L'ordre C2 → C3 → C4 tient en lecture produit.
> Mais en réalité, `12A/12B/12C` ont posé ~80% de l'infrastructure de C3.
>
> **C3 n'est pas un chantier à construire — c'est une consolidation de l'existant.**
>
> Deux options valides :
> - **Option A (comme écrit) :** C2 d'abord pour tester le contrat multi-cibles. C3 consolide ensuite sur une base multi-cibles.
> - **Option B :** Identifier les gaps réels de C3 (cf. inventaire 12A/12B/12C) pendant C1. Certains gaps C3 bloquent-ils C2 ? Si oui, inverser.
>
> La décision dépend d'une question concrète : est-ce que les gaps réels de C3 bloquent le lancement de C2 ?
> **À valider par l'opérateur avant ouverture de C2.**

### Règle stricte

Ne pas ouvrir `C2`, `C3` ou `C4` tant que `C1` n'a pas atteint un niveau jugé suffisamment opérable.

> ⚠️ **ANGLE MORT — "Suffisamment opérable" n'est pas défini.**
>
> `C1` a 4 lots. Les 4 doivent-ils être validés avant d'ouvrir C2 ?
>
> **Critère recommandé :** C2 peut s'ouvrir quand **C1.1 + C1.2 + C1.3 sont validés**.
> C1.4 (contrôle opérateur) peut se terminer en parallèle de C2.1 (contrat de destination) sans conflit de scope, à condition que C1.4 reste borné à "lecture d'état d'un run en cours" et ne glisse pas vers l'historique multi-runs (qui appartient à C3.2).

Autrement dit :

- `C1` d'abord en profondeur,
- `C2` ensuite,
- `C3` ensuite,
- `C4` seulement quand la matière réelle publiée existe.

---

## Ce qu'il ne faut pas faire

- ouvrir plusieurs chantiers à la fois,
- transformer `C2` en gros refacto plateforme,
- transformer `C3` en dashboard avant d'avoir un bon modèle d'état,
- transformer `C4` en chantier analytics prématuré,
- rebasculer dans les lots audio V2 scène par scène.
- **reconstruire en C2/C3 ce que `11B/12A/12B/12C` ont déjà livré,**
- **laisser le retry ownership flotter entre C1.3, C1.4 et C3.3 sans décision explicite,**
- **ouvrir C4.3 sans au moins 3 publications réelles traçables archivées.**

---

## Décision opérationnelle immédiate

- `A1 → B8` : **clos**  
- `C1` : **ouvert**  
- `C2 / C3 / C4` : **cadrés mais non ouverts**  
- seul lot à lancer maintenant : **`C1.1`**

---

## Prompt à coller dans Claude

> Référence roadmap post-`C1` : `C2`, `C3`, `C4` sont cadrés mais **non ouverts**.
>
> Tu ne dois pas partir sur `C2`, `C3` ou `C4` maintenant.
>
> Ton travail immédiat reste borné à `C1.1`.
>
> Garde en tête la suite :
> - `C2` = distribution multi-cibles pilotée par un contrat unique,
> - `C3` = exploitation robuste / reprise / observabilité,
> - `C4` = boucle de feedback produit.
>
> Mais tu n'en implémentes aucun tant que `C1` n'est pas validé lot par lot.
>
> Si tu fais référence à la suite, ce doit être uniquement pour montrer que tu respectes la trajectoire long terme, pas pour élargir le scope.
>
> **Rappels critiques :**
> - `C2` doit s'appuyer sur les publishers existants (`TikTokPublisher`, `YouTubeShortsPublisher`, `publish-manifest.json`). Ne pas les reconstruire.
> - `C3` est partiellement livré (`12A/12B/12C`, `367/367` tests). Inventorier les vrais gaps avant de coder.
> - Le retry ownership doit être tranché avant de coder C1.3 / C3.3 (voir Option A dans les annotations C3.3).
> - `C4` ne s'ouvre que sur 3 publications réelles traçables depuis le run canonique.

---

## Audit superviseur hostile — 26 avril 2026

> **Branche auditée :** `feat/python-media-precision`
> **Commit tête relu :** `098195c`
> **Périmètre relu :** `publish-package`, `preflight`, `publish-control`, `factory`, routes `publish` / `retry` / `preflight`

### Verdict

`C1` est **cohérent en structure** mais **pas encore fermé côté gouvernance réelle du flux principal**. Le squelette est bon : package canonique, preflight, retry, contrôle opérateur, manifest multi-plateforme. En revanche, la première publication ne consomme toujours pas le paquet canonique, le retry perd une partie de sa traçabilité dans le manifest, et plusieurs morceaux restent câblés TikTok-only.

### Gardé

- `step-8-publish.ts` : produit bien `metadata.json` + `publish-package.json` dans le `storagePath` du run.
- `publish-package.ts` : lecture/écriture cohérentes avec `final/` du run, sans retour au `process.cwd()` implicite.
- `preflight.ts` : checks lisibles, décision `nextAction` propre, structure exploitable.
- `retry/route.ts` : fallback propre, lecture du package canonique, `retryCount` incrémenté par plateforme.
- `factory.ts` : `upsertPublishManifest` additif par plateforme, stockage cohérent, `readPublishManifest` utile pour la suite.
- `publish-control.ts` : meilleur qu’avant, car il sait lire l’état d’une plateforme via le manifest et évite une partie des healthchecks inutiles.

### Rejeté

1. **Le flux principal contourne encore C1.1.**
	`POST /publish` lit `preview-manifest.json` + `metadata.json` directement et ne passe pas par `readPublishPackage()`. Le package canonique existe, mais il ne gouverne toujours pas la première publication.

2. **La traçabilité retry reste incomplète.**
	`retry/route.ts` persiste `resultWithRetry` dans `publish-result.json`, mais envoie encore `result` à `upsertPublishManifest(...)`. Le manifest perd donc `retryCount` et diverge du dernier résultat.

3. **La source de vérité de `PublishStatus` reste dupliquée.**
	`tiktok.ts` redéclare `PublishStatus` alors que `platform-types.ts` l’expose déjà comme source unique. C’est une dette de divergence gratuite.

### 6 angles morts

1. **Preflight TikTok-only sur les credentials.**
	`preflight.ts` ne vérifie les credentials que si `platform === 'tiktok'`. Un dry-run `youtube_shorts` peut donc sortir `ready=true` sans validation provider.

2. **Contrôle opérateur encore orienté TikTok.**
	`publish-control.ts` et `GET /publish` exposent `platformHealth.tiktok` et des labels en dur côté TikTok, même quand on demande `youtube_shorts`.

3. **`publish-result.json` reste mono-fichier.**
	Deux publications sur deux plateformes écrasent le dernier résultat global dans `final/publish-result.json`. Le manifest garde l’historique par plateforme, mais pas le “last result” détaillé.

4. **Compat rétro qui fige une mauvaise forme d’API.**
	`GET /publish` aplatit encore `lastResult` dans la réponse. Ça aide les consommateurs legacy, mais ça encourage aussi à dépendre d’une forme transitoire au lieu du vrai `PublishControl`.

5. **`instagram_reels` est annoncé sans être pilotable.**
	Le package canonique et `step-8-publish.ts` exposent encore `instagram_reels`, alors que `PublishPlatform` et le factory ne le supportent pas. Ce n’est pas cassant, mais c’est trompeur pour l’opérateur et pour Claude.

6. **Pas de test bout-en-bout publication réelle simulée.**
	Les tests couvrent bien les briques, mais pas une chaîne complète du type `preflight -> publish -> manifest/result/control -> retry`. La robustesse perçue reste donc supérieure à la robustesse démontrée.

### Prochain lot ultra minimal

**But : rendre C1.1 réellement gouvernant sur le flux principal, sans ouvrir C2/C3/C4.**

3 corrections, ~30 lignes, zéro refacto diffus :

1. **Faire lire `publish-package.json` par `POST /publish` avant le fallback preview/metadata.**
	Fichier : `app/src/app/api/runs/[id]/publish/route.ts`
	Gain : la première publication suit enfin le paquet canonique C1.1.

2. **Passer `resultWithRetry` à `upsertPublishManifest(...)` dans le retry.**
	Fichier : `app/src/app/api/runs/[id]/publish/retry/route.ts`
	Gain : `publish-result.json` et `publish-manifest.json` racontent la même histoire.

3. **Supprimer la redéclaration locale de `PublishStatus` dans `tiktok.ts`.**
	Fichier : `app/src/lib/publishers/tiktok.ts`
	Gain : une seule source de vérité type pour les statuts publication.

> Ce lot est volontairement minuscule : il ne traite ni le multi-provider de preflight, ni l’API de contrôle, ni le cas `instagram_reels`.
> Il ferme d’abord le plus gros mensonge actuel : “on a un paquet canonique”, sans que le flux principal s’en serve.

---

## Phrase de pilotage

> `C1` prouve que l'audio canonique gouverne la sortie réelle.  
> `C2` étend cette sortie à plusieurs destinations.  
> `C3` rend l'exploitation robuste.  
> `C4` transforme la publication en boucle d'apprentissage produit.
