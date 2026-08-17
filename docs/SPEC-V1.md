# Llammp — Spécification V1

**Un client Winamp 2 pour macOS, qui pilote Apple Music.**

> ⚠️ **Document déclassé — le PRD a été retrouvé.**
>
> Cette spec a été écrite alors que le PRD était absent du dépôt ; elle le reconstituait à
> partir des rapports de spike. **`PRD.md` fait désormais autorité**, et les divergences
> sont recensées dans **`ECARTS-PRD.md`**.
>
> Ce document reste utile pour ce qu'il est seul à contenir : les **mesures** faites
> pendant l'implémentation (coût `NSAppleScript`, fenêtrage de playlist, comportement en
> shuffle) et les **amendements** issus des spikes. En cas de contradiction sur le
> périmètre, le contrat IPC ou la stack, **c'est le PRD qui l'emporte**.

---

## 1. Principe

Llammp n'est **pas** un lecteur audio. C'est une **télécommande fidèle** : Music.app
décode et joue, Llammp affiche et commande. Toute la valeur est dans la fidélité
visuelle au Winamp 2 de 1997 — pixel pour pixel, skins `.wsz` d'origine compris.

Conséquence directe : **aucune donnée n'est inventée.** Si Music.app n'expose pas une
valeur, la zone reste vide (règle héritée de M0 §4.1 sur les `URL track`).

---

## 2. Périmètre V1

### Retenu

| Réf | Fonction | Statut spike |
|---|---|---|
| **F1** | Fenêtre principale skinnée, 275×116, sans cadre, déplaçable | — |
| **F2.1** | Transport : play, pause, stop, précédent, suivant | ✅ validé M0 |
| **F2.2** | Barre de position : affichage **et** seek | ✅ `player position` en lecture/écriture |
| **F2.3** | Volume 0–100 | ✅ entier 0–100 |
| **F2.4** | Balance — **décorative**, non fonctionnelle | ✅ aucune propriété n'existe |
| **F3.1** | Titre défilant (marquee) | ✅ |
| **F3.2** | Temps écoulé, chiffres bitmap | ✅ |
| **F3.3** | Indicateurs mono/stéréo | ✅ |
| **F3.4** | kbps / kHz — **valeurs réelles**, vides sur streaming | ✅ corrigé par M0 §4.1 |
| **F3.5** | État dégradé si Music.app est fermée | ✅ |
| **F4** | Visualiseur temps réel (spectre + oscilloscope) | ✅ validé F4 |
| **F5** | Fenêtre Playlist : liste, piste courante, double-clic pour sauter | ✅ validé M0 §2 |
| — | Chargement de skins `.wsz` | — |

### Exclu de la V1

| Réf | Raison |
|---|---|
| **Fenêtre EQ fonctionnelle** | `EQ enabled` non inscriptible (−10006), `current EQ preset` illisible (−1728). **Fenêtre décorative uniquement**, comme la balance — M0 §3 |
| Bibliothèque / recherche | Winamp 2 n'en a pas |
| Gestion de fichiers locaux | Llammp ne lit pas de fichiers, il pilote Music.app |

---

## 3. Architecture

```
┌────────────────────────┐        JSON par ligne         ┌──────────────────────┐
│  Electron (renderer)   │◄──── stdout ── stdin ────────►│  Sidecar Swift       │
│  skin .wsz, UI, viz    │         via main process       │  NSAppleScript +     │
└────────────────────────┘                                │  DistributedNotif.   │
         │ loopback audio                                 └──────────┬───────────┘
         │ (getDisplayMedia)                                         │ Apple Events
         ▼                                                           ▼
   son du système                                              Music.app
```

**Pourquoi un sidecar séparé** plutôt que du code natif dans Electron : les Apple Events
et les notifications distribuées demandent un runtime AppKit, et l'isoler permet de le
redémarrer sans tuer l'UI si Music.app se comporte mal.

### 3.1 — Décisions techniques mesurées

| Décision | Justification |
|---|---|
| **`NSAppleScript` pré-compilé**, pas ScriptingBridge | `sdef`/`sdp` indisponibles (CLT seuls, M0 §1) donc pas de header typé. **Mesuré : 0,75 ms** pour `player position`, **1,75 ms** pour l'état complet, script pré-compilé dans un process persistant. Le polling 250 ms coûte ~0,3 % CPU — ScriptingBridge n'apporterait rien. |
| **Notifications pour l'état, polling pour la position** | Music.app n'émet **aucune** notification de progression (M0 §4.4, mesuré sur 5 min). Il n'existe pas d'alternative événementielle. |
| **Déduplication des notifications** | `com.apple.Music.playerInfo` **et** `com.apple.iTunes.playerInfo` arrivent à ~10 ms d'écart avec un `userInfo` identique (M0 §4.2). |
| **Audio loopback stéréo sans traitement** | Les défauts Chromium donnent du **mono** + AGC + noise suppression (F4 §7). Les trois contraintes sont obligatoires. |
| **Piste vidéo stoppée après acquisition** | L'audio survit (F4 §6, 1201/1201 frames). Pas de capture d'écran permanente. |

