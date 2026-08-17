# Rapport F4 — Capture audio loopback

**Projet :** Llama (client Winamp pilotant Apple Music)
**Date :** 17 août 2026
**Statut :** clos — verdict rendu
**Contexte :** dernier risque technique majeur de M0, listé au §6 du `RAPPORT-M0.md`
comme « non testé, sans plan B ».

---

## 1. Verdict

> **POSITIF SOUS CONDITION.** La capture du son système fonctionne, et le signal
> survit à l'arrêt de la piste vidéo. Mais **la configuration par défaut produit un
> flux audio mort, silencieusement** : le déblocage tient à l'identité TCC de
> l'application, sans laquelle rien n'indique la panne.

**La voie de production est validée** (§9) : une app packagée et autorisée capture le son
système sans aucun feature flag. Le visualiseur (M3) est faisable. Le risque restant n'est
plus technique mais **distributif** : obtenir l'autorisation chez l'utilisateur final.

---

## 2. Environnement de mesure

| Élément | Valeur |
|---|---|
| macOS | 15.7.3 — **≥ 14.2**, seuil déterminant (voir §5) |
| Electron | 43.4.0 / Chromium 150.0.7871.224 — **≥ 39**, second seuil déterminant |
| Plateforme | darwin arm64 |
| Source sonore | Music.app en lecture, sortie non coupée, `sound volume` = 65 |
| Autorisation écran | `granted` (vérifiée par `systemPreferences.getMediaAccessStatus`) |
| Lancement | via `npm start` depuis le terminal — **non signé, non packagé** |

**Artefacts :** `main.js`, `renderer.js`, `preload.js`, `index.html`.
Deux variables d'environnement pilotent les variantes : `F4_LEGACY_AUDIO=1` et
`F4_RAW_AUDIO=1`.

---

## 3. Protocole

Le spike valide trois choses en un run de 14 s :

1. **F4.1** — `setDisplayMediaRequestHandler` côté main avec `audio: 'loopback'`,
   `getDisplayMedia({audio, video})` côté renderer. Une piste vidéo est obligatoire à
   la demande.
2. **F4.2** — la piste vidéo est **stoppée à t = 4 s**. L'audio doit survivre : c'est
   ce qui permet de ne pas payer une capture d'écran permanente pour du son.
3. **F4.3** — chaîne d'analyse `MediaStreamSource → AnalyserNode` (FFT 2048), mesure du
   RMS par frame et de 8 bandes de fréquence. Verdict automatique par comparaison des
   deux phases, seuil de signal à RMS > 0,0005.

L'`AnalyserNode` n'est **pas** connecté à `destination` : le reconnecter réinjecterait
le son capturé dans la sortie système, donc dans la capture. Larsen garanti.

---

## 4. Run 1 — échec, et pourquoi il était trompeur

Configuration par défaut, Music.app en lecture :

```
Phase AVEC video : n=456 rms_max=0.00000 frames_avec_signal=0/456
Phase SANS video : n=1201 rms_max=0.00000 frames_avec_signal=0/1201
RESULTAT : ECHEC — piste audio SILENCIEUSE dans les deux phases.
```

Le verdict automatique du spike proposait deux causes : « soit rien ne jouait, soit le
loopback ne capture pas le son système ». **Les deux sont fausses.** Deux lignes du log
le montraient déjà :

```
audio: label="System audio" enabled=true state=ended
[...] Can't wrap SharedImage as VideoFrame          (répété chaque seconde)
```

La piste audio est **`ended` avant la première mesure** — elle n'a jamais vécu. Aucune
exception, aucun rejet de promesse, aucun avertissement : `getDisplayMedia` a résolu
normalement et livré une piste morte.

### Diagnostic — isoler avant d'accuser

Instrumentation ajoutée au main process (`getMediaAccessStatus`, inspection des sources,
`readyState` de la piste vidéo) :

