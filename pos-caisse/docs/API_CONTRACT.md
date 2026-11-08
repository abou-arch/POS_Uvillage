# Contrat d'API — Caisse (POS) ↔ Application web

Version 0.3 — proposition à valider par l'équipe. (0.2 : les clients sont identifiés par leur matricule universitaire au lieu de l'ICE ; 0.3 : la TVA des autres charges et de la remise globale est répartie par taux, voir §7.)

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
| Identifiants des ventes | **UUID v4 générés par la caisse** (indispensable pour le hors ligne). |
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
  "stores": [ { "id": "st_1", "name": "Magasin centre", "registers": [ { "id": "reg_1", "name": "Caisse 1" } ] } ]
}
```

Rôles attendus côté caisse : `admin`, `manager`, `cashier`. Un caissier ne voit que les magasins auxquels il est rattaché.

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
  "cashier_id": "u_12",
  "customer_id": null,
  "created_at": "2026-10-05T14:32:10Z",
  "lines": [
    {
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

Réponse `201` (ou `200` si déjà reçue) :

```json
{ "id": "0f8b7c2e-…", "status": "created", "stock_warning": false }
```

### `POST /api/sales/batch`

Même format, avec `{ "sales": [ … ] }`. Utilisé pour vider la file d'attente des ventes faites hors ligne. Réponse : un résultat par vente.

```json
{ "results": [ { "id": "0f8b…", "status": "created" }, { "id": "a1c2…", "status": "duplicate" } ] }
```

### `POST /api/sales/{id}/cancel`

Annule une vente (rôle `manager` ou `admin`) et remet le stock.

## 6. Ce qui reste côté caisse uniquement

- Les ventes **en attente** (bouton Hold / liste d'attente) restent dans la caisse et ne sont envoyées qu'une fois payées.
- Le cache du catalogue et la file d'attente des ventes hors ligne (IndexedDB).
- Le ticket 80 mm (impression navigateur).

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

## 8. Points à trancher en équipe

1. Stack et hébergement de l'API (et l'URL de l'environnement de test).
2. Liste exacte des taux de TVA et mentions obligatoires du ticket (ICE…) — avec le comptable.
3. Format de `number` (numérotation continue par caisse ?).
4. SMS : qui l'envoie (API à la réception de la vente si `send_sms: true`) ?
5. Remise : plafond autorisé pour un caissier ?
6. Matricule : unique par client ? Si oui, l'API refuse un doublon (`409`).
