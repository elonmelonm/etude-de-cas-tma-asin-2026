# Étude de cas TMA DEP/ASIN 2026 — Prise de rendez-vous au guichet

Ce dépôt contient les livrables complets de l'étude de cas **Tierce Maintenance Applicative (TMA)** portant sur le service en ligne de prise de rendez-vous en guichet (`PASSEPORT`, `CNI`, `PERMIS`) opéré à l'heure du Bénin (`GMT+1`, sans heure d'été) :

1. **Module pur de règles de gestion** ([`src/rendezVous.ts`](src/rendezVous.ts) et [`src/index.ts`](src/index.ts)), indépendant de toute base de données et de tout framework web.
2. **Suite de tests automatisés** ([`tests/rendezVous.test.ts`](tests/rendezVous.test.ts)) rejouant chaque ticket (`TMA-101` à `TMA-107`) ainsi que les cas limites et anomalies bonus.
3. **Requêtes SQL de mesure d'impact et d'audit** ([`requetes.sql`](requetes.sql)) exécutables sur [`base_rendez_vous.sql`](base_rendez_vous.sql).
4. **Qualification, diagnostic technique, résultats d'impact SQL et section Bonus** détaillés ci-dessous.

---

## 1. Installation et exécution des tests

### Prérequis
- **Node.js** `>= 18` et **npm**

### Commandes

```bash
# 1. Installer les dépendances
npm install

# 2. Exécuter la suite de tests automatisés (Jest)
npm test

# 3. Exécuter les tests avec le rapport de couverture
npm run test:coverage

# 4. Vérifier le typage strict TypeScript
npm run typecheck
```

### Exécution des requêtes SQL sur `base_rendez_vous.sql`

Avec `sqlite3` :
```bash
sqlite3 rdv.db < base_rendez_vous.sql
sqlite3 -header -column rdv.db < requetes.sql
```

Ou via Python (`sqlite3` intégré à la bibliothèque standard) :
```bash
python3 -c "
import sqlite3
conn = sqlite3.connect(':memory:')
conn.executescript(open('base_rendez_vous.sql').read())
for i, q in enumerate([s.strip() for s in open('requetes.sql').read().split(';') if s.strip()], 1):
    print(f'=== Requête {i} ===')
    for row in conn.execute(q).fetchall():
        print(row)
"
```

---

## 2. Architecture du module de règles de gestion (`src/rendezVous.ts`)

Le module [`src/rendezVous.ts`](src/rendezVous.ts) est conçu comme un noyau métier pur (*pure domain module*) :
- **Aucune dépendance** à une base de données ou à un framework HTTP.
- **Horloge déterministe** : toutes les fonctions reçoivent la date/heure courante `maintenant` (`string | Date`) en paramètre et interprètent les dates à l'heure du Bénin (`GMT+1`).
- **Conformité stricte aux messages et codes HTTP de la Section 2** via la constante exportée `ERREURS_METIER`.

### Fonctions exposées

| Fonction | Rôle métier | Codes HTTP retournés |
| :--- | :--- | :--- |
| `prendreRendezVous(demande, rendezVousExistants, maintenant)` | Valide le NPI, le service, le format et l'existence calendaire de la date, le caractère futur, les jours ouvrés (lundi-vendredi), la grille horaire (`08:00` à `15:30` par pas de `30 min`), l'unicité du rendez-vous à venir par NPI tous services confondus, et le plafond de `3` usagers non annulés par créneau. | `201`, `400`, `409` |
| `annulerRendezVous(rendezVous, maintenant)` | Vérifie que le rendez-vous est au statut `'confirme'` et que l'écart réel total `(dateRdv - maintenant)` est d'au moins `24 heures`. | `200`, `409` |
| `changerStatutRendezVous(rendezVous, nouveauStatut, maintenant?)` | Vérifie que le statut demandé par l'agent est `'honore'` ou `'absent'` et que le rendez-vous n'est pas déjà clôturé (`'honore'`, `'absent'` ou `'annule'`). | `200`, `400`, `409` |
| `listerRendezVousUsager(rendezVous, maintenant, page?, parPage?, npi?)` | Place le prochain rendez-vous confirmé à venir en tête, trie les autres rendez-vous par ordre chronologique réel décroissant (du plus récent au plus ancien), et découpe par pages de `10`. | — |

---

## 3. Qualification et diagnostic des 7 tickets (`TMA-101` à `TMA-107`)

### Tableau récapitulatif

| Ticket | Qualification | Règle de gestion de référence (Section 2) | Code HTTP attendu | Test unitaire associé |
| :--- | :--- | :--- | :--- | :--- |
| **TMA-101** | **Anomalie** | *« Le centre accueille du lundi au vendredi, de 08 h 00 à 16 h 00. »* / *« Samedi ou dimanche -> 409 Le centre est fermé le week-end. »* | `409` | `should reject a Saturday appointment with HTTP 409 when replaying ticket TMA-101` |
| **TMA-102** | **Anomalie** | *« Le centre dispose de 3 guichets : un même créneau peut accueillir au plus 3 usagers, tous services confondus. »* | `409` | `should reject a 4th booking on the same slot with HTTP 409 when replaying ticket TMA-102` |
| **TMA-103** | **Anomalie** | *« L'usager est identifié par son NPI, composé d'exactement 10 chiffres (les zéros en tête sont significatifs). »* | `400` | `should return HTTP 400 with explicit validation message instead of 500 when NPI contains a letter (TMA-103)` |
| **TMA-104** | **Anomalie** | *« Un usager peut annuler son rendez-vous jusqu'à 24 heures avant l'heure prévue. »* | `200` | `should allow cancellation 40 hours before appointment with HTTP 200 when replaying ticket TMA-104` |
| **TMA-105** | **Anomalie** | *« Les statuts honoré, absent et annulé sont définitifs. »* / *« Rendez-vous déjà clôturé -> 409 Ce rendez-vous est déjà clôturé. »* | `409` | `should reject marking a cancelled appointment as honore with HTTP 409 when replaying ticket TMA-105` |
| **TMA-106** | **Anomalie** | *« Les rendez-vous d'un usager sont listés du plus récent au plus ancien, le prochain rendez-vous en tête, par pages de 10. »* | `200` | `should place the December 2nd upcoming appointment first and sort chronologically by page of 10 (TMA-106)` |
| **TMA-107** | **Comportement conforme** | *« Un usager ne peut avoir qu'un seul rendez-vous à venir, tous services confondus. »* | `409` | `should confirm compliant behavior by rejecting a second upcoming appointment for another service with HTTP 409 (TMA-107)` |

---

### Analyse détaillée ticket par ticket

#### Ticket `TMA-101` — Rendez-vous confirmé un samedi
- **Qualification** : **Anomalie**.
- **Règle de gestion violée (Section 2)** :
  - *« Le centre accueille du lundi au vendredi, de 08 h 00 à 16 h 00. »*
  - Table des refus : *« Samedi ou dimanche | `409` | `Le centre est fermé le week-end.` »*
- **Diagnostic technique (cause probable en production)** :
  - Le `2026-11-14` est un **samedi**. L'audit de `base_rendez_vous.sql` révèle **8 rendez-vous pris un samedi** (`IDs 475, 680, 715, 730, 742, 834, 857, 874`) et **aucun le dimanche (0)**.
  - Cela prouve que le code de production a confondu deux conventions d'indexation des jours de la semaine :
    - Une fonction retournant `0 = Lundi ... 5 = Samedi, 6 = Dimanche` (ex. `date.weekday()` en Python) a été comparée à `jour in (6, 7)` (convention ISO où `6 = Samedi, 7 = Dimanche`), bloquant uniquement le dimanche (`6`) et laissant passer le samedi (`5`).
    - Ou en JavaScript, `date.getDay()` (`0 = Dimanche ... 6 = Samedi`) a été vérifié avec `day === 0` uniquement en oubliant `day === 6`.
- **Correction apportée** :
  - Dans [`prendreRendezVous`](src/rendezVous.ts), vérification explicite `dateDemandee.jourSemaine === 0 || dateDemandee.jourSemaine === 6` (sur base `getUTCDay()` où `0 = Dimanche` et `6 = Samedi` à l'heure du Bénin), renvoyant `409` avec `"Le centre est fermé le week-end."`.
- **Test automatisé** :
  - Rejoue la requête exacte de `TMA-101` (`npi: "0614253647"`, `service: "PASSEPORT"`, `dateHeure: "2026-11-14T10:00"`) et vérifie le refus `409`.

---

#### Ticket `TMA-102` — Quatre usagers sur le même créneau
- **Qualification** : **Anomalie**.
- **Règle de gestion violée (Section 2)** :
  - *« Le centre dispose de 3 guichets : un même créneau peut accueillir au plus 3 usagers, tous services confondus. Un rendez-vous annulé libère sa place sur le créneau. »*
  - Table des refus : *« Créneau plein | `409` | `Ce créneau est complet.` »*
- **Diagnostic technique (cause probable en production)** :
  - Sur le créneau `2026-11-10 09:00:00`, 4 rendez-vous ont été enregistrés : `#632` (`PASSEPORT`), `#644` (`CNI`), `#681` (`PASSEPORT`) et `#697` (`PERMIS`, créé le `2026-11-05 08:40:17` alors que 3 rendez-vous existaient déjà depuis le `03/11` et `04/11`).
  - Par ailleurs, les 3 seuls créneaux en surnombre de toute la base (`2026-10-22 10:30`, `2026-11-10 09:00`, `2026-11-24 14:00`) comptent **exactement 4 rendez-vous** chacun (jamais 5) et panachent plusieurs services.
  - Cause : erreur d'opérateur de borne dans le contrôle de capacité avant insertion (`if (nbInscrits > 3)` au lieu de `if (nbInscrits >= 3)`), combinée ou non à un filtre erroné par `service` dans la requête de comptage.
- **Correction apportée** :
  - Dans [`prendreRendezVous`](src/rendezVous.ts), comptage de tous les rendez-vous existants sur le même créneau (`isoMinute`) dont `statut !== 'annule'`, **tous services confondus**, et rejet dès que `nbRendezVousActifsSurCreneau >= 3` avec `409` (`"Ce créneau est complet."`).
- **Test automatisé** :
  - Rejoue l'état exact du créneau `2026-11-10 09:00` avec les RDV `#632`, `#644`, `#681` et tente d'insérer le RDV `#697` (`npi: "0312573640"`, `service: "PERMIS"`) : vérifie le refus `409`.

---

#### Ticket `TMA-103` — Erreur 500 à la saisie du NPI
- **Qualification** : **Anomalie**.
- **Règle de gestion violée (Section 2)** :
  - *« L'usager est identifié par son NPI, composé d'exactement 10 chiffres (les zéros en tête sont significatifs). »*
  - Table des refus : *« NPI invalide | `400` | `Le NPI doit comporter exactement 10 chiffres.` »*
- **Diagnostic technique (cause probable en production)** :
  - L'usager a saisi `"06142A3647"` (une lettre `A` à la place du `5`). L'API a renvoyé `500 Internal Server Error` (`Erreur interne du serveur`).
  - Le backend ne validait pas le format du NPI par une expression régulière stricte avant de tenter une opération numérique (`int(npi)`, `BigInt(npi)` ou vérification `LENGTH(npi) == 10` suivie d'une conversion entière qui lève une exception non interceptée `ValueError` / `NumberFormatException` / `SyntaxError`).
- **Correction apportée** :
  - Validation en tout début de [`prendreRendezVous`](src/rendezVous.ts) via `estNpiValide` (`typeof npi === 'string' && /^\d{10}$/.test(npi)`), qui préserve les zéros en tête, rejette tout caractère non numérique et toute longueur différente de 10 avec `400` (`"Le NPI doit comporter exactement 10 chiffres."`).
- **Test automatisé** :
  - Rejoue la requête exacte de `TMA-103` avec `npi: "06142A3647"` et vérifie le retour `400` avec le message officiel.

---

#### Ticket `TMA-104` — Annulation refusée la veille
- **Qualification** : **Anomalie**.
- **Règle de gestion violée (Section 2)** :
  - *« Un usager peut annuler son rendez-vous jusqu'à 24 heures avant l'heure prévue. »*
  - Table des refus : *« Annulation tardive | `409` | `Annulation impossible moins de 24 h avant le rendez-vous.` »* (ne doit s'appliquer que si le délai restant est strictement inférieur à 24 h).
- **Diagnostic technique (cause probable en production)** :
  - Le mardi `17/11/2026 à 18 h 00`, l'usager annule le RDV `#709` prévu le jeudi `19/11/2026 à 10 h 00`. Le délai réel restant est de **40 heures** (`40 h >= 24 h`), mais le serveur refuse avec `409 Annulation impossible moins de 24 h avant le rendez-vous`.
  - Le développeur a comparé uniquement la composante « heure » ou `timedelta.seconds / 3600` sans inclure les jours complets (`timedelta.days * 24`) :
    - En Python : `(date_rdv - maintenant).seconds / 3600` vaut `16` heures (car `40 h = 1 jour + 16 heures`, et `.seconds` ignore `.days` !), et `16 < 24` déclenche à tort le refus.
    - Ou en JS : `dateRdv.getHours() - maintenant.getHours()` donne `10 - 18 = -8 < 24`.
- **Correction apportée** :
  - Dans [`annulerRendezVous`](src/rendezVous.ts), calcul de l'écart sur les timestamps complets en millisecondes : `ecartMs = dateRdv.timestampMs - horloge.timestampMs` comparé à `24 * 60 * 60 * 1000`.
- **Test automatisé** :
  - Rejoue l'annulation du RDV `#709` (`2026-11-19 10:00:00`) à `maintenant = "2026-11-17T18:00"` et vérifie le succès `200` avec passage au statut `'annule'`.

---

#### Ticket `TMA-105` — Un rendez-vous annulé apparaît comme « honoré »
- **Qualification** : **Anomalie**.
- **Règle de gestion violée (Section 2)** :
  - *« Un rendez-vous est créé au statut confirmé. Il peut ensuite passer à honoré ou absent (par un agent) ou à annulé (par l'usager). Les statuts honoré, absent et annulé sont définitifs. »*
  - Table des refus : *« Rendez-vous déjà clôturé | `409` | `Ce rendez-vous est déjà clôturé.` »*
- **Diagnostic technique (cause probable en production)** :
  - Dans `historique_statuts`, le RDV `#292` (NPI `0330677555`, créneau `2026-11-12 10:00:00`) a été annulé par l'usager le `2026-11-08 08:23:00` (`confirme -> annule`), puis modifié par l'agent `AG-04` le `2026-11-12 10:13:00` (`annule -> honore`).
  - L'endpoint `PATCH /api/rendez-vous/:id/statut` vérifiait uniquement que le nouveau statut demandé appartenait à `['honore', 'absent']` (ou bloquait uniquement `statut IN ('honore', 'absent')` en oubliant `'annule'`), sans exiger que le statut courant soit `'confirme'`.
- **Correction apportée** :
  - Dans [`changerStatutRendezVous`](src/rendezVous.ts), vérification que le statut demandé est `'honore'` ou `'absent'` (`400` sinon), puis vérification stricte `rendezVous.statut === 'confirme'` ; tout rendez-vous déjà `'annule'`, `'honore'` ou `'absent'` est rejeté avec `409` (`"Ce rendez-vous est déjà clôturé."`).
- **Test automatisé** :
  - Rejoue le `PATCH` de l'agent `AG-04` sur le RDV `#292` au statut `'annule'` vers `'honore'` à `2026-11-12T10:13` et vérifie le refus `409`.

---

#### Ticket `TMA-106` — Le rendez-vous de décembre n'apparaît pas dans « Mes rendez-vous »
- **Qualification** : **Anomalie**.
- **Règle de gestion violée (Section 2)** :
  - *« Les rendez-vous d'un usager sont listés du plus récent au plus ancien, le prochain rendez-vous en tête, par pages de 10. »*
- **Diagnostic technique (cause probable en production)** :
  - L'usager `0203040506` possède **13 rendez-vous** en base (`IDs 1 à 11, 259 et 826`), dont le RDV `#826` prévu le **`02/12/2026 08:30`** (`confirme`).
  - Or la page 1 retournée par l'API affiche dans l'ordre **9 dates** :
    `28/07/2026`, `25/09/2026`, `21/04/2026`, `19/05/2026`, `16/06/2026`, `12/02/2026`, `11/08/2026`, `08/05/2026`, `07/07/2026`.
  - On identifie **deux bugs cumulés** dans cette trace :
    1. **Tri alphabétique sur la date formatée `JJ/MM/AAAA HH:MM` et absence de mise en tête du prochain RDV** : les résultats sont triés par ordre lexicographique décroissant sur la chaîne `"JJ/MM/AAAA HH:MM"`, c'est-à-dire suivant le numéro du jour dans le mois (`28 > 25 > 21 > 19 > 16 > 12 > 11 > 08 > 07 > 05 > 03 > 02`). Le rendez-vous du **`02/12/2026`** commence par `"02/"` et se retrouve **12e sur 13** (relégué en page 2, entre `"03/03/2026"` et `"02/06/2026"`).
    2. **Erreur de borne (*off-by-one*) sur la pagination** : bien que la réponse annonce `"parPage": 10` et `"total": 13`, la trace ne renvoie que **9 éléments** sur la page 1 (le 10e élément du tri alphabétique, `05/01/2026 08:30` `#1`, est absent), typique d'un découpage erroné `liste[1:10]` (1-indexé) ou `slice(0, parPage - 1)`.
- **Correction apportée** :
  - Dans [`listerRendezVousUsager`](src/rendezVous.ts) :
    1. Conversion de chaque `dateHeure` en timestamp numérique réel (compatible ISO `AAAA-MM-JJTHH:MM`, SQL `AAAA-MM-JJ HH:MM:SS` et format français `JJ/MM/AAAA HH:MM`).
    2. Placement en tête du prochain rendez-vous à venir (`statut === 'confirme'` et `timestampMs > maintenant`).
    3. Tri des autres rendez-vous par `timestampMs` décroissant (du plus récent au plus ancien).
    4. Découpage exact par pages de `10` (`debut = (page - 1) * parPage`, `slice(debut, debut + parPage)`).
- **Test automatisé** :
  - Rejoue les 13 rendez-vous exacts du NPI `0203040506` issus de `base_rendez_vous.sql` : vérifie que la page 1 contient exactement 10 éléments avec le RDV `#826` (`2026-12-02 08:30:00`) en 1re position (`[826, 259, 11, 10, 9, 8, 7, 6, 5, 4]`) et la page 2 les 3 plus anciens (`[3, 2, 1]`).

---

#### Ticket `TMA-107` — Impossible de prendre un rendez-vous PERMIS en plus d'un rendez-vous PASSEPORT
- **Qualification** : **Comportement conforme** (il ne s'agit **pas** d'un bug).
- **Règle de gestion de référence (Section 2)** :
  - *« Un usager ne peut avoir qu'un seul rendez-vous à venir, tous services confondus. »*
  - Table des refus : *« Rendez-vous déjà à venir | `409` | `Vous avez déjà un rendez-vous à venir.` »*
- **Explication** :
  - À la date du `20/11/2026`, l'usager `0102030405` possède déjà en base le rendez-vous `#800` au statut `'confirme'` pour le service `PASSEPORT` le **`2026-11-26 10:00:00`**.
  - La règle d'unicité d'un rendez-vous à venir s'applique **tous services confondus** (et non par service). Le rejet de sa demande de rendez-vous `PERMIS` pour le `2026-11-27T09:00` avec le code `409` et le message `"Vous avez déjà un rendez-vous à venir."` est donc strictement conforme aux spécifications.
- **Test automatisé** :
  - Rejoue le scénario exact de `TMA-107` (NPI `0102030405` ayant le RDV `#800` `PASSEPORT` le `2026-11-26 10:00:00`, demandant un RDV `PERMIS` le `2026-11-27T09:00`) et vérifie que le module retourne bien `409 Vous avez déjà un rendez-vous à venir.`.

---

## 4. Mesure d'impact en base de données (`requetes.sql`)

Les requêtes sont disponibles dans [`requetes.sql`](requetes.sql). La date de référence de l'export est le **vendredi 20 novembre 2026 à 18 h 00 (GMT+1)**.

### 4.1. Rendez-vous confirmés à venir pris un samedi ou un dimanche (usagers à prévenir)

**Résultat : 5 rendez-vous à venir** (tous tombent un samedi) :

| ID | NPI | Service | Date et heure du RDV | Jour | Statut | Créé le |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **680** | `0669147625` | `PASSEPORT` | `2026-11-21 08:30:00` | Samedi | `confirme` | `2026-11-02 18:45:57` |
| **730** | `0679617916` | `CNI` | `2026-11-28 09:00:00` | Samedi | `confirme` | `2026-11-08 13:45:37` |
| **834** | `0610588823` | `CNI` | `2026-12-05 10:00:00` | Samedi | `confirme` | `2026-11-19 07:16:21` |
| **857** | `0671987446` | `PERMIS` | `2026-12-05 10:00:00` | Samedi | `confirme` | `2026-11-20 12:38:16` |
| **874** | `0648953073` | `PASSEPORT` | `2026-12-12 11:00:00` | Samedi | `confirme` | `2026-11-20 16:39:37` |

> **Note opérationnelle** : Le RDV `#680` a lieu dès le lendemain de l'export (**samedi 21 novembre 2026 à 08 h 30**), cet usager doit être contacté en priorité absolue. Par ailleurs, 3 rendez-vous pris sur des samedis **passés** (`#475` le `31/10/2026`, `#715` et `#742` le `14/11/2026`) sont restés bloqués au statut `'confirme'` en base (voir Bonus 4).

---

### 4.2. Créneaux qui comptent plus de 3 rendez-vous non annulés

**Résultat : 3 créneaux** (comptant chacun 4 rendez-vous non annulés) :

| Créneau (`date_heure`) | Nb RDV non annulés | IDs concernés | Statut des RDV |
| :--- | :--- | :--- | :--- |
| `2026-10-22 10:30:00` | **4** | `502`, `511`, `517`, `519` | Tous `honore` (passé) |
| `2026-11-10 09:00:00` | **4** | `632`, `644`, `681`, `697` | Tous `honore` (passé — cf. `TMA-102`) |
| `2026-11-24 14:00:00` | **4** | `728`, `750`, `763`, `783` | Tous `confirme` (**à venir** le mardi 24/11/2026) |

> **Note opérationnelle** : Le créneau à venir du **mardi 24 novembre 2026 à 14 h 00** (`IDs 728, 750, 763, 783`) compte 4 usagers confirmés pour 3 guichets. Le chef de centre peut soit prévoir l'ouverture ponctuelle d'un traitement prioritaire à 14 h 00, soit contacter le 4e inscrit (`#783`, NPI `0987694476`, inscrit le `13/11/2026`) pour lui proposer un créneau adjacent.

---

### 4.3. Rendez-vous passés du statut « annulé » à un autre statut

**Résultat : 4 rendez-vous** :

| ID RDV | NPI | Service | Créneau du RDV | Ancien statut | Nouveau statut | Modifié le | Modifié par | Statut actuel |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **208** | `0384914669` | `PASSEPORT` | `2026-10-07 10:00:00` | `annule` | `honore` | `2026-10-07 10:20:00` | `AG-01` | `honore` |
| **231** | `0370202195` | `PASSEPORT` | `2026-10-15 10:00:00` | `annule` | `honore` | `2026-10-15 10:26:00` | `AG-02` | `honore` |
| **262** | `0317656053` | `PERMIS` | `2026-10-29 10:00:00` | `annule` | `absent` | `2026-10-29 10:21:00` | `AG-03` | `absent` |
| **292** | `0330677555` | `PASSEPORT` | `2026-11-12 10:00:00` | `annule` | `honore` | `2026-11-12 10:13:00` | `AG-04` | `honore` |

---

## 5. Section Bonus — Anomalies non signalées découvertes dans les données et les traces

L'audit croisé de [`base_rendez_vous.sql`](base_rendez_vous.sql) et des traces HTTP a permis d'identifier **5 anomalies supplémentaires** qui n'avaient fait l'objet d'aucun ticket d'incident :

### Bonus 1 — NPI de plus de 10 chiffres enregistrés en base (11 et 12 chiffres)
- **Preuve en base (`base_rendez_vous.sql`)** :
  - RDV **`#459`** : `npi = '01234567890'` (**11 chiffres**), service `PERMIS`, créneau `2026-10-20 09:30:00`, statut `absent`.
  - RDV **`#642`** : `npi = '061425364711'` (**12 chiffres**), service `PERMIS`, créneau `2026-11-03 14:00:00`, statut `honore`.
- **Cause technique probable** :
  - La colonne SQL est définie en `VARCHAR(12)` (`npi VARCHAR(12) NOT NULL`), et la validation applicative utilisait soit `npi.length >= 10`, soit une expression régulière **non ancrée** `/\d{10}/` (sans `^` ni `$`), qui valide toute chaîne contenant une sous-séquence de 10 chiffres.
- **Protection dans le module** :
  - `estNpiValide` utilise l'expression régulière ancrée `/^\d{10}$/` et un test dédié (`should reject NPIs with 11 or 12 digits found in database audit (Bonus 1: IDs 459 and 642)`) garantit le rejet HTTP `400`.

### Bonus 2 — Créneaux réservés hors des horaires d'ouverture (`16:00` et `16:30`)
- **Preuve en base (`base_rendez_vous.sql`)** :
  - RDV **`#490`** : NPI `0004588648`, `CNI`, créneau **`2026-10-27 16:00:00`** (`honore`).
  - RDV **`#698`** : NPI `0051291680`, `PASSEPORT`, créneau **`2026-11-13 16:30:00`** (`absent`).
  - RDV **`#842`** : NPI `0387129160`, `PASSEPORT`, créneau **`2026-12-08 16:00:00`** (**`confirme` à venir** !).
- **Cause technique probable** :
  - Le centre ferme à `16 h 00` et les créneaux durent `30 minutes`, donc le dernier créneau autorisé est **`15 h 30`**. Le code de production a vérifié uniquement l'heure entière `8 <= heure <= 16` et `minute IN (0, 30)`, ce qui a autorisé par erreur `16:00` et `16:30`.
  - **Impact immédiat** : L'usager du RDV `#842` (`0387129160`) a un rendez-vous confirmé à venir le **mardi 8 décembre 2026 à 16 h 00** (heure de fermeture du centre) et doit lui aussi être prévenu !
- **Protection dans le module** :
  - Conversion de l'heure en minutes depuis minuit (`heure * 60 + minute`) et contrôle strict `480 <= minutes <= 930` (`08:00` à `15:30` inclus) avec `minute % 30 === 0`. Testé dans `should reject slots at 16:00 and 16:30 found in database audit (Bonus 2: IDs 490, 698, 842)`.

### Bonus 3 — Cumul de plusieurs rendez-vous à venir pour un même usager (51 couples en anomalie / 49 RDV créés en doublon)
- **Preuve en base (`base_rendez_vous.sql`)** :
  - Sur les 209 paires de rendez-vous partageant un même NPI (`r1.id < r2.id`), **52 paires** ont été réservées de manière chevauchante (`r1.date_heure > r2.cree_le`, c'est-à-dire que le 2e rendez-vous `r2` a été créé avant que la date du 1er rendez-vous `r1` ne soit passée).
  - En croisant avec `historique_statuts`, **1 seule paire** est légitime (`#28` et `#68` du NPI `0166114635`, car `#28` a été annulé le `2026-08-23 01:26:47` avant la réservation de `#68` le `2026-08-26 18:43:31`).
  - Les **51 autres couples** (représentant **49 rendez-vous créés en doublon** sur **47 NPI distincts**, dont 2 usagers ayant cumulé 3 rendez-vous simultanés : `0923981337` et `0819331908`) violent la règle d'unicité car `r1` était toujours au statut `'confirme'` à l'instant `r2.cree_le` :
    - Exemple 1 (impliquant un RDV encore actif à la date d'export) : le NPI `0902861159` a réservé le RDV **`#751`** le `2026-11-11 14:35:14` pour le `2026-12-01 08:00:00` (`PASSEPORT`, toujours `confirme`), puis a pu réserver le RDV **`#816`** le `2026-11-17 19:29:37` pour le `2026-11-20 11:30:00` (`PASSEPORT`) alors que `#751` était déjà confirmé à venir.
    - Exemple 2 (doublon sur le même créneau horaire) : le NPI `0536455681` possède deux rendez-vous (`#43` `PERMIS` et `#99` `PASSEPORT`) sur le **même créneau** `2026-09-01 09:30:00` !
- **Cause technique probable** :
  - La vérification d'unicité de rendez-vous à venir comportait une faille (ex. filtre sur une fenêtre de dates restreinte, ou absence de contrainte transactionnelle).
- **Protection dans le module** :
  - `prendreRendezVous` vérifie qu'aucun rendez-vous existant du même `npi` n'a `statut === 'confirme'` et `dateRdv > maintenant`, quel que soit le service ou l'éloignement de la date. De plus, `listerRendezVousUsager` gère proprement les données historiques ayant plusieurs RDV à venir en plaçant le plus proche en premier.

### Bonus 4 — Rendez-vous passés du samedi restés bloqués au statut `'confirme'` (blocage permanent des usagers)
- **Preuve en base (`base_rendez_vous.sql`)** :
  - Trois rendez-vous pris sur des samedis **passés** avant le `20/11/2026` sont toujours au statut `'confirme'` :
    - RDV **`#475`** (`NPI 0610057414`, samedi `2026-10-31 09:00:00`)
    - RDV **`#715`** (`NPI 0600820256`, samedi `2026-11-14 11:30:00`)
    - RDV **`#742`** (`NPI 0614253647`, samedi `2026-11-14 10:00:00` — l'usager du ticket `TMA-101` !)
- **Cause technique et risque** :
  - Comme aucun agent ne travaille le samedi, aucun agent n'a clôturé ces rendez-vous en `'honore'` ou `'absent'`.
  - Si la règle *« Un usager ne peut avoir qu'un seul rendez-vous à venir »* était implémentée naïvement par `WHERE npi = ? AND statut = 'confirme'` **sans vérifier `date_heure > maintenant`**, ces 3 usagers (dont la plaignante de `TMA-101`) seraient **bloqués à vie** et ne pourraient plus jamais reprendre de rendez-vous !
- **Protection dans le module** :
  - Tant dans `prendreRendezVous` que dans `listerRendezVousUsager`, un rendez-vous « à venir » est défini par `statut === 'confirme' && dateRdv.timestampMs > horloge.timestampMs`. Testé explicitement par `should not block a user whose past Saturday appointment remained stuck in confirme status (Bonus 4: ID 742)`.

### Bonus 5 — Incohérence de sérialisation des dates (`JJ/MM/AAAA HH:MM` vs ISO `AAAA-MM-JJTHH:MM`)
- **Preuve dans les traces (`TMA-101` et `TMA-106`)** :
  - Alors que l'API exige `AAAA-MM-JJTHH:MM` en entrée (`"2026-11-14T10:00"`), la réponse JSON de création (`TMA-101`) et de liste (`TMA-106`) retourne `"dateHeure": "14/11/2026 10:00"` (format français `JJ/MM/AAAA HH:MM`).
  - C'est cette transformation prématurée en chaîne `JJ/MM/AAAA HH:MM` avant le tri qui a provoqué le bug `TMA-106` (tri alphabétique sur le jour `JJ`).
- **Protection dans le module** :
  - Le module conserve et retourne un format ISO canonique (`AAAA-MM-JJTHH:MM`) à la création, tout en étant capable en lecture (`modeStrictIso = false`) d'interpréter aussi bien l'ISO (`2026-12-02T08:30`), le format SQL (`2026-12-02 08:30:00`) que le format français historique (`02/12/2026 08:30`).