| Mesure | Résultat | Conclusion |
|---|---|---|
| `getMediaAccessStatus('screen')` | **`granted`** | Ce n'est pas l'autorisation d'écran |
| `desktopCapturer.getSources` | 2 écrans, vignettes **non vides** | La capture d'écran fonctionne réellement |
| Piste **vidéo** `readyState` | **`live`** | La moitié vidéo de F4.1 est saine |
| Piste **audio** `readyState` | **`ended`** | La panne est isolée sur l'audio seul |

L'erreur `Can't wrap SharedImage as VideoFrame` est du bruit sans rapport, lié à la
capture en 1×1 px — la piste vidéo est bien vivante.

---

## 5. Cause racine

Documentée dans `docs/api/desktop-capturer.md` d'Electron, et non dans la page
`session.md` que l'on consulte naturellement pour `setDisplayMediaRequestHandler` :

> Sur **macOS 14.2 ou supérieur**, la clé `NSAudioCaptureUsageDescription` doit figurer
> dans l'Info.plist pour que l'audio soit capturé par `desktopCapturer`. **Si Electron est
> lancé depuis un autre programme — terminal, IDE — c'est ce programme parent qui doit
> porter la clé.** L'échec faute de permission **crée un flux audio mort, sans
> avertissement ni erreur**. Depuis Electron **v39.0.0-beta.4**, Chromium a fait de
> l'API CoreAudio Tap le défaut, **sans repli** sur l'ancien système de permissions.

Les deux seuils sont franchis sur cette machine (macOS 15.7.3, Electron 43.4.0). La
permission « Enregistrement de l'écran », pourtant `granted`, ne couvre plus l'audio :
c'est le **tap CoreAudio** qui est refusé, et son refus est silencieux par conception.

⚠️ **Note de documentation contradictoire.** `session.md` affirme encore que `loopback`
« n'est actuellement supporté que sur Windows ». C'est faux sur macOS 15 : la §6 le
démontre. Ne pas se fier à cette page pour arbitrer le périmètre.

---

## 6. Run 2 — succès par le chemin legacy

Le flag documenté rétablit l'ancien chemin, adossé à l'autorisation d'écran déjà accordée :

```js
app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
```

```
audio: label="System audio" enabled=true state=live
Phase AVEC video : n=482 rms_moy=0.05113 rms_max=0.27917 frames_avec_signal=458/482
Phase SANS video : n=1201 rms_moy=0.08418 rms_max=0.29633 frames_avec_signal=1201/1201
RESULTAT : SUCCES — signal capture ET conserve apres arret de la piste video.
  Ratio d amplitude sans/avec video : 1.06
