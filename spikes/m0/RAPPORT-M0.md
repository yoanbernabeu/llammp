# Rapport M0 — Spikes de faisabilité

**Projet :** Llama (client Winamp pilotant Apple Music)
**Date :** 17 août 2026
**Statut :** clos — les deux verdicts sont rendus

---

## 1. Environnement de mesure

| Élément | Valeur |
|---|---|
| macOS | 15.7.3 (24G419) — cible PRD 14.2+ ✔ |
| Music.app | 1.5.6, `/System/Applications/Music.app` |
| Electron disponible | 43.4.0 — minimum PRD ≥ 39 ✔ (large marge) |
| Bibliothèque de test | 6369 pistes, 31 playlists, **iCloud Music Library** |
| Nature des pistes | `shared track` en bibliothèque, `URL track` en lecture |
| Fichiers locaux (`file track`) | **aucun** dans l'échantillon |
| Xcode | Command Line Tools seuls — `swiftc` OK, `sdef`/`sdp` indisponibles |

**Méthode.** Lecture du dictionnaire de scripting complet
(`Contents/Resources/com.apple.Music.sdef`, 608 lignes, copié dans ce dossier),
puis quatre sondes Apple Events réelles + un listener de notifications distribuées
compilé en Swift. Music.app n'a jamais été lancée par les sondes ; aucune écriture
destructrice n'a été effectuée (tests d'écriture en no-op ou restaurés).

**Artefacts :** `probe.applescript`, `probe2.applescript`, `probe3.applescript`,
`probe4.applescript`, `listener.swift`, `notifications.log`.

> `Music.sdef` a servi de source à ce rapport mais **n'est pas versionné** : c'est le
> dictionnaire de scripting d'Apple. Pour le récupérer :
> `cp /System/Applications/Music.app/Contents/Resources/com.apple.Music.sdef .`

---

## 2. Spike 1 — File d'attente : **VERDICT POSITIF SOUS CONDITION**

> **La fenêtre Playlist est faisable en v1**, sauf lorsque la lecture provient du
> catalogue Apple Music en streaming ou de la radio — cas qui exige un état dégradé.

*Cette section conserve volontairement la trace du raisonnement initial, qui concluait
au négatif : la démarche d'invalidation est ce qui a produit le verdict correct.*

### Constat structurel

Le dictionnaire de scripting ne contient **aucune** notion de « Up Next » : ni classe,
ni propriété, ni commande. La seule approche possible passait par `current playlist`,
déclarée `access="r"`.

### Constat expérimental — quatre voies, quatre échecs

| Voie tentée | Résultat |
|---|---|
| `current playlist` (contexte iTunes Radio) | **erreur −1731** « Type d'objet inconnu » |
| `current playlist` (contexte album Apple Music) | **erreur −1731** — identique |
| Résolution via `Playlist PersistentID` de la notification | **0 playlist correspondante** |
| `view of browser window 1` (repli UI) | **erreur −1731** |
| Reconstruction de l'album depuis la bibliothèque | **1 piste sur l'album entier** — inexploitable |

La piste `Playlist PersistentID` méritait d'être suivie : la notification `playerInfo`
expose bien un identifiant de playlist (`8080B049BB9BDDC7` après conversion), absent
de la documentation du PRD. Mais cette playlist n'appartient pas à la collection
`playlists` scriptable — c'est un contexte de lecture Apple Music, pas un objet de
bibliothèque. La requête `every playlist whose persistent ID is …` retourne zéro.

La reconstruction par album échoue pour la même raison : l'album en lecture provient
du catalogue en streaming, et la bibliothèque n'en contient qu'une piste isolée.

### ⚠️ Correction — le verdict ci-dessus était une généralisation abusive

Les cinq échecs ci-dessus sont réels, mais ils partagent tous **le même biais** : les deux
contextes de lecture testés étaient du **catalogue Apple Music en streaming**
(`URL track`, `container = source / iTunes Store` puis `source / iTunes Radio`).

Un sixième test (`probe6.applescript`), lancé cette fois depuis une **playlist de
bibliothèque**, renverse la conclusion :

