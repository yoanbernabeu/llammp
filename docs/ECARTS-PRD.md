# Écarts entre le code existant et le PRD

**Date :** 17 août 2026
**Contexte :** le PRD (`PRD.md`) était absent du dépôt pendant M0 et l'implémentation
initiale. Le travail s'est appuyé sur `SPEC-V1.md`, une reconstruction faite à partir des
deux rapports de spike. Le PRD ayant été restitué, ce document recense les divergences.

**Lecture :** 🔴 écart structurant (arbitrage requis) · 🟠 écart à corriger · 🟢 conforme
ou meilleur.

---

## 1. Stack imposée (PRD §2) — « Ne pas les rediscuter sans validation explicite »

| Composant | PRD | Existant | |
|---|---|---|---|
| Shell | Electron ≥ 39 | Electron 43.4.0 | 🟢 |
| **Langage** | **TypeScript strict** | **JavaScript** | 🔴 |
| **UI** | **Fork de Webamp** | **Moteur de skin écrit de zéro** | 🔴 |
| Pont Music.app | Sidecar Swift | Sidecar Swift | 🟢 |
| — dont API | **ScriptingBridge** | **NSAppleScript pré-compilé** | 🔴 |
| — dont binaire | **universel** (arm64+x86_64) | **arm64 seul** | 🟠 |
| **Packaging** | **electron-builder** | **@electron/packager** | 🟠 |
| Hors MAS, non sandboxé | oui | oui | 🟢 |

### 1.1 — TypeScript 🔴

Tout le code applicatif est en JavaScript. Aucun `tsconfig`, aucun typage. Le contrat IPC,
qui est précisément l'endroit où le typage paie, n'est pas typé.

**Coût de mise en conformité :** modéré. ~1400 lignes à convertir, sans restructuration —
le découpage en modules est déjà propre. Les types du contrat §4 sont à écrire une fois et
partagés main/renderer.

### 1.2 — Fork de Webamp 🔴

Le PRD impose de forker Webamp, qui résout déjà « parsing `.wsz`, découpage des sprites,
gestion des fenêtres et de la police bitmap ». Un moteur indépendant a été écrit :
`skin/loader.js` (décompression, VISCOLOR/PLEDIT/REGION) et `renderer/sprites.js`
(coordonnées des sprites), plus le rendu canvas des trois fenêtres.