```

| Point validé | Preuve |
|---|---|
| **F4.1** — capture du son système | RMS moyen 0,051, pic 0,279 ; spectre cohérent avec le morceau joué |
| **F4.2** — survie à l'arrêt de la vidéo | `state=live` après `stop()` ; **1201/1201** frames avec signal en phase 2 |
| Pas d'atténuation | Ratio d'amplitude sans/avec vidéo = **1,06** |

F4.2 est le point le plus rentable : la capture d'écran peut être coupée à la seconde
suivante et le son continue d'arriver. Le visualiseur ne coûtera pas une capture vidéo
permanente.

---

## 7. Run 3 — le défaut Chromium abîme le signal

Les settings de la piste du run 2 révèlent des traitements **destinés à la voix**,
actifs par défaut :

```jsonc
{"autoGainControl":true,"channelCount":1,"echoCancellation":true,"noiseSuppression":true}
```

`autoGainControl` écrase la dynamique, `noiseSuppression` mange le haut du spectre, et
surtout **`channelCount: 1`** : le flux est **mono**. Un visualiseur Winamp a besoin des
deux canaux.

Contraintes explicites passées à `getDisplayMedia` :

```js
audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
```

```jsonc
{"autoGainControl":false,"channelCount":2,"echoCancellation":false,"noiseSuppression":false}
```

| Aspect | Défaut | Avec contraintes |
|---|---|---|
| **Canaux** | **1 (mono)** | **2 (stéréo)** |
| Traitements de voix | 3 actifs | tous désactivés |
| Bandes hautes peuplées | jusqu'à l'indice 4 | jusqu'à l'indice 5–6 |

Les contraintes sont **honorées**. Le gain stéréo est un fait dur, indépendant du
contenu joué. La comparaison spectrale, elle, est indicative seulement : le morceau
diffère d'un run à l'autre, donc la remontée du haut du spectre n'est pas mesurée à
contenu constant.

**Conséquence pour M3 :** ces trois contraintes ne sont pas une optimisation, elles
conditionnent la fidélité du visualiseur. À câbler dès le premier jet.

---

## 8. Amendements au PRD

### 8.1 — Nouveaux pièges à consigner au §8

| Piège | Symptôme | Parade |
|---|---|---|
| **Flux audio mort silencieux** | `getDisplayMedia` résout, la piste existe, `label="System audio"`, mais `readyState === 'ended'` avant toute mesure. Aucune erreur. | Vérifier `readyState` **immédiatement** après obtention et traiter `ended` comme un échec de permission explicite. Ne jamais conclure « pas de son » depuis un RMS nul. |
| **Identité TCC héritée en dev** | Lancé par `npm start`, Electron hérite de l'identité TCC du terminal : l'audio est mort même si tout est correct côté code | Tester la capture audio sur une **app packagée** lancée par `open`, jamais via `npm start`. Déclarer `NSAudioCaptureUsageDescription` dans l'Info.plist du build. |
| **Défauts de capture orientés voix** | mono + AGC + noise suppression + echo cancellation | Toujours passer `{echoCancellation:false, noiseSuppression:false, autoGainControl:false}` |
| **Larsen d'analyse** | Boucle audio si l'`AnalyserNode` est connecté à `destination` | Ne jamais connecter la chaîne d'analyse à la sortie |
| **Doc `session.md` trompeuse** | « loopback : Windows uniquement » | Faux sur macOS 15 ; se référer à `desktop-capturer.md` |

### 8.2 — Impact sur les jalons

| Jalon | Impact |
|---|---|
| **M3 — Visualiseur** | **Débloqué.** Contraintes audio imposées (stéréo, sans traitement) ; la piste vidéo peut être stoppée dès l'obtention du flux. |
| **M4/M5 — Build & distribution** | **Charge nouvelle** : déclarer `NSAudioCaptureUsageDescription`, et surtout **concevoir l'onboarding d'autorisation** (§9.2) — aucun dialogue macOS n'apparaît sur bundle ad-hoc. À traiter avec la revalidation Apple Events du §6.5 de M0 : même nature de problème, mêmes tests sur build notarisé. |
| M1 / M2 | Inchangés. |

---

## 9. Runs 4 à 6 — la voie de production, testée

Le flag du run 2 est un mécanisme de **compatibilité**, voué à disparaître. La voie
durable a donc été testée sur une **vraie app packagée** (`@electron/packager`, bundle
`com.electron.f4prod`, signature ad-hoc), avec `NSAudioCaptureUsageDescription` injecté
par `--extend-info`, **sans aucun feature flag**.

Lancement par `open -W --env --stdout` : c'est ce qui détache le processus du terminal et
lui donne sa **propre identité TCC** — le point que la doc Electron désigne sans le
nommer. L'app packagée n'ayant plus de console, un doublon de log fichier a dû être
ajouté au main process (`F4_LOG_FILE`).

| Run | Configuration | `getMediaAccessStatus('screen')` | Piste audio | Résultat |
|---|---|---|---|---|
| **4** | packagée **avec** clé, jamais autorisée | **`denied`** | — | `getSources` échoue, `AbortError: Invalid capture constraints` |
| **5** | packagée **avec** clé, **autorisée à la main** | `granted` | **`live`**, **stéréo** | **SUCCÈS** — 1201/1201 frames, ratio 1,08, **sans flag** |
| **6** | même bundle, **clé retirée** (contre-test) | `granted` | **`live`**, **stéréo** | **SUCCÈS** — inchangé |

### 9.1 — Ce que le contre-test corrige

Le run 5 changeait **deux variables à la fois** : la clé était ajoutée *et* l'autorisation
accordée. Conclure « c'est la clé qui débloque » aurait été le même raisonnement fautif
qu'au §10. Le run 6 tranche : **clé retirée, la capture continue de fonctionner.**

> Le facteur déterminant n'est pas la clé Info.plist, c'est **l'autorisation TCC portée
> par une identité d'application propre**. En dev lancé depuis un terminal, l'app hérite
> de l'identité du terminal — qui, lui, ne porte pas la clé : d'où le flux mort du run 1.

Le rôle attendu de la clé — permettre à macOS d'**afficher** la demande d'autorisation —
n'a **pas pu être démontré** : aucun dialogue n'est jamais apparu, y compris au run 4 où
macOS a directement inscrit un refus. L'autorisation a dû être accordée **manuellement**
dans Réglages Système. C'est cohérent avec un bundle signé ad-hoc, mais cela laisse la
question ouverte pour un build notarisé (§10).

### 9.2 — Conséquence : le risque change de nature

Le risque F4 n'est plus « la capture est-elle possible ? » — elle l'est, proprement, sans
flag. Il devient : **l'utilisateur final parviendra-t-il à accorder l'autorisation ?**
Si, sur build notarisé, macOS n'affiche pas plus de dialogue qu'ici, il faudra guider
l'utilisateur vers Réglages Système au premier lancement — un parcours d'onboarding à
concevoir, pas une ligne de code. **À traiter en M4/M5, avec un vrai certificat
Developer ID.**

---

## 10. Ce que F4 n'a pas couvert

1. **Rien n'a été testé sur build notarisé avec un certificat Developer ID.** Les runs 4
   à 6 utilisent une signature **ad-hoc**. Deux inconnues en découlent : macOS
   affiche-t-il alors le dialogue d'autorisation (et donc la clé Info.plist redevient-elle
   déterminante), et l'autorisation survit-elle aux mises à jour de l'app ? Même réserve
   que M0 §6.5, à traiter dans le même lot.
2. **Le prompt d'autorisation n'a jamais été observé.** L'autorisation a été accordée à la
   main. Le parcours réel du premier lancement reste donc inconnu.
3. **Latence non mesurée.** `latency: 0.01` est annoncé dans les settings mais n'a pas
   été vérifié. Déterminant pour la synchronisation visuelle du visualiseur.
4. **Stabilité longue durée non évaluée.** Le run le plus long fait 14 s. Rien ne dit
   ce qui arrive après une heure, ni au changement de périphérique de sortie en cours de
   capture (branchement d'un casque, bascule Bluetooth).
5. **Un seul périphérique de sortie testé.** Le comportement sur AirPlay ou sortie
   Bluetooth n'est pas connu.

---

## 11. Leçon de méthode

Le spike a rendu un verdict d'échec **faux** au premier run, et son message d'erreur
proposait deux causes toutes deux erronées. Ce qui a permis de trancher n'est pas une
mesure supplémentaire mais **le refus de croire le verdict agrégé** : deux lignes de log
— `state=ended` et une piste vidéo pourtant `live` — contredisaient l'interprétation
« le loopback ne capture pas ».

Cela prolonge exactement la règle dégagée en M0 §7, où le spike 1 avait aussi conclu au
négatif à tort :

> **Une API n'est pas « cassée » ou « fonctionnelle » dans l'absolu.** Avant de conclure
> à l'échec, isoler : quelle moitié du dispositif fonctionne, quelle moitié non. Ici
> vidéo `live` + audio `ended` désignait la permission ; RMS nul seul ne désignait rien.

Corollaire pratique, à appliquer au reste du projet : **un verdict automatique doit
publier les faits bruts qui le fondent, pas seulement sa conclusion.** C'est parce que
le spike affichait `readyState` et les settings de piste qu'on a pu le contredire.

Second corollaire, tiré du run 6 : **quand un test réussit après avoir changé deux
choses, il n'a rien prouvé.** Le run 5 ajoutait la clé Info.plist *et* l'autorisation
TCC ; il aurait été facile — et faux — d'en conclure que la clé débloque la capture. Le
contre-test qui retire une seule variable coûte trente secondes et vaut mieux qu'une
recommandation d'architecture erronée transmise à M4.
