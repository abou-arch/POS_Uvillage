# Contrat d'API — Caisse (POS) ↔ Application web

Version 0.6 — proposition à valider par l'équipe.

Changements par version :

- **0.6** : droits du caissier et autorisation d'un responsable.
  - §2 : plafond de remise d'un caissier, par magasin (`cashier_max_discount_percent`, `cashier_max_discount`).
  - Nouveau §11 : opérations qu'un caissier ne fait pas seul. Un responsable les autorise avec son code PIN, vérifié par la caisse même hors ligne grâce à l'empreinte téléchargée par `GET /api/stores/{store_id}/approvers`.
  - §5, §9, §10 : champ `approved_by` (qui a autorisé) dans la vente, le mouvement d'espèces, la clôture et le retour.
  - §8 : le point 5 est tranché. Nouveau point 10 (PIN des responsables).
- 0.5 : retours et remboursements.
  - Nouveau §10 : `POST /api/refunds`, idempotent, envoyé par la même file que les ventes.
  - §5 : chaque ligne de vente a un `id`. Nouvel endpoint `GET /api/sales/by-number/{number}` pour retrouver une vente et ses retours. Une vente qui a des retours ne peut plus être annulée.
  - §7 : règle du montant remboursé, à valider avec le comptable.
  - §9 : les remboursements sont déduits des montants attendus à la clôture. L'attendu et le compté de la carte et du mobile peuvent être négatifs.
  - §8 : deux nouveaux points à trancher (8 et 9).
- 0.4 : sessions de caisse (nouveau §9) : ouverture avec fond de caisse, entrées et sorties d'espèces, clôture avec, pour chaque moyen de paiement, l'attendu, le compté et l'écart, et le détail facultatif du comptage des espèces. Seuil d'écart de clôture par magasin, dans la réponse du login (§2). `session_id` obligatoire dans chaque vente et `session_closed` dans la réponse (§5). Ordre d'envoi des opérations faites hors ligne (§9). Nouveau point à trancher (§8, point 7).
- 0.3 : la TVA des autres charges et de la remise globale est répartie par taux (§7).
- 0.2 : les clients sont identifiés par leur matricule universitaire au lieu de l'ICE (§4).

La caisse (POS) est développée séparément de l'application web (back-office). Ce document fixe ce que la caisse attend de l'API, pour que les deux parties avancent en parallèle. La caisse fonctionne d'abord sur une fausse API (`mock-api/`) qui respecte exactement ce contrat.

## 1. Conventions

| Sujet | Règle |
|---|---|
| Base URL | `/api` |
| Format | JSON, UTF-8 |
| Authentification | En-tête `Authorization: Bearer <token>` sur toutes les routes sauf `/auth/login` |
| Montants | **Entiers en centimes de dirham** (`1250` = 12,50 MAD). Jamais de flottants pour l'argent. |
| Prix des articles | Stockés **TTC**. Le HT et la TVA sont recalculés à partir du taux. |
| Taux de TVA | Pourcentage entier par article (`20`, `14`, `10`, `7`, `0`). Liste exacte à confirmer avec le comptable du client. |
| Quantités | Décimales autorisées (articles au poids), 3 décimales max. |
| Dates | ISO 8601 en UTC (`2026-10-05T14:32:10Z`). |
| Identifiants des ventes, lignes de vente, retours, sessions de caisse et mouvements d'espèces | **UUID v4 générés par la caisse** (indispensable pour le hors ligne). |
| Langues | Les libellés ont une version FR et une version AR facultative. |

### Format d'erreur

```json
{ "error": { "code": "STOCK_INSUFFICIENT", "message": "Stock insuffisant pour IT0006", "details": {} } }
```

Codes HTTP : `400` données invalides · `401` non connecté · `403` interdit · `404` introuvable · `409` conflit · `422` règle métier.

## 2. Authentification

### `POST /api/auth/login`

```json
// Requête
{ "username": "caissier1", "password": "••••" }

// Réponse 200
{
  "token": "eyJ...",
  "user": { "id": "u_12", "name": "Falcon", "role": "cashier" },
  "stores": [
    {
      "id": "st_1",
      "name": "Magasin centre",
      "closing_difference_threshold": 2000,
      "cashier_max_discount_percent": 10,
      "cashier_max_discount": 5000,
      "registers": [ { "id": "reg_1", "name": "Caisse 1" } ]
    }
  ]
}
```

Rôles attendus côté caisse : `admin`, `manager`, `cashier`. Un caissier ne voit que les magasins auxquels il est rattaché.

`closing_difference_threshold` : écart de clôture autorisé dans ce magasin, en centimes (entier ≥ 0). Au-delà, un caissier ne peut pas valider seul la clôture de sa session (§9). La caisse garde cette valeur avec la connexion, pour s'en servir hors ligne.