---

## 4. Contrat IPC sidecar ↔ app

Une ligne = un objet JSON. Sortie sidecar = événements ; entrée sidecar = commandes.

### 4.1 — Événements (sidecar → app)

```jsonc
// Etat du lecteur — emis sur notification, dedupliqué
{"type":"state","playerState":"playing|paused|stopped","volume":65,
 "shuffle":false,"repeat":"off|one|all"}

// Piste courante — emis a chaque changement
{"type":"track","persistentId":"8080B049BB9BDDC7","name":"…","artist":"…",
 "album":"…","duration":264.348,"bitRate":256,"sampleRate":44100,
 "kind":"shared|url|file","streaming":false}

// Position — emis a 250 ms pendant la lecture uniquement
{"type":"position","position":314.7}

// Playlist courante — emis a chaque changement de piste.
// `windowStart` + `trackCount` : la fenetre est partielle (voir §4.4).
// `orderIsPlayback:false` quand shuffle est actif : l ordre affiche n est PAS
// l ordre de lecture a venir (mesure, voir §4.5).
{"type":"queue","available":true,"playlistName":"…","playlistPersistentId":"…",
 "trackCount":6051,"currentIndex":1,"windowStart":1,"shuffle":false,
 "orderIsPlayback":true,
 "tracks":[{"index":2,"name":"…","artist":"…","duration":210.0}]}
{"type":"queue","available":false,"reason":"streaming_source"}

// Pochette — sur demande, base64
{"type":"artwork","persistentId":"…","format":"image/jpeg","data":"<base64>"}

// Music.app absente ou fermee (F3.5)
{"type":"unavailable","reason":"not_running|no_permission"}

// Diagnostic
{"type":"log","level":"info|warn|error","message":"…"}
```

### 4.2 — Commandes (app → sidecar)

```jsonc
{"cmd":"play"} {"cmd":"pause"} {"cmd":"playpause"} {"cmd":"stop"}
{"cmd":"next"} {"cmd":"previous"}
{"cmd":"seek","position":120.5}
{"cmd":"setVolume","volume":80}
{"cmd":"setShuffle","enabled":true}          // [reconstruit]
{"cmd":"setRepeat","mode":"off|one|all"}     // [reconstruit]
{"cmd":"playTrackAt","playlistPersistentId":"…","index":3}
{"cmd":"getArtwork","persistentId":"…"}
{"cmd":"refresh"}                            // force un etat complet
```

### 4.3 — Règles

1. **Le sidecar ne lance jamais Music.app.** Si elle est fermée, il émet `unavailable`
   et n'interroge plus rien jusqu'au prochain lancement (M0 : les sondes n'ont jamais
   lancé Music.app).
2. **`persistentId` toujours en hexadécimal 16 caractères.** La notification donne un
   `NSNumber` signé ; conversion obligatoire
   `String(format:"%016llX", UInt64(bitPattern: Int64(n)))` (M0 §4.2).
3. **Durées en secondes décimales** côté contrat. `Total Time` de la notification est en
   ms, `player position` en secondes : normaliser dans le sidecar.
4. **`queue.available:false` est un état, pas une erreur.** L'erreur −1731 sur source
   streamée ne doit jamais remonter comme panne (M0 §4.2).
5. **Les nombres AppleScript suivent la locale système.** Sur une machine française,
   `duration` et `player position` sortent en `245,466995` — **virgule décimale**. Tout
   parsing en `Double` doit normaliser la virgule, sous peine de valeurs nulles
   silencieuses. *(mesuré ici, absent du PRD et des deux rapports)*

### 4.4 — Fenêtrage de la playlist : obligatoire

**Mesuré sur « Morceaux préférés », 6051 pistes :**

| Lecture | Temps |
|---|---|
| Fenêtre de 200 pistes centrée sur la piste courante | **0,19 s** |
| Énumération complète des 6051 pistes | **10,6 s** |

L'énumération complète est donc exclue. Le sidecar lit une **fenêtre de 200 pistes**
autour de la piste courante et annonce `trackCount` réel + `windowStart`. Le rendu de la
fenêtre Playlist doit être virtualisé en conséquence.

