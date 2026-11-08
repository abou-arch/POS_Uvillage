# Caisse (POS)

Écran de caisse du projet POS. Le back-office (application web) est développé par le reste de l'équipe ; la caisse communique avec lui uniquement via l'API décrite dans [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## Démarrer

```bash
npm install
npm run dev:all      # fausse API (port 4000) + caisse (port 5173)
```

Ouvrir http://localhost:5173 — identifiants de test : `caissier` / `caissier` (ou `admin` / `admin`).

Autres commandes : `npm run mock` (API seule), `npm run dev` (caisse seule), `npm test` (tests des calculs HT/TVA/TTC), `npm run build`.

Pour pointer vers la vraie API : créer un fichier `.env` avec `VITE_API_URL=https://…/api`.

## Structure

```
docs/API_CONTRACT.md     contrat d'API à valider avec l'équipe
mock-api/                fausse API conforme au contrat (données des captures du POS actuel)
src/
  api/client.ts          seul point d'accès à l'API
  lib/totals.js          calcul HT / TVA / TTC partagé avec la fausse API (+ tests)
  state/cart.ts          panier (reducer) et garde-fous sur les saisies
  components/            Login, PosScreen, Cart, ProductGrid
  types.ts               types alignés sur le contrat
```

Montants en **centimes** partout (jamais de flottants pour l'argent).

## Déjà fait

- Connexion (magasin et caisse pris par défaut)
- Grille de produits avec filtres catégories / marques, recherche, badge de stock
- Saisie code-barres / code article (douchette + Entrée), raccourci Ctrl+Shift+S
- Panier : quantité, remise par ligne, suppression, autres charges, remise totale
- Totaux HT / TVA / TTC

## À faire (planning de la semaine)

- [ ] Mer — choix du magasin / de la caisse à la connexion
- [ ] Ven — client : recherche + ajout rapide
- [ ] Ven — paiement Espèces / Multiple / Pay All, rendu de monnaie, envoi de la vente (`id` UUID, `number` de ticket)
- [ ] Sam — mise en attente + liste d'attente, ticket 80 mm
- [ ] Semaine suivante — hors ligne : PWA, cache du catalogue (IndexedDB), file d'attente des ventes + `POST /sales/batch`