`cashier_max_discount_percent` (entier de 0 à 100) et `cashier_max_discount` (centimes, entier ≥ 0) : remise qu'un caissier peut faire seul dans ce magasin, sur une ligne ou sur la vente. `null` veut dire qu'il n'y a pas de plafond de ce type. Au-delà de l'un des deux, il faut l'autorisation d'un responsable (§11). La caisse garde ces valeurs avec la connexion, comme le seuil d'écart.

## 3. Catalogue (lecture seule pour la caisse)

### `GET /api/categories`

```json
[ { "id": "cat_3", "name": "Sauces", "name_ar": "صلصات" } ]
```

### `GET /api/brands`

```json
[ { "id": "br_1", "name": "Oraimo" } ]
```

### `GET /api/products?store_id=st_1&updated_since=2026-10-01T00:00:00Z`

`updated_since` est facultatif : il permet à la caisse de ne télécharger que les changements (synchronisation hors ligne).

```json
[
  {
    "id": "p_6",
    "code": "IT0006",
    "barcode": "6111234567890",
    "name": "MILLE FEUILLE",
    "name_ar": null,
    "category_id": "cat_1",
    "brand_id": null,
    "price_ttc": 100,
    "tva_rate": 20,
    "image_url": "https://…/mille-feuille.jpg",
    "stock": 4504,
    "stock_alert": 10,
    "expiry_date": "2025-09-26",
    "active": true,
    "updated_at": "2026-10-04T10:00:00Z"
  }
]
```

`stock` est le stock **du magasin demandé**. Un article désactivé est renvoyé avec `active: false` pour que la caisse le retire de son cache.

## 4. Clients

Les clients de l'université sont identifiés par leur **matricule** : chiffres seulement (zéros du début compris), 10 chiffres au plus en général, 15 au maximum. `matricule` et `phone` sont facultatifs (`null`). Le téléphone est envoyé au format international (`+212…`).

### `GET /api/customers?search=ahmed`

`search` porte sur le nom, le téléphone et le matricule.

```json
[ { "id": "c_8", "name": "Ahmed", "phone": "+212600000000", "matricule": "2023001542" } ]
```

Le « client de passage » n'est pas un client en base : la vente a simplement `customer_id: null`.

### `POST /api/customers`

```json
// Requête : id UUID v4 généré par la caisse
{ "id": "7f3c2a9e-1b4d-4c8e-9f21-3a5b6c7d8e9f", "name": "Nouveau client", "phone": "+212600000001", "matricule": "2024000187" }
// Réponse 201 : le client créé (l'id envoyé par la caisse est conservé)
```

## 5. Ventes

### `POST /api/sales`

Crée une vente. **Idempotent** : si une vente avec le même `id` existe déjà, l'API renvoie `200` avec `"status": "duplicate"` au lieu de la créer une deuxième fois (essentiel quand la caisse renvoie une vente après une coupure).

```json
{
  "id": "0f8b7c2e-5c1d-4c6e-9a4b-2f1e3d4c5b6a",
  "number": "ST1-REG1-000123",
  "store_id": "st_1",
  "register_id": "reg_1",
  "session_id": "3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f",
  "cashier_id": "u_12",
  "approved_by": null,
  "customer_id": null,
  "created_at": "2026-10-05T14:32:10Z",
  "lines": [
    {
      "id": "5d2e8f1a-7b3c-4e9d-8a6f-1c2b3d4e5f60",
      "product_id": "p_6",
      "name": "MILLE FEUILLE",
      "quantity": 2,
      "unit_price_ttc": 100,
      "discount": 0,
      "tva_rate": 20,
      "total_ht": 167,
      "total_tva": 33,
      "total_ttc": 200
    }
  ],
  "other_charges": 0,
  "global_discount": 0,
  "totals": { "ht": 167, "tva": 33, "ttc": 200 },
  "payments": [ { "method": "cash", "amount": 200 } ],
  "amount_received": 200,
  "change_given": 0,
  "send_sms": false,
  "status": "completed"
}
```

Règles :

- `method` ∈ `cash`, `card`, `mobile`, `credit` (vente à crédit, alimente « ventes dues »).
- La somme des `payments` peut être inférieure au total uniquement si le reste est en `credit` et qu'un `customer_id` est renseigné.
- L'API décrémente le stock du magasin `store_id`.
- Une vente créée hors ligne peut arriver en retard. Si le stock devient négatif, l'API **accepte la vente** et la signale (`stock_warning: true`), au lieu de la refuser : la vente a déjà eu lieu.
- `number` est le numéro de ticket généré par la caisse (`magasin-caisse-compteur`), lisible par le client.
- `lines[].id` : UUID v4 généré par la caisse, différent pour chaque ligne de la vente. Un retour (§10) vise ainsi une ligne précise, même quand le même article figure sur deux lignes.
  - Les ventes envoyées avant la version 0.5 n'ont pas d'`id` de ligne : l'API les accepte toujours. Pour elles, une ligne se repère à sa position dans `lines` (0 pour la première).