| Test en contexte playlist de bibliothèque | Résultat |
|---|---|
| `play playlist "100 Classic Reggae Tracks"` | **acceptée** |
| **`current playlist`** | **RÉSOLUE** — `100 Classic Reggae Tracks [user playlist]` |
| `count of tracks` | 3 |
| `index of current track` | 1 |
| **Pistes suivantes** | **lisibles** — `[2] Cool and Calm`, `[3] Marcus Garvey` |
| `next track` (F2.1) | **fonctionne** — changement de piste confirmé |
| `play track 1 of playlist "…"` | **acceptée** — équivalent du double-clic Winamp |

**La file d'attente est donc accessible.** La ligne de fracture n'est pas
« Music.app n'expose pas sa queue », mais :

- **Lecture issue d'une playlist / de la bibliothèque** (`shared track`, `file track`) →
  `current playlist`, index et pistes suivantes disponibles. Tout fonctionne.
- **Lecture issue du catalogue en streaming ou de la radio** (`URL track`) →
  `current playlist` échoue en −1731. Aucune file exploitable.

### Verdict révisé

> **La fenêtre Playlist est faisable en v1**, avec un état dégradé documenté.

Les trois interactions structurantes de la fenêtre Playlist d'origine sont couvertes :
afficher la file (`tracks of current playlist`), surligner la piste courante
(`index of current track`), sauter à une piste au double-clic
(`play track i of playlist`). S'y ajoute la navigation dans les 26 playlists de
bibliothèque, mesurée en `probe5.applescript` (0,17 s, contenu entièrement lisible).

### Exigence induite : l'état dégradé

Quand la source est le catalogue streamé, la fenêtre doit se vider proprement, sans
erreur visible — même traitement que F3.5 pour Music.app fermée. Le sidecar doit exposer
ce cas explicitement plutôt que de laisser filtrer une erreur −1731.

**Ajout proposé au contrat §4.1 :**

```jsonc
// Contexte de lecture — emis a chaque changement de piste
{"type":"queue","available":true,"playlistName":"100 Classic Reggae Tracks",
 "playlistPersistentId":"…","trackCount":3,"currentIndex":1,
 "tracks":[{"index":2,"name":"Cool and Calm","artist":"Israel Vibration"}]}

// Source catalogue/radio : pas de file exploitable
{"type":"queue","available":false,"reason":"streaming_source"}
```

**Commande associée :**

```jsonc
{"cmd":"playTrackAt","playlistPersistentId":"…","index":3}
```

### Points non couverts, à lever avant d'implémenter la fenêtre

1. **Comportement en shuffle.** `fixed indexing` vaut `false` sur la machine de test, donc
   les index *devraient* suivre l'ordre de lecture réel. Non vérifié avec `shuffle enabled`.
   Déterminant : la file affichée serait fausse si l'hypothèse tombe.
2. **Lecture d'un album de bibliothèque** (et non d'une playlist) : `current playlist`
   pointe-t-elle sur la bibliothèque entière — 6369 pistes — ou sur l'album ? Une file de
   6369 entrées impose une virtualisation du rendu.
3. **Coût de lecture d'une grande file.** Les mesures portent sur 3 pistes. Une playlist de
   6051 pistes (« Morceaux préférés ») n'a pas été énumérée intégralement.

---

## 3. Spike 2 — Égaliseur : **VERDICT NÉGATIF**

> **La fenêtre EQ est décorative et désactivée, au même titre que la balance.**

### Ce qui fonctionne

| Test | Résultat |
|---|---|
| Classe `EQ preset` : bandes 1–10 + preamp | Exposées, −12.0 à +12.0 dB |
| 23 presets, propriété `modifiable` | **`true` sur les 23** |
| Lecture des bandes par nom (`EQ preset "Rock"`) | OK — `5.0 / 4.0 / 4.5`, preamp `0.0` |
| **Écriture d'une bande** | **OK** — accepté sans erreur |
| `EQ enabled` en **lecture** | OK (`false`) |

### Ce qui bloque

| Test | Résultat |
|---|---|
| **`EQ enabled` en écriture** | **erreur −10006** — « impossible de régler EQ enabled à true » |
| Idem, second contexte de lecture | **erreur −10006** — reproductible |
| **`current EQ preset` en lecture** | **erreur −1728** — « impossible d'obtenir » |

### Analyse

Pouvoir écrire les bandes d'un preset est sans valeur si l'on ne peut ni activer
l'égaliseur, ni savoir quel preset est actif. Les deux verrous sont indépendants et
tous deux bloquants :

