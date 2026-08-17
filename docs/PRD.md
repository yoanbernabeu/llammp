# PRD — Client « Winamp » pour macOS pilotant Apple Music

**Nom de code :** Llama (référence au « Winamp, it really whips the llama's ass »)
**Version du document :** 1.0
**Destinataire :** agent de développement
**Plateforme cible :** macOS 14.2+ (Apple Silicon et Intel)

> **Note d'archivage.** Ce document est le PRD d'origine, restitué le 17 août 2026 après
> avoir été absent du dépôt pendant M0 et le début de l'implémentation. Il fait autorité.
> Les écarts entre ce PRD et le code existant sont recensés dans `ECARTS-PRD.md`.
> Les amendements issus des spikes (F3.4 notamment) sont dans `SPEC-V1.md`.

---

## 1. Objectif

Construire une application macOS native (packagée) qui reproduit l'apparence et l'ergonomie de Winamp 2.x, mais dont le moteur de lecture est **l'application Musique d'Apple** (`com.apple.Music`). L'application ne lit aucun son elle-même : elle pilote Music.app à distance et en reflète l'état.

Deux exigences produit non négociables :

1. **Fidélité visuelle.** Rendu pixel-perfect, support des skins `.wsz` d'origine, scaling nearest-neighbor. Un skin Winamp 2 téléchargé en 2001 doit s'afficher correctement.
2. **Visualiseur réactif.** Analyseur de spectre synchronisé avec le son réellement émis par Music.app.

### Non-objectifs (hors périmètre v1)

- Lecture de fichiers audio locaux ou de tout format hors Apple Music.
- Support Windows ou Linux.
- Visualisations Milkdrop / Butterchurn (candidat v2).
- Modification de la bibliothèque Apple Music (création/suppression de playlists, notes, etc.).
- Toute forme de contournement du DRM ou d'extraction de flux audio.

---

## 2. Stack imposée

Ces choix sont arrêtés. Ne pas les rediscuter sans validation explicite.

| Composant | Technologie | Justification |
|---|---|---|
| Shell applicatif | **Electron ≥ 39** | Version minimale où Chromium utilise l'API Core Audio Tap par défaut pour la capture audio bureau. En dessous, il faut des flags Chromium internes. |
| Langage | **TypeScript**, mode `strict` | — |
| UI | Fork de **Webamp** (MIT, captbaritone) | Parsing `.wsz`, découpage des sprites, gestion des fenêtres et de la police bitmap déjà résolus. |
| Pont Music.app | **Sidecar Swift** (binaire universel) | Les notifications distribuées et ScriptingBridge sont inaccessibles depuis Node. |
| Packaging | **electron-builder** | Signature Developer ID + notarisation. |
| Distribution | **Hors Mac App Store** | L'App Sandbox bloque la réception des notifications distribuées d'autres processus. L'application ne doit **pas** être sandboxée. |

---

## 3. Architecture

Trois sous-systèmes indépendants, à développer et tester séparément.

```
┌─────────────────────────────────────────────────────┐
│  Renderer (TypeScript / React — fork Webamp)        │
│  · Rendu du skin, fenêtres, interactions            │
│  · AnalyserNode → visualiseur                       │
└───────────────┬─────────────────┬───────────────────┘
                │ IPC             │ MediaStream
┌───────────────┴─────────────┐   │
│  Main process (Electron)    │   │  loopback système
│  · Spawn + supervision      │   │  (Chromium/CoreAudio Tap)
│    du sidecar               │   │
│  · Routage des commandes    │   │
└───────────────┬─────────────┘   │
                │ stdin/stdout JSONL
┌───────────────┴─────────────┐   │
│  music-bridge (Swift)       │   │
│  · ScriptingBridge          │   │
│  · DistributedNotification  │   │
└───────────────┬─────────────┘   │
                │ Apple Events    │
        ┌───────┴─────────────────┴───┐
        │        Music.app            │
        └─────────────────────────────┘
```

Point d'architecture important : le son ne transite **pas** par le sidecar. Le visualiseur écoute la sortie système via Chromium, indépendamment du canal de contrôle.

---

## 4. Contrat d'interface du sidecar

Le binaire `music-bridge` communique en **JSON Lines** (un objet JSON par ligne, terminé par `\n`). Ce contrat est normatif : le respecter permet de développer les deux côtés en parallèle.

### 4.1 Événements émis (stdout)

```jsonc
// Piste courante — émis à chaque changement de piste et au démarrage
{"type":"track","name":"Windowlicker","artist":"Aphex Twin","album":"Windowlicker",
 "durationMs":366000,"persistentId":"A1B2C3D4E5F6","trackNumber":1,"year":1999}

// Changement d'état de lecture
{"type":"state","state":"playing"}          // playing | paused | stopped

// Position de lecture — émis toutes les 250 ms uniquement si state == playing
{"type":"position","positionMs":45210}

// Volume système de Music.app (0–100)
{"type":"volume","volume":75}

// Pochette — émis en réponse à getArtwork uniquement
{"type":"artwork","persistentId":"A1B2C3D4E5F6","mime":"image/jpeg","dataBase64":"/9j/4AAQ..."}

// Disponibilité de Music.app
{"type":"availability","running":false}

// Permissions
{"type":"permission","appleEvents":"granted"}   // granted | denied | undetermined

// Erreur
{"type":"error","code":"APPLE_EVENT_FAILED","message":"..."}
```

### 4.2 Commandes reçues (stdin)

```jsonc
{"cmd":"playpause"}
{"cmd":"next"}
{"cmd":"previous"}
{"cmd":"stop"}
{"cmd":"seek","positionMs":60000}
{"cmd":"setVolume","volume":75}
{"cmd":"getArtwork","persistentId":"A1B2C3D4E5F6"}
{"cmd":"refresh"}        // force la réémission de l'état complet
{"cmd":"quit"}
```

### 4.3 Règles de comportement du sidecar

- **Ne jamais lancer Music.app.** Vérifier `NSRunningApplication.runningApplications(withBundleIdentifier:)` avant tout accès à une propriété ScriptingBridge. Un accès sur une app fermée la démarre — comportement inacceptable.
- Si Music.app n'est pas lancée : émettre `availability` avec `running: false` et n'émettre aucun `track`/`position`.
- S'abonner à la notification distribuée `com.apple.Music.playerInfo` plutôt que de poller. Clés `userInfo` utiles : `Name`, `Artist`, `Album`, `Player State`, `Total Time` (ms), `PersistentID`, `Track Number`, `Genre`, `Store URL`.
- Poller `playerPosition` via ScriptingBridge à 250 ms, **et uniquement pendant la lecture**.
- Vérifier l'autorisation d'automatisation avec `AEDeterminePermissionToAutomateTarget` au démarrage et émettre l'événement `permission` avant toute autre chose.
- Les pochettes sont coûteuses à récupérer : ne jamais les émettre spontanément, uniquement sur `getArtwork`. Le main process est responsable du cache par `persistentId`.
- Sortir proprement sur `quit` ou sur fermeture de stdin.

---

## 5. Spécifications fonctionnelles

Chaque exigence porte un identifiant. Les critères d'acceptation sont vérifiables manuellement.

### F1 — Fenêtre principale

Fenêtre sans cadre, transparente, dimensions de base **275 × 116 px**, déplaçable par n'importe quelle zone non interactive.

- **F1.1** Mode double taille (2x) via menu contextuel, en nearest-neighbor (`image-rendering: pixelated`). Aucun flou.
- **F1.2** Mode « shade » (barre de titre seule, 275 × 14 px).
- **F1.3** Toggle « toujours au premier plan ».
- **F1.4** Position et taille persistées entre les lancements.
- **F1.5** Menu contextuel au clic droit sur la barre de titre.

*Acceptation :* au redémarrage, la fenêtre réapparaît exactement où elle était, dans le même mode d'affichage.

### F2 — Transport

- **F2.1** Boutons précédent / lecture / pause / stop / suivant, câblés sur les commandes du sidecar.
- **F2.2** Barre de position (`posbar`) draggable déclenchant un `seek` au relâchement, pas pendant le drag.
- **F2.3** Slider de volume mappé sur 0–100 vers `setVolume`.
- **F2.4** Le slider de balance est **présent visuellement mais inactif** — l'interface de scripting de Music.app ne l'expose pas. Curseur centré, non draggable, tooltip explicatif.

*Acceptation :* une action sur les boutons se reflète dans Music.app en moins de 300 ms ; inversement, une action dans Music.app se reflète dans l'UI en moins de 300 ms.

### F3 — Affichage d'état

- **F3.1** Marquee défilant : `Artiste - Titre`, avec la mise en forme et la police bitmap Winamp.
- **F3.2** Compteur de temps, bascule écoulé / restant au clic. Affichage `-MM:SS` en mode restant.
- **F3.3** Indicateur de statut (lecture / pause / stop) via les sprites correspondants.
- **F3.4** Les zones kbps et kHz affichent des valeurs fixes plausibles ou restent vides : ces métadonnées ne sont pas exposées. Ne pas inventer de valeurs variables.
- **F3.5** Écran vide et compteur à `00:00` quand Music.app n'est pas lancée.

### F4 — Visualiseur

- **F4.1** Capture du son système via `setDisplayMediaRequestHandler` avec `audio: 'loopback'` côté main process **et** `getDisplayMedia({audio: true, video: {...}})` côté renderer. Les deux moitiés sont obligatoires ; `audio: true` seul produit une piste silencieuse.
- **F4.2** La piste vidéo demandée (1×1) doit être stoppée immédiatement après obtention du stream.
- **F4.3** `MediaStreamSource` → `AnalyserNode` → rendu canvas à 60 fps.
- **F4.4** Deux modes, alternés au clic sur la zone : analyseur de spectre et oscilloscope.
- **F4.5** Palette lue depuis `viscolor.txt` du skin actif (24 couleurs).
- **F4.6** Décroissance des barres avec lissage exponentiel et « peak caps » tombant lentement, conformément au comportement d'origine.
- **F4.7** Le visualiseur se met en pause (rendu figé, capture suspendue) quand `state != playing`, pour ne pas consommer inutilement.

*Acceptation :* le spectre réagit visiblement et sans latence perceptible au son de Music.app ; il ne réagit pas quand Music.app est en pause même si un autre son joue.

> ⚠️ Le premier appel déclenche une demande d'autorisation système. Prévoir un écran d'explication avant, et un état dégradé propre (visualiseur noir + message) si l'utilisateur refuse.

### F5 — Skins

- **F5.1** Chargement d'un `.wsz` par glisser-déposer sur la fenêtre et via le menu.
- **F5.2** Skin par défaut embarqué (base 2.9).
- **F5.3** Skin sélectionné persisté.
- **F5.4** Un `.wsz` malformé ou incomplet ne crashe pas l'application : fallback sur les sprites du skin par défaut pour les fichiers manquants, message d'erreur non bloquant.
- **F5.5** Support de `region.txt` pour les formes de fenêtre non rectangulaires.

### F6 — Robustesse

- **F6.1** Si le sidecar meurt, le main process le relance (backoff exponentiel, 5 tentatives max, puis état d'erreur visible dans l'UI).
- **F6.2** Music.app lancée ou quittée en cours de route : transition d'état propre dans les deux sens, sans redémarrage nécessaire.
- **F6.3** Autorisation d'automatisation refusée : panneau explicatif avec un bouton ouvrant directement Réglages Système → Confidentialité et sécurité → Automatisation. Ne pas échouer silencieusement.

---

## 6. Permissions, signature, packaging

Chaque élément manquant provoque un **échec silencieux**. À traiter comme un bloc.

**Info.plist** (via `extendInfo` d'electron-builder)
- `NSAppleEventsUsageDescription` — texte utilisateur expliquant le pilotage de Musique.
- `NSAudioCaptureUsageDescription` — texte utilisateur expliquant le visualiseur.

**Entitlements**
- `com.apple.security.automation.apple-events` = `true`
- `com.apple.security.cs.disable-library-validation` = `true` (nécessaire pour le sidecar embarqué)
- **Pas** de `com.apple.security.app-sandbox`

**Build**
- Hardened Runtime activé, signature Developer ID, notarisation, stapling.
- Sidecar compilé en binaire universel (`arm64` + `x86_64`), signé séparément, placé dans `Contents/Resources/` et référencé via `extraResources`.
- DMG signé.

> **Règle de test :** toute validation de comportement lié aux permissions se fait exclusivement sur un build signé et notarisé. `electron .` en développement se comporte différemment et donnera de faux positifs comme de faux négatifs.

---

## 7. Jalons

**M0 — Spikes de faisabilité** *(à livrer avant tout code de production)*

Deux inconnues à lever, chacune par un prototype jetable et un compte-rendu écrit :

1. **File d'attente.** Quelles informations de queue Music.app expose-t-elle réellement via ScriptingBridge (`current playlist`, pistes suivantes) ? La réponse détermine si la fenêtre Playlist est faisable en v1 ou reportée. *Ne pas commencer la fenêtre Playlist avant ce verdict.*
2. **Égaliseur.** Music.app expose-t-elle les presets EQ et leurs bandes individuelles en écriture ? Si oui, la fenêtre EQ devient une feature v1 ; sinon elle est décorative et désactivée, comme la balance.

**M1 — Sidecar + pont IPC.** Binaire Swift conforme au §4, main process qui le supervise, UI de debug textuelle. Aucun skin.
**M2 — UI skinnable + transport.** F1, F2, F3, F5.
**M3 — Visualiseur.** F4.
**M4 — Packaging signé et notarisé.** §6, plus F6.3.
**M5 — Robustesse et finition.** F6 complet, gestion des cas limites.

---

## 8. Pièges connus

Consigner ici tout nouveau piège découvert.

| Piège | Symptôme | Parade |
|---|---|---|
| `audio: true` sans handler main process | Piste audio de silence pur, DSP « cassé » | Les deux moitiés du §F4.1 |
| Accès ScriptingBridge sur app fermée | Music.app se lance toute seule | Vérifier `isRunning` avant chaque accès |
| App sandboxée | Aucune notification distribuée reçue, sans erreur | Ne pas sandboxer |
| Test en mode dev | Comportement de permissions divergent | Tester sur build signé |
| `AVAudioEngine` sur agrégat CATap | Retourne `noErr` mais lit la mauvaise entrée | Non applicable ici (Chromium gère), mais à connaître si l'on abandonne le loopback |
| Pistes streamées du catalogue | `persistentId` et pochette se comportent différemment des fichiers de bibliothèque ; seek parfois restreint | Modéliser le cas dès le départ, ne pas rustiner |
| Pochettes via Apple Events | Lenteur perceptible si demandées en boucle | Cache par `persistentId` dans le main process |

---

## 9. Cadre légal

- **Webamp** est sous licence MIT : fork autorisé, conserver la notice de copyright et créditer.
- **Le code source de Winamp** publié en 2024 est sous licence restrictive. Il ne doit être ni lu ni copié pour ce projet. Toute reproduction de comportement se fait par observation du logiciel, pas de son code.
- **Les skins `.wsz`** sont des œuvres tierces. N'en embarquer aucun sans autorisation, à l'exception du skin de base si sa licence le permet — à vérifier avant M2. À défaut, produire un skin par défaut original respectant le format.
- **Aucune extraction, aucun contournement de DRM.** L'application pilote et observe ; elle ne touche jamais au flux audio d'Apple Music autrement que par la capture système, qui est une API publique soumise au consentement de l'utilisateur.
- Ne pas utiliser les marques Winamp ou Apple Music dans le nom ou l'icône du produit distribué.

---

## 10. Définition de « terminé »

L'application est livrable quand, sur un build signé et notarisé, installé sur une machine vierge :

1. Le premier lancement demande les deux autorisations avec des explications claires, et l'application fonctionne en mode dégradé cohérent si l'une est refusée.
2. Les cinq boutons de transport, la barre de position et le volume pilotent Music.app de façon fiable.
3. Toute action effectuée directement dans Music.app se reflète dans l'UI en moins de 300 ms.
4. Le visualiseur réagit au son avec une latence imperceptible.
5. Au moins trois skins `.wsz` tiers différents se chargent et s'affichent correctement.
6. Music.app peut être lancée et quittée à volonté sans jamais mettre l'application dans un état incohérent.
7. Aucune fuite mémoire mesurable après une heure de lecture continue.