Les trois propriétés sont lues **groupées** (`name of tracks lo thru hi`), jamais piste
par piste : c'est ce qui fait la différence entre 0,19 s et plusieurs minutes.

### 4.5 — Shuffle : l'ordre affiché n'est pas l'ordre de lecture

Le risque ouvert de M0 §2 point 1 est **levé, et l'hypothèse optimiste est fausse.**

Test : shuffle activé, piste courante à l'index 1, la playlist annonce *The Orientalist*
à l'index 2. Après `next track`, la lecture passe à *Halitus*, **index 2127**.

> Malgré `fixed indexing = false`, les index AppleScript reflètent l'**ordre de la
> playlist**, jamais l'ordre de lecture aléatoire. Aucune API n'expose ce dernier.

**Ce n'est pas bloquant, parce que Winamp 2 se comporte pareil :** sa fenêtre Playlist
affiche la liste dans son ordre et surligne la piste courante ; elle ne prétend jamais
montrer l'ordre aléatoire à venir. La V1 fait donc exactement cela, et signale l'état via
`orderIsPlayback:false`.

En revanche `index of current track` **reste fiable pour le surlignage** — c'est la
position réelle dans la liste affichée (2127 correspondait bien à *Halitus*).

---

## 5. Jalons

| Jalon | Contenu | Critère d'acceptation |
|---|---|---|
| **M0** | Spikes de faisabilité | ✅ **clos** — `RAPPORT-M0.md`, `RAPPORT-F4.md` |
| **M1** | Sidecar + contrat IPC | ✅ **fait** — le sidecar émet les 6 types d'événements et exécute les 11 commandes ; vérifié en pilotage direct (`echo '{"cmd":…}' \| llammp-sidecar`). |
| **M2** | Rendu du skin + transport | ✅ **fait** — `base-2.91.wsz` rendu conforme, vérifié par capture ; moteur de skin validé sur 3 skins hétérogènes (TopazAmp, MacOSXAqua, Zaxon). Transport, volume, seek et synchronisation câblés. |
| **M3** | Visualiseur | ⚠️ **codé, non validé de bout en bout** — spectre et oscilloscope aux couleurs de `VISCOLOR.TXT` ; la chaîne de capture est celle prouvée en F4, mais elle attend l'autorisation macOS sur le bundle. |
| **M4** | Fenêtre Playlist + EQ décoratif | ✅ **fait** — liste, surlignage, cadrage automatique, état dégradé ; EQ décoratif avec tooltip. Double-clic implémenté, non testé à la souris. |
| **M5** | Build & distribution | ⚠️ **partiel** — app packagée avec `NSAudioCaptureUsageDescription` et `NSAppleEventsUsageDescription`, sidecar dépaqueté hors asar, skins en `extra-resource`. Restent : l'onboarding d'autorisation et la signature Developer ID. |

### 5.1 — Ce qui bloque la validation finale

Deux autorisations macOS, qu'aucun code ne peut contourner :

1. **Automatisation → Music** : le tout premier appel Apple Events **bloque** le sidecar
   tant que le dialogue n'est pas validé. Symptôme trompeur : l'app affiche
   « MUSIC.APP FERMEE » alors que Music.app joue.
2. **Enregistrement de l'écran et audio du système** : à accorder à la main, macOS
   n'affichant aucun dialogue pour un bundle ad-hoc (F4 §9.2).

Le sidecar signale désormais son démarrage **avant** la première requête, précisément
pour que ce blocage soit lisible dans les logs plutôt que muet.

---

## 6. Risques ouverts

Repris des deux rapports, non levés à ce jour :

1. **Onboarding d'autorisation** (F4 §9.2) — aucun dialogue macOS n'apparaît sur bundle
   ad-hoc ; l'utilisateur doit autoriser à la main. À concevoir en M5, à revalider sur
   build notarisé avec Developer ID.
2. **Apple Events sur build signé** (M0 §6.5) — les sondes ont tourné sous l'autorisation
   du terminal.
3. ~~**Fenêtre Playlist : shuffle et grande échelle**~~ — **levés** : voir §4.4
   (fenêtrage obligatoire, 0,19 s contre 10,6 s) et §4.5 (l'ordre affiché n'est pas
   l'ordre de lecture, comme dans Winamp). **Reste ouvert :** la lecture d'un *album* de
   bibliothèque — `current playlist` pointe-t-elle sur l'album ou sur les 6369 pistes de
   la bibliothèque ? Sans conséquence sur l'architecture : le fenêtrage couvre déjà le
   pire cas.
4. **Latence audio du visualiseur** (F4 §10) — `latency: 0.02` annoncé, jamais mesuré.