- **Impossible d'activer l'EQ** → toute modification de bande reste inaudible.
- **Impossible de lire le preset courant** → l'UI ne peut pas refléter l'état réel,
  ce qui viole l'exigence de synchronisation bidirectionnelle du PRD (§10.3).

S'ajoute un problème de conception que le verdict rend théorique mais qu'il faut
consigner : **les fréquences ne correspondent pas**. Music.app expose
32/64/125/250/500/1k/2k/4k/8k/16k Hz ; Winamp 2 affiche 60/170/310/600/1k/3k/6k/12k/14k/16k.
Les dix sliders du skin ne mappent pas 1:1 — une implémentation aurait exigé soit un
décalage assumé, soit un réétiquetage rompant la fidélité visuelle.

### Réserve honnête

`current EQ preset` n'a pu être testé **qu'avec l'égaliseur désactivé** (`EQ enabled = false`
sur la machine de test, et impossible à activer par script). Il est plausible que cette
propriété devienne lisible si l'utilisateur active l'égaliseur manuellement dans Music.app.

Cela ne sauverait pas la feature : elle dépendrait d'une action manuelle préalable dans
l'application qu'on prétend piloter, et resterait impossible à désactiver depuis notre UI.
Une fenêtre EQ fonctionnant « seulement si vous l'avez allumée ailleurs » est un piège
ergonomique, pas une feature.

### Recommandation

Fenêtre EQ décorative : sliders affichés, centrés, non draggables, tooltip explicatif —
traitement strictement identique à celui prévu pour la balance en **F2.4**.

---

## 4. Amendements au PRD

### 4.1 — F3.4 est factuellement faux

Le PRD affirme que kbps et kHz « ne sont pas exposées ». **C'est inexact** :
`bit rate` et `sample rate` sont des propriétés `access="r"` de la classe `track`, et
retournent de vraies valeurs sur les pistes de bibliothèque — mesuré : **256 kbps / 44100 Hz**.

Elles valent `missing value` uniquement sur les `URL track` (radio et lecture streamée).

**Reformulation proposée de F3.4 :**
> Les zones kbps et kHz affichent les valeurs réelles de `bit rate` et `sample rate`
> lorsqu'elles sont disponibles. Sur les `URL track` (streaming), ces propriétés valent
> `missing value` : les zones restent alors vides. Ne jamais inventer de valeur.

### 4.2 — Nouveaux pièges à consigner au §8

| Piège | Symptôme | Parade |
|---|---|---|
| **Double notification** | `com.apple.Music.playerInfo` **et** `com.apple.iTunes.playerInfo` sont émises pour le même événement, à ~10 ms d'écart, avec un `userInfo` identique | S'abonner à une seule, ou dédupliquer par `(PersistentID, Player State)` sur une fenêtre de 100 ms. **Non documenté dans le PRD.** |
| **`PersistentID` de type incompatible** | La notification donne un `NSNumber` **signé** (`-9187149409109156126`) ; ScriptingBridge donne une chaîne hex (`8080B049BB9BDEE2`) | Convertir : `String(format: "%016llX", UInt64(bitPattern: Int64(n)))`. Correspondance vérifiée au bit près. Sans cela, le cache d'artwork par `persistentId` ne fera jamais mouche. |
| `EQ enabled` en écriture | Erreur −10006 systématique | Ne pas tenter ; EQ décoratif |
| **`current playlist` dépend de la source** | Erreur −1731 sur contenu catalogue/radio (`URL track`), résolution normale depuis une playlist de bibliothèque. Tester la propriété dans un seul contexte mène à une conclusion fausse — c'est arrivé pendant ce spike. | Traiter −1731 comme un **état** (`queue.available = false`), pas comme une panne. Toujours qualifier une mesure Apple Events par la classe de la piste courante. |
| **`play` avec paramètre direct** | Non documenté au §4.2 du PRD, mais fonctionnel : `play playlist "X"` et `play track i of playlist "X"` | Base de la commande `playTrackAt` — permet le double-clic Winamp |
| `Artwork Count` incohérent | La notification annonce `0` alors que ScriptingBridge voit 1 artwork | Ne pas se fier à `Artwork Count` ; interroger `artworks` à la demande |

### 4.3 — Le coût des pochettes est surestimé