**Ce que ça a coûté** — deux bugs que Webamp n'aurait pas eus :
- table de la police bitmap fausse (une case vide non repérée après l'ellipsis décalait
  tout : `-` s'affichait `)`) ;
- sprites `mono`/`stereo` inversés.
Les deux ont été trouvés par vérification visuelle et corrigés.

**Ce que ça a apporté** — aucune dépendance à un fork à maintenir, et un rendu vérifié sur
4 skins hétérogènes (base-2.91, TopazAmp, MacOSXAqua, Zaxon).

**Coût de mise en conformité :** élevé. Forker Webamp revient à jeter `sprites.js`,
`app.js`, `playlist.js`, `eq.js` et `skin/loader.js`, puis à brancher le sidecar dans
l'architecture Redux de Webamp — dont le modèle est un lecteur autonome, pas une
télécommande.

### 1.3 — ScriptingBridge 🔴

Le PRD impose ScriptingBridge ; le sidecar utilise `NSAppleScript` pré-compilé.

**Raison :** `sdef`/`sdp` sont indisponibles sur cette machine (Command Line Tools seuls,
constaté en M0 §1), donc l'en-tête typé de ScriptingBridge ne peut pas être généré.
Contournement possible en déclarant des protocoles `@objc` à la main.

**Mesure à l'appui :** `NSAppleScript` pré-compilé coûte **0,75 ms** pour `player position`
et **1,75 ms** pour l'état complet, dans un process persistant. Le polling à 250 ms
consomme donc ~0,3 % CPU. L'écart de performance avec ScriptingBridge est sans effet
observable.

**Réserve honnête :** le PRD §4.3 formule ses règles en termes ScriptingBridge
(`AEDeterminePermissionToAutomateTarget`, accès aux propriétés). Ces règles sont
respectées dans leur intention, par d'autres moyens.

---

## 2. Contrat IPC (PRD §4) — « Ce contrat est normatif » 🔴

Le contrat implémenté diverge du contrat normatif sur presque tous les messages.

### 2.1 — Événements

| PRD | Implémenté | Écart |
|---|---|---|
| `{"type":"track", "durationMs":366000, "trackNumber", "year"}` | `{"type":"track", "duration": 366.0, …}` | unités (**ms → s**), `trackNumber` et `year` absents, champs en trop (`kind`, `streaming`, `bitRate`, `sampleRate`) |
| `{"type":"state","state":"playing"}` | `{"type":"state","playerState":…,"volume":…,"shuffle":…,"repeat":…,"muted":…}` | nom du champ, et **fusion** de `state` et `volume` |
| `{"type":"position","positionMs":45210}` | `{"type":"position","position":45.21}` | unités |
| `{"type":"volume","volume":75}` | *(fondu dans `state`)* | message absent |
| `{"type":"artwork","mime","dataBase64"}` | `{"type":"artwork","format","data"}` | noms de champs |
| `{"type":"availability","running":false}` | `{"type":"unavailable","reason":…}` | message entièrement différent |
| `{"type":"permission","appleEvents":"granted"}` | *(absent)* | **manquant** — remplacé par `unavailable/no_permission`, émis seulement après échec |
| `{"type":"error","code","message"}` | `{"type":"log","level","message"}` | pas de `code` |
| *(absent du PRD)* | `{"type":"queue",…}` | **ajout** — issu du verdict M0 §2, légitime mais à intégrer formellement |

### 2.2 — Commandes

Conformes : `playpause`, `next`, `previous`, `stop`, `setVolume`, `getArtwork`, `refresh`.
Écarts : `seek` prend `position` (secondes) au lieu de `positionMs` ; **`quit` n'est pas
implémenté** ; ajouts hors contrat (`play`, `pause`, `setShuffle`, `setRepeat`, `setMute`,
`playTrackAt`).

### 2.3 — Règles §4.3

| Règle | État |
|---|---|
| Ne jamais lancer Music.app, vérifier `NSRunningApplication` avant tout accès | 🟢 implémenté (`isMusicRunning`) |
| Ne pas poller, s'abonner à `com.apple.Music.playerInfo` | 🟢 + déduplication de la double notification (piège trouvé en M0) |
| Poller la position à 250 ms, uniquement pendant la lecture | 🟢 |
| **`AEDeterminePermissionToAutomateTarget` au démarrage, émettre `permission` avant tout** | 🔴 **non fait** — c'est la cause directe du blocage observé : le premier Apple Event fige le sidecar sur le dialogue macOS, sans rien émettre |
| Artwork jamais spontané, cache par `persistentId` dans le main process | 🟠 émis sur demande uniquement, mais **aucun cache** dans le main process |
| Sortie propre sur `quit` ou fermeture de stdin | 🟠 fermeture de stdin gérée, `quit` absent |

---

## 3. Fonctionnel (PRD §5)

### F1 — Fenêtre principale

| Réf | Exigence | État |
|---|---|---|
| — | 275×116, sans cadre, déplaçable | 🟢 |
| F1.1 | **Mode double taille (2x)** | 🔴 absent |
| F1.2 | **Mode shade (275×14)** | 🔴 absent (le bouton existe, sans effet) |
| F1.3 | **Toujours au premier plan** | 🔴 absent |
| F1.4 | **Position et mode persistés** | 🔴 absent |
| F1.5 | **Menu contextuel au clic droit** | 🔴 absent — le changement de skin a été mis sur le bouton menu, à la place |

### F2 — Transport

| Réf | Exigence | État |
|---|---|---|
| F2.1 | 5 boutons câblés | 🟢 |
| F2.2 | Seek au relâchement, pas pendant le drag | 🟢 |
| F2.3 | Volume 0–100 | 🟢 |
| F2.4 | Balance visible, inactive, centrée, **tooltip** | 🟠 inactive et centrée, **tooltip manquant** |
| — | *Acceptation : aller-retour < 300 ms* | ⚠️ **non mesuré** |

### F3 — Affichage

| Réf | Exigence | État |
|---|---|---|
| F3.1 | Marquee `Artiste - Titre`, police bitmap | 🟢 |
| F3.2 | **Bascule écoulé / restant au clic, `-MM:SS`** | 🔴 absent (écoulé seulement) |
| F3.3 | Indicateur play/pause/stop | 🟢 |
| F3.4 | kbps/kHz : valeurs fixes ou vides, ne rien inventer | 🟢 **dépassé** — M0 §4.1 a montré que `bit rate` et `sample rate` sont réellement exposés ; valeurs réelles affichées, zones vides en streaming |
| F3.5 | Écran vide, `00:00` si Music.app fermée | 🟢 |

### F4 — Visualiseur

| Réf | Exigence | État |
|---|---|---|
| F4.1 | Handler main + getDisplayMedia renderer | 🟢 |
| F4.2 | Piste vidéo stoppée immédiatement | 🟢 |
| F4.3 | AnalyserNode → canvas 60 fps | 🟢 |
| F4.4 | Deux modes alternés au clic | 🟢 (+ un mode « éteint ») |
| F4.5 | Palette `viscolor.txt` | 🟢 |
| F4.6 | **Peak caps et décroissance exponentielle** | 🔴 absent |
| F4.7 | **Pause du visualiseur quand `state != playing`** | 🔴 absent — tourne en continu |
| — | **Écran d'explication avant la demande d'autorisation** | 🔴 absent |

### F5 — Skins

| Réf | Exigence | État |
|---|---|---|
| F5.1 | **Glisser-déposer d'un `.wsz`** | 🔴 absent (cycle par bouton uniquement) |
| F5.2 | Skin par défaut embarqué | 🟢 (voir réserve légale §5) |
| F5.3 | **Skin persisté** | 🔴 absent |
| F5.4 | `.wsz` malformé : **fallback sur le skin par défaut**, message non bloquant | 🟠 un bitmap illisible est ignoré sans crash, mais **aucun fallback** ni message |
| F5.5 | **`region.txt` appliqué** | 🟠 parsé et transmis, **jamais appliqué** |

### F6 — Robustesse

| Réf | Exigence | État |
|---|---|---|
| F6.1 | **Relance du sidecar, backoff, 5 essais, état d'erreur** | 🔴 absent — la mort du sidecar est signalée, jamais réparée |
| F6.2 | Music.app lancée/quittée à chaud | 🟢 (`NSWorkspace`) |
| F6.3 | **Panneau + bouton vers Réglages Système** | 🔴 absent — seul un message dans le marquee |

---

## 4. Packaging (PRD §6)

| Exigence | État |
|---|---|
| `NSAppleEventsUsageDescription`, `NSAudioCaptureUsageDescription` | 🟢 |
| **Entitlements** (`automation.apple-events`, `disable-library-validation`) | 🔴 **aucun fichier d'entitlements** |
| Pas de sandbox | 🟢 |
| **Hardened Runtime, Developer ID, notarisation, stapling** | 🔴 absent — signature **ad-hoc** |
| **Sidecar universel, signé séparément, dans `Contents/Resources/`** | 🟠 arm64 seul, non signé séparément, dans `Resources/app.asar.unpacked/bin/` |
| **DMG signé** | 🔴 absent |

---

## 5. Cadre légal (PRD §9) — point le plus sérieux 🔴

> « Les skins `.wsz` sont des œuvres tierces. **N'en embarquer aucun sans autorisation**,
> à l'exception du skin de base si sa licence le permet — **à vérifier avant M2**. À défaut,
> produire un skin par défaut original respectant le format. »

**Ce qui a été fait :** six `.wsz` ont été téléchargés depuis le dépôt Webamp et placés dans
`assets/skins/`, puis **embarqués dans le bundle** via `--extra-resource`. Aucune
vérification de licence n'a précédé cette étape.

**Statut réel :** la licence MIT de Webamp couvre son **code**, pas les skins qu'il
distribue. `base-2.91.wsz` est le skin d'origine de Winamp (Nullsoft) ; les cinq autres
sont des créations d'auteurs tiers identifiés par leur nom de fichier. Rien n'indique
qu'ils soient redistribuables.

**Ce que le PRD prévoyait :** produire un skin par défaut **original** respectant le format.

**Aucune suppression n'a été faite unilatéralement** — la décision revient au porteur du
projet. Options : (a) retirer les skins tiers du dépôt et du packaging, en produire un
original ; (b) les conserver hors packaging, pour le développement local seul ; (c) vérifier
et documenter les autorisations.

**Conforme par ailleurs :** le code source de Winamp n'a été **ni lu ni copié** — les
coordonnées de sprites viennent de la connaissance du format et ont été **vérifiées par
observation des bitmaps** (agrandissement de `TEXT.BMP`, `MONOSTER.BMP`, `PLEDIT.BMP`,
`EQMAIN.BMP`). Le nom « Llammp » n'emprunte ni la marque Winamp ni Apple Music.

---

## 6. Jalons (PRD §7)

| Jalon | PRD | Réel |
|---|---|---|
| M0 | 2 spikes + comptes-rendus | 🟢 **fait**, plus le spike F4 non prévu et 2 risques ouverts levés |
| M1 | Sidecar conforme au §4, **supervision**, UI de debug | 🟠 sidecar fonctionnel mais **contrat divergent**, **pas de supervision** |
| M2 | F1, F2, F3, F5 | 🟠 le cœur fonctionne ; **11 exigences absentes** |
| M3 | F4 | 🟠 fonctionne dans son principe ; F4.6 et F4.7 absents ; **non validé avec signal réel** |
| M4 | Packaging signé et notarisé + F6.3 | 🔴 packagé mais **ad-hoc**, sans entitlements ni notarisation |
| M5 | F6 complet | 🔴 non commencé |

**Écart de séquencement :** la fenêtre Playlist et la fenêtre EQ ont été construites, alors
que le PRD ne les liste dans aucun jalon M1–M5. Elles découlent des verdicts M0 (§7 :
« la réponse détermine si la fenêtre Playlist est faisable en v1 »), mais leur place dans
le plan n'a jamais été formalisée.

---

## 7. Définition de « terminé » (PRD §10)

| # | Critère | État |
|---|---|---|
| 1 | Deux autorisations expliquées, mode dégradé cohérent | 🔴 pas d'écran d'explication |
| 2 | Transport, position, volume fiables | 🟠 codé, **non validé à la souris** |
| 3 | Music.app → UI en < 300 ms | ⚠️ **non mesuré** |
| 4 | Visualiseur sans latence perceptible | ⚠️ **non validé avec signal réel** |
| 5 | **3 skins tiers différents** se chargent | 🟢 4 vérifiés — mais voir la réserve légale §5 |
| 6 | Music.app lancée/quittée sans incohérence | 🟠 implémenté, non testé en conditions |
| 7 | Pas de fuite mémoire après 1 h | ⚠️ **non testé** |

**Conclusion : la V1 n'est pas livrable au sens du §10.** Ce qui existe est un socle
fonctionnel et vérifié visuellement, pas un produit fini.