- `session_id` (obligatoire) : la session de caisse ouverte au moment de la vente (§9).
  - Une session d'un autre magasin ou d'une autre caisse est refusée (`422 SESSION_MISMATCH`).
  - Une session inconnue de l'API est refusée (`422 SESSION_UNKNOWN`).
  - Si la session est déjà clôturée, l'API **accepte la vente** et la signale (`session_closed: true`), car la vente a eu lieu. Ce cas n'arrive que pour une vente refusée puis renvoyée après la clôture (§9).
- `approved_by` : le responsable qui a autorisé une remise au-delà du plafond du caissier (§11), ou `null`.

Réponse `201` (ou `200` si déjà reçue) :

```json
{ "id": "0f8b7c2e-…", "status": "created", "stock_warning": false, "session_closed": false }
```

### `POST /api/sales/batch`

Même format, avec `{ "sales": [ … ] }`. Utilisé pour vider la file d'attente des ventes faites hors ligne. Réponse : un résultat par vente.

```json
{
  "results": [
    { "id": "0f8b…", "status": "created", "stock_warning": false, "session_closed": false },
    { "id": "a1c2…", "status": "duplicate" },
    { "id": "c3d4…", "status": "error", "error": { "code": "SESSION_UNKNOWN", "message": "Session de caisse inconnue", "details": {} } }
  ]
}
```

### `GET /api/sales/by-number/{number}`

Retrouve une vente par son numéro de ticket (saisi ou scanné sur la caisse), pour faire un retour (§10).

Réponse `200` :

```json
{
  "sale": { "id": "0f8b7c2e-…", "number": "ST1-REG1-000123", "store_id": "st_1", "lines": [ … ], "status": "completed", … },
  "customer": { "id": "c_1", "name": "Ahmed Benali" },
  "refunds": [ { "id": "7e4a…", "number": "R-ST1-REG1-000004", "lines": [ … ], "payments": [ … ], … } ]
}
```

- `sale` : la vente telle que reçue (format de `POST /api/sales`), avec son `status` (`completed` ou `cancelled`).
- `customer` : le client de la vente (`id` et `name`), ou `null`.
- `refunds` : les retours de cette vente déjà reçus par l'API, de toutes les caisses, au format du §10. La liste est vide s'il n'y en a pas.
- Vente inconnue, ou d'un magasin qui n'est pas dans les `store_ids` de l'utilisateur → `404 NOT_FOUND`.

Hors ligne, la caisse ne retrouve que les ventes faites sur ce poste. Elle ne voit pas non plus les retours faits sur d'autres caisses et pas encore reçus : l'API refuse alors le retour en trop (§10).

### `POST /api/sales/{id}/cancel`

Annule une vente (rôle `manager` ou `admin`) et remet le stock. Une vente qui a déjà au moins un retour (§10) ne peut plus être annulée (`422 SALE_REFUNDED`).

## 6. Ce qui reste côté caisse uniquement