Le PRD classe la récupération d'artwork comme « coûteuse » et « lente si demandée en
boucle ». Mesure réelle : le script complet, artwork brut inclus, s'exécute en **0,16 s**.
`format = JPEG picture`, `raw data` récupérable sans difficulté.

Le cache par `persistentId` reste justifié, mais ce n'est pas un point chaud. Ne pas
sur-investir dans son optimisation.

### 4.4 — Confirmations

- **F2.4 confirmé** : aucune propriété de balance nulle part dans le dictionnaire.
  Le slider décoratif est le bon choix.
- **Clés `userInfo` du PRD §4.3 confirmées**, plus quatre non documentées et utiles :
  `Playlist PersistentID`, `Library PersistentID`, `Album Rating`, `Disc Number`.
- `Total Time` est bien en millisecondes (`264348`) ; `player position` est en **secondes
  décimales** côté ScriptingBridge (`314.700988769531`) — conversion nécessaire.
- `sound volume` est bien un entier 0–100, `player position` accessible en lecture/écriture.
- **Le polling de position est bien obligatoire.** Sur une fenêtre d'écoute de 5 minutes
  en lecture continue, Music.app n'a émis **aucune** notification liée à la progression :
  seules les 2 notifications de changement de piste sont arrivées. La stratégie du §4.3
  (notification pour l'état, polling `playerPosition` à 250 ms pour la position) est
  confirmée expérimentalement — il n'existe pas d'alternative événementielle.

---

## 5. Impact sur les jalons

| Jalon | Impact |
|---|---|
| **M1** — Sidecar + IPC | Contrat **étendu** : événement `queue`, commande `playTrackAt`, déduplication des notifications, conversion `PersistentID`. |
| **M2** — UI + transport | Périmètre net **inchangé** : la fenêtre EQ sort, la fenêtre Playlist reste (avec son état dégradé). F3.4 à reformuler. |
| **M3** — Visualiseur | Inchangé — non couvert par M0. |
| **M4/M5** | Inchangés. |

Une seule des deux fenêtres secondaires de Winamp sort du périmètre : l'**EQ**. La
fenêtre **Playlist reste en v1**, avec ses trois interactions d'origine (afficher la file,
surligner la piste courante, sauter à une piste) et un état dégradé sur source streamée.

---

## 6. Ce que M0 n'a pas couvert

À traiter avant ou pendant M3 :

1. ~~**Capture audio loopback (F4)** — non testée. C'est désormais le risque technique
   principal restant, et il n'a pas de plan B.~~
   **Levé le 17 août 2026 → voir `spikes/f4/RAPPORT-F4.md`.** Verdict positif sous
   condition : la capture fonctionne et survit à l'arrêt de la piste vidéo, mais la
   configuration par défaut produit un flux audio **mort sans erreur** sur macOS ≥ 14.2
   avec Electron ≥ 39. Reste ouvert : valider la voie de production
   (`NSAudioCaptureUsageDescription`) plutôt que le flag de compatibilité utilisé ici.
2. **Fenêtre Playlist en shuffle, sur album, et à grande échelle** — les trois points
   listés en fin de §2. À lever avant d'implémenter la fenêtre, pas avant M1 : le contrat
   du sidecar est le même dans tous les cas.
3. **Comportement sur bibliothèque de fichiers locaux** — non testable ici (aucun
   `file track` disponible). Sans conséquence : le cas bibliothèque est désormais couvert
   par les `shared track`, qui se comportent comme des pistes locales.
4. **`current EQ preset` avec égaliseur activé manuellement** — voir réserve §3.
5. **Autorisation Apple Events sur build signé** — les sondes ont tourné sous
   l'autorisation du terminal. Le §6 du PRD impose de revalider sur build notarisé.

---

## 7. Leçon de méthode

Le spike 1 a d'abord conclu au négatif sur la foi de cinq mesures convergentes — toutes
prises dans le même contexte de lecture. Le biais n'était pas dans les mesures mais dans
l'échantillonnage : deux sources testées, une seule nature de piste (`URL track`).

**Règle à appliquer au reste du projet :** toute mesure Apple Events doit être qualifiée
par la classe de la piste courante (`URL track` / `shared track` / `file track`) et par sa
source (`container`). Une propriété de Music.app n'est jamais « disponible » ou
« indisponible » dans l'absolu — elle l'est pour un contexte de lecture donné.