- Les ventes **en attente** (bouton Hold / liste d'attente) restent dans la caisse et ne sont envoyées qu'une fois payées.
- Le cache du catalogue et la file d'attente des ventes hors ligne (IndexedDB).
- Le ticket 80 mm (impression navigateur).
- Le rapport de session (rapport X pendant la session, rapport de clôture) : calculé et imprimé par la caisse à partir de ses propres ventes, retours et mouvements, rien n'est envoyé en plus de ce que décrit le §9.

## 7. Calcul HT / TVA / TTC (référence commune)

Pour chaque ligne, à partir du prix TTC :

```
total_ttc = round(quantity × unit_price_ttc) − discount
total_ht  = round(total_ttc × 100 / (100 + tva_rate))
total_tva = total_ttc − total_ht
```

Les totaux de la vente (`totals`) se calculent **par taux de TVA**, comme le récapitulatif imprimé sur le ticket :

1. TTC du taux = somme des `total_ttc` des lignes de ce taux.
2. `other_charges − global_discount` est réparti entre les taux au prorata de ces TTC, au centime près (méthode des plus forts restes). Si le TTC des lignes est nul, tout va sur le taux le plus élevé.
3. Pour chaque taux : `ht = round(ttc × 100 / (100 + taux))`, puis `tva = ttc − ht`.
4. `totals` = somme des taux. On a donc toujours HT + TVA = TTC.

Exemple : 10 DH à 20 % + 5 DH à 0 %, remise globale de 3 DH → 2 DH de remise sur le 20 % (TTC 8,00 = HT 6,67 + TVA 1,33) et 1 DH sur le 0 % (TTC 4,00) → totaux HT 10,67, TVA 1,33, TTC 12,00.

Règle proposée, **à valider avec le comptable**. Implémentation de référence : `src/lib/totals.js` (`vatBreakdown`, `saleTotals`), utilisée par la caisse et par la fausse API. La caisse et l'API doivent utiliser **la même règle d'arrondi** ; l'API recalcule et refuse une vente dont les totaux (HT, TVA ou TTC) diffèrent de plus d'1 centime (`422 TOTALS_MISMATCH`).

### Montant remboursé lors d'un retour

Règle proposée, **à valider avec le comptable**. Une ligne retournée rend sa part du TTC réellement payé, c'est-à-dire après sa remise de ligne et sa part de la remise globale et des autres charges.

1. **Payé de chaque ligne.** La part de chaque taux dans `other_charges − global_discount` est celle de l'étape 2 ci-dessus. Elle est répartie entre les lignes de ce taux au prorata de leur `total_ttc`, au centime près (plus forts restes ; à TTC nul, tout va sur la première ligne du taux).
   - `payé = total_ttc + part de la ligne`.
   - La somme des payés est égale à `totals.ttc` de la vente.
2. **Remboursement, au prorata de la quantité.** Soit `Q` la quantité vendue sur la ligne, `r` la quantité déjà retournée avant ce retour, et `q` la quantité retournée maintenant :
   ```
   total_ttc = round(payé × (r + q) / Q) − round(payé × r / Q)
   ```
   - Les arrondis ne s'accumulent pas : quand toute la quantité est retournée, en un ou plusieurs retours, la somme remboursée sur la ligne est exactement le payé, jamais 1 centime de plus.
   - Les quantités ont jusqu'à 3 décimales : le calcul se fait en millièmes, sur des entiers.
3. **HT et TVA** du remboursement avec le taux de la ligne d'origine : `total_ht = round(total_ttc × 100 / (100 + tva_rate))`, `total_tva = total_ttc − total_ht`.
   - Sur plusieurs retours d'une même ligne, la somme des HT peut différer d'1 centime du HT de la vente pour chaque retour. Le TTC, lui, tombe juste.

Exemple : 3 articles à 10 DH (20 %) et une remise globale de 1 DH, payés 29 DH. Retour d'1 article : `round(2900 × 1/3) = 967`, soit 9,67 DH. Retour des 2 autres : `2900 − 967 = 1933`, soit 19,33 DH. Total remboursé : 29,00 DH.

Implémentation de référence : `src/lib/totals.js` (`paidByLine`, `refundLine`), utilisée par la caisse et par la fausse API.

## 8. Points à trancher en équipe

1. Stack et hébergement de l'API (et l'URL de l'environnement de test).
2. Liste exacte des taux de TVA et mentions obligatoires du ticket (ICE…) — avec le comptable.
3. Format de `number` (numérotation continue par caisse ?).
4. SMS : qui l'envoie (API à la réception de la vente si `send_sms: true`) ?
5. ~~Remise : plafond autorisé pour un caissier ?~~ Tranché en 0.6 : plafond en % et en DH par magasin (§2), autorisation d'un responsable au-delà (§11).
6. Matricule : unique par client ? Si oui, l'API refuse un doublon (`409`).
7. Sessions de caisse : clôture d'une session depuis le back-office (poste en panne, données du poste effacées).
8. Retours : un article retourné comme défectueux est-il remis dans le stock vendable ? Pour l'instant, l'API remet le stock de tout article retourné (§10).
9. Retours à crédit : si le client a déjà réglé sa dette, un retour en `credit` la rend négative. Faut-il alors rembourser en espèces ?
10. PIN des responsables (§11) : qui le fixe et le change dans le back-office ? Longueur (6 chiffres proposés) ? Changement obligatoire au départ d'un responsable ?

## 9. Sessions de caisse

Chaque caisse travaille dans une **session** : elle est ouverte avec un fond de caisse et clôturée en comptant, pour chaque moyen de paiement, ce qui a été réellement encaissé (espèces du tiroir, total du terminal de carte, total du paiement mobile). **Une seule session ouverte par caisse.** Chaque vente (§5) et chaque mouvement d'espèces porte le `session_id` de la session ouverte.

`opened_by`, `closed_by`, `cashier_id` (ventes) et `created_by` (mouvements) désignent l'utilisateur qui a fait l'opération sur la caisse. Il peut être différent de l'utilisateur du token : après une reconnexion, la caisse envoie aussi les opérations faites avant par un autre caissier. Tous les rôles peuvent ouvrir, faire un mouvement et clôturer. Un caissier a besoin de l'autorisation d'un responsable pour une sortie d'espèces et pour une clôture avec un écart au-delà du seuil du magasin (§11).

### Objet session

```json
{
  "id": "3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f",
  "store_id": "st_1",
  "register_id": "reg_1",
  "status": "open",
  "opened_by": "u_12",
  "opened_at": "2026-11-12T08:02:00Z",
  "opening_cash": 50000,
  "opening_note": null,
  "closed_by": null,
  "approved_by": null,
  "closed_at": null,
  "counts": null,
  "cash_count": null,
  "closing_note": null
}
```

`status` ∈ `open`, `closed`. Les champs de clôture valent `null` tant que la session est ouverte.

### `GET /api/cash-sessions/current?register_id=reg_1`

Session ouverte sur cette caisse, ou `null` :

```json
{ "session": { "id": "3b9d6c1e-…", "status": "open", "opened_by": "u_12", "opened_at": "2026-11-12T08:02:00Z", … } }
```

La caisse l'appelle quand elle est en ligne, avant de proposer l'ouverture. Si une session est déjà ouverte sur cette caisse et que le poste ne la connaît pas (ouverte sur un autre poste, ou données du poste effacées), la caisse n'en ouvre pas une deuxième.

### `POST /api/cash-sessions` — ouverture

```json
{
  "id": "3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f",
  "store_id": "st_1",
  "register_id": "reg_1",
  "opened_by": "u_12",
  "opened_at": "2026-11-12T08:02:00Z",
  "opening_cash": 50000,
  "opening_note": null
}
```

Règles :

- **Idempotent** : même `id` déjà reçu → `200` avec `"status": "duplicate"`, rien n'est modifié.
- `opening_cash` : entier ≥ 0. `opening_note` : facultative (`null`), 200 caractères au plus. Sinon `400`.
- `register_id` doit appartenir à `store_id` (`422 REGISTER_MISMATCH`).
- Une autre session (autre `id`) est déjà ouverte sur cette caisse → `409 SESSION_ALREADY_OPEN`, avec `details: { "session_id": "…" }`.

Réponse `201` :

```json
{ "id": "3b9d6c1e-…", "status": "created" }
```

### `POST /api/cash-movements` — entrée ou sortie d'espèces

Argent mis dans le tiroir ou retiré hors vente (achat de fournitures, dépôt en banque, appoint de monnaie…).

```json
{
  "id": "9a1c4e7b-2d3f-4b8a-8c6d-5e4f3a2b1c0d",
  "session_id": "3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f",
  "type": "out",
  "amount": 5000,
  "reason": "Achat de sacs plastique",
  "created_by": "u_12",
  "approved_by": "u_3",
  "created_at": "2026-11-12T11:15:00Z"
}
```

Règles :

- **Idempotent** : même `id` déjà reçu → `200` avec `"status": "duplicate"`.
- `type` ∈ `in` (entrée), `out` (sortie). `amount` : entier > 0. `reason` : obligatoire, non vide, 200 caractères au plus. Sinon `400`.
- `approved_by` : le responsable qui a autorisé une sortie faite par un caissier (§11), ou `null`.
- Session inconnue → `422 SESSION_UNKNOWN`. Session déjà clôturée : le mouvement est **accepté** et signalé (`session_closed: true`), comme une vente.

Réponse `201` (ou `200` si déjà reçu) :

```json
{ "id": "9a1c4e7b-…", "status": "created", "session_closed": false }
```

### `POST /api/cash-sessions/{id}/close` — clôture

```json
{
  "closed_by": "u_12",
  "approved_by": null,
  "closed_at": "2026-11-12T20:30:00Z",
  "counts": [
    { "method": "cash",   "expected": 57000, "counted": 56000, "difference": -1000 },
    { "method": "card",   "expected": 8000,  "counted": 8000,  "difference": 0 },
    { "method": "mobile", "expected": 0,     "counted": 0,     "difference": 0 }
  ],
  "cash_count": [
    { "value": 20000, "quantity": 2 },
    { "value": 10000, "quantity": 1 },
    { "value": 5000,  "quantity": 1 },
    { "value": 1000,  "quantity": 1 }
  ],
  "closing_note": "Erreur de rendu probable"
}
```

Règles :

- **Idempotent** : session déjà clôturée → `200` avec `"status": "duplicate"`, rien n'est modifié.
- Session inconnue → `404 NOT_FOUND`.
- `counts` : une entrée et une seule pour chacun des moyens `cash`, `card` et `mobile`. Les ventes à crédit n'y figurent pas : aucun argent n'a été reçu. Sinon `400`.
  - `expected` et `counted` sont des entiers ≥ 0 pour `cash`.
  - Pour `card` et `mobile`, ce sont des entiers qui peuvent être négatifs : une session peut rembourser par carte plus qu'elle n'a encaissé (§10), et le total du terminal est alors négatif.
- `difference = counted − expected` pour chaque moyen : négatif = il manque de l'argent. Sinon `422 DIFFERENCE_MISMATCH`.
- `cash_count` : détail facultatif du comptage des espèces, billet par billet et pièce par pièce. Il vaut `null` si le caissier a saisi le total directement.
  - Sinon c'est une liste de `{ "value", "quantity" }` : `value` en centimes (entier > 0, chaque valeur une seule fois) et `quantity` entier ≥ 0. Sinon `400`.
  - La somme des `value × quantity` doit être égale au `counted` des espèces. Sinon `422 CASH_COUNT_MISMATCH`.
  - La liste des billets et pièces est choisie par la caisse : l'API accepte toute valeur positive.
- `closing_note` est obligatoire dès qu'un écart est différent de 0 (`422 CLOSING_NOTE_REQUIRED`). Elle est facultative sinon (`null`). 200 caractères au plus.
- **Seuil d'écart** : si l'écart d'un moyen de paiement dépasse, en valeur absolue, le `closing_difference_threshold` du magasin (§2), la caisse ne laisse valider la clôture qu'à un `manager` ou un `admin`, ou à un caissier avec l'autorisation d'un responsable (`approved_by`, §11). L'API ne refait pas ce contrôle et enregistre la clôture telle quelle, car le seuil a pu changer depuis une clôture faite hors ligne.
- `approved_by` : le responsable qui a autorisé la clôture d'un caissier au-delà du seuil (§11), ou `null`.
- Les montants `expected` sont calculés par la caisse (formules ci-dessous). L'API les recalcule avec ce qu'elle a reçu. Si l'un d'eux diffère (par exemple pour une vente encore refusée sur la caisse), l'API **accepte la clôture** et la signale (`expected_mismatch: true`) : la clôture a eu lieu, l'écart est à examiner au back-office.

Réponse `200` :

```json
{ "id": "3b9d6c1e-…", "status": "closed", "expected_mismatch": false }
```

### Montants attendus

```
espèces : expected = opening_cash
                   + somme des paiements "cash" des ventes de la session
                   − somme des remboursements "cash" des retours de la session
                   + somme des mouvements "in" − somme des mouvements "out"
carte   : expected = paiements "card" des ventes − remboursements "card" des retours de la session
mobile  : expected = paiements "mobile" des ventes − remboursements "mobile" des retours de la session
```

Un retour compte dans la session où il est fait, même si la vente d'origine est d'une autre session. Les remboursements `credit` n'y figurent pas : aucun argent ne sort. La caisse refuse un remboursement en espèces supérieur aux espèces attendues dans le tiroir, comme une sortie : l'attendu des espèces ne devient donc jamais négatif.

Le montant d'un paiement `cash` (§5) est déjà net du rendu de monnaie. Par exemple, un client qui donne 200 DH pour 120 DH donne `payments: [{ "method": "cash", "amount": 12000 }]`, et 120 DH restent dans le tiroir.

Exemple :

- fond de 500 DH ;
- vente de 120 DH en espèces (le client donne 200 DH) ;
- vente de 80 DH par carte ;
- sortie de 50 DH.

Montants attendus : 570 DH en espèces, 80 DH par carte et 0 DH en mobile. Si on compte 560 DH d'espèces, l'écart est de −10 DH et une note est obligatoire.

### Envoi hors ligne

Tout se fait sans connexion. La caisse garde l'ouverture, les ventes, les retours (§10), les mouvements et la clôture dans **une seule file**, et les envoie **dans l'ordre où ils ont été faits**. Les ventes qui se suivent partent ensemble par `POST /api/sales/batch`.

L'API reçoit donc toujours l'ouverture d'une session avant ses ventes, retours et mouvements, et sa clôture en dernier. Elle reçoit aussi une vente faite sur ce poste avant ses retours. Seule exception : une opération refusée puis renvoyée plus tard, d'où les règles `session_closed` et `expected_mismatch` ci-dessus.

Toutes ces routes sont idempotentes : la caisse peut renvoyer la même opération autant de fois que nécessaire après une coupure, elle n'est enregistrée qu'une fois.

## 10. Retours et remboursements

Un client rapporte tout ou partie des articles d'une vente. La caisse retrouve la vente par son numéro de ticket (§5), le caissier choisit les quantités retournées et le motif, puis rembourse. Un retour est un document à part : la vente d'origine n'est pas modifiée.

L'exemple ci-dessous reprend celui du §7 : 1 des 3 jus vendus à 10 DH, sur une vente avec 1 DH de remise globale, payée en espèces.

### `POST /api/refunds`

```json
{
  "id": "7e4a2c1b-9d8f-4e6a-b5c3-2a1b0c9d8e7f",
  "number": "R-ST1-REG1-000004",
  "store_id": "st_1",
  "register_id": "reg_1",
  "session_id": "3b9d6c1e-8f2a-4d5b-9c7e-1a2b3c4d5e6f",
  "original_sale_id": "0f8b7c2e-5c1d-4c6e-9a4b-2f1e3d4c5b6a",
  "cashier_id": "u_12",
  "approved_by": "u_3",
  "customer_id": null,
  "created_at": "2026-11-12T16:05:00Z",
  "reason": "defective",
  "reason_text": null,
  "lines": [
    {
      "original_line_id": "a3c5e7f9-1b2d-4f6a-8c0e-2d4f6a8c0e1b",
      "line_index": 0,
      "product_id": "p_9",
      "name": "JUS D'ORANGE 1L",
      "quantity": 1,
      "unit_price_ttc": 1000,
      "tva_rate": 20,
      "total_ht": 806,
      "total_tva": 161,
      "total_ttc": 967
    }
  ],
  "totals": { "ht": 806, "tva": 161, "ttc": 967 },
  "payments": [ { "method": "cash", "amount": 967 } ]
}
```

Règles :

- **Idempotent** : même `id` déjà reçu → `200` avec `"status": "duplicate"`, rien n'est modifié.
- `number` : numéro du retour généré par la caisse. Même logique que les tickets de vente (§5), précédé de `R-`, avec un compteur à part par caisse.
- `original_sale_id` : la vente d'origine.
  - Vente inconnue de l'API → `422 SALE_UNKNOWN`.
  - Vente annulée → `422 SALE_CANCELLED`.
  - Vente d'un autre magasin que `store_id` → `422 STORE_MISMATCH` : un article se retourne dans le magasin où il a été acheté.
- `session_id` : la session ouverte au moment du retour, avec les mêmes règles que pour une vente (§5) : `SESSION_MISMATCH`, `SESSION_UNKNOWN`, et `session_closed: true` si elle est déjà clôturée.
- `customer_id` : le client de la vente d'origine, repris tel quel (`null` s'il n'y en a pas). Sinon `422 CUSTOMER_MISMATCH`.
- `approved_by` : le responsable qui a autorisé un retour fait par un caissier (§11), ou `null`.
- `reason` ∈ `defective` (défectueux), `cashier_error` (erreur de caisse), `changed_mind` (changement d'avis), `other` (autre).
  - `reason_text` est obligatoire pour `other`, facultatif (`null`) sinon. 200 caractères au plus. Sinon `400`.
- `lines` : au moins une ligne. Chaque ligne de la vente d'origine apparaît au plus une fois. Sinon `400`.
  - `line_index` : position de la ligne dans les `lines` de la vente d'origine (0 pour la première), toujours renseigné.
  - `original_line_id` : l'`id` de cette ligne, ou `null` pour une vente envoyée avant la version 0.5 (§5). S'il ne correspond pas à `line_index`, l'API refuse (`422 LINE_MISMATCH`).
  - `product_id`, `name`, `unit_price_ttc` et `tva_rate` sont ceux de la ligne d'origine.
  - `quantity` : > 0, 3 décimales au plus. Elle ne doit pas dépasser ce qui reste à retourner sur la ligne : la quantité vendue moins les retours déjà reçus, de toutes les caisses. Sinon `422 RETURN_EXCEEDS`, avec `details: { "line_index": 0, "remaining": 2 }`.
  - `total_ht`, `total_tva`, `total_ttc` : calculés avec la règle du §7 (« Montant remboursé lors d'un retour »).
- L'API recalcule chaque ligne à partir des retours qu'elle a déjà reçus et refuse un écart de plus d'1 centime (`422 TOTALS_MISMATCH`).
  - Cette tolérance couvre deux retours de la même ligne faits hors ligne sur deux caisses, qui ne se voyaient pas.
  - Dans tous les cas, l'API refuse qu'une ligne rende au total plus que son payé (`422 TOTALS_MISMATCH`).
- `totals` = somme des lignes. Même contrôle à 1 centime près.
- `payments` : comment l'argent est rendu. La somme des `amount` (entiers > 0) est égale à `totals.ttc`. Sinon `400`.
  - `method` ∈ `cash`, `card`, `mobile`, `credit`.
  - `credit` réduit ce que le client doit. Il n'est accepté que si la vente d'origine avait un paiement `credit`, et jusqu'à ce montant moins le crédit déjà remboursé sur cette vente. Sinon `422 CREDIT_EXCEEDED`.
  - La caisse propose par défaut :
    - d'abord la part à crédit de la vente qui n'a pas encore été remboursée ;
    - le reste avec le moyen de paiement de la vente, ou en espèces si la vente a été payée de plusieurs façons.
    - Le caissier peut changer le moyen, sauf vers `credit` quand la règle ci-dessus l'interdit.
- L'API **remet en stock** les quantités retournées dans le magasin `store_id` (voir §8, point 8).

Réponse `201` (ou `200` si déjà reçu) :

```json
{ "id": "7e4a2c1b-…", "status": "created", "session_closed": false }
```

Hors ligne, le retour part dans la file de la caisse, dans l'ordre, comme les ventes (§9, « Envoi hors ligne »). Pour calculer ce qui reste à retourner, la caisse compte les retours connus de l'API et ses propres retours encore dans la file.

## 11. Autorisation d'un responsable

Certaines opérations faites par un utilisateur `cashier` demandent l'accord d'un responsable : un `manager` ou un `admin` rattaché au magasin, qui tape son code PIN sur la caisse. Un `manager` ou un `admin` connecté fait ces opérations sans autorisation.

| Opération faite par un caissier | Qui l'a autorisée est enregistré dans |
|---|---|
| Vente avec une remise au-delà du plafond du magasin (§2) | `approved_by` de la vente (§5) |
| Retour, quel qu'il soit | `approved_by` du retour (§10) |
| Sortie d'espèces | `approved_by` du mouvement (§9) |
| Clôture avec un écart au-delà du seuil du magasin | `approved_by` de la clôture (§9) |
| Suppression d'une vente en attente | rien n'est envoyé : les ventes en attente restent sur la caisse (§6) |

`approved_by` est l'`id` du responsable, ou `null` quand l'opération n'a pas demandé d'autorisation. Les opérations envoyées avant la version 0.6 n'ont pas ce champ : l'API le prend pour `null`. L'API l'enregistre tel quel et ne refait pas les contrôles, car le plafond, le seuil ou les responsables ont pu changer depuis une opération faite hors ligne. Si ce n'est pas l'`id` d'un responsable du magasin, l'API accepte quand même l'opération (elle a eu lieu) et la signale au back-office.

### Plafond de remise

- La remise d'une ligne se compare à `round(quantity × unit_price_ttc)`.
- La remise globale se compare au total des lignes après leurs remises, plus les autres charges.
- Une remise dépasse le plafond si elle est supérieure à `cashier_max_discount_percent` % de cette base, ou supérieure à `cashier_max_discount`. Une remise égale au plafond ne demande rien.
- La caisse fait ce contrôle au moment du paiement, sur le panier tel qu'il est payé : une seule autorisation couvre la vente.

### `GET /api/stores/{store_id}/approvers`

Les responsables qui peuvent autoriser une opération dans ce magasin, avec l'empreinte de leur PIN, pour que la caisse vérifie le PIN même hors ligne. Ouvert à tout utilisateur rattaché au magasin, car c'est la caisse d'un caissier qui en a besoin. Magasin qui n'est pas dans ceux de l'utilisateur → `403 FORBIDDEN`.

```json
{
  "approvers": [
    {
      "user_id": "u_3",
      "name": "Responsable",
      "pin": {
        "algorithm": "PBKDF2-SHA256",
        "iterations": 600000,
        "salt": "c2VsLWFsZWF0b2lyZS0xNg==",
        "hash": "ZW1wcmVpbnRlLWR1LXBpbi1zdXItMzItb2N0ZXRzLi4u"
      }
    }
  ]
}
```

Règles :

- La liste contient seulement les `manager` et `admin` rattachés au magasin qui ont un PIN. Elle est complète à chaque appel : un responsable retiré, ou qui n'a plus de PIN, n'y figure plus.
- Le PIN est fixé dans le back-office (§8, point 10), différent du mot de passe. Il n'est jamais envoyé en clair, ni par la caisse ni par l'API.
- `pin` est l'empreinte PBKDF2 (HMAC-SHA-256) du PIN encodé en UTF-8 :
  - `salt` : 16 octets aléatoires, propres au responsable et renouvelés à chaque changement de PIN, en base64 ;
  - `iterations` : entier ≥ 100 000 choisi par l'API (600 000 recommandé) ;
  - `hash` : les 32 octets obtenus, en base64.
- La caisse appelle cet endpoint à la connexion et à chaque synchronisation du catalogue, et garde la liste pour le hors ligne. Un PIN changé ou un responsable retiré reste donc valable sur une caisse hors ligne jusqu'à sa synchronisation suivante.

### Vérification sur la caisse

- On choisit le responsable dans la liste, puis il tape son PIN. La caisse calcule l'empreinte et la compare à celle de la liste.
- Après 3 PIN faux de suite sur la caisse, plus aucun essai n'est possible pendant 1 minute.
- Ce contrôle est fait par la caisse seule. Quelqu'un qui accède aux données du poste peut lire les empreintes et chercher les PIN hors de la caisse. Ce risque est accepté et détaillé dans `docs/SECURITE.md`. Il est réduit par un PIN de 6 chiffres, le nombre d'itérations et le suivi des `approved_by` au back-office.
