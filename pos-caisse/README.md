# Caisse (POS)

Écran de caisse du projet POS. Le back-office (application web) est développé par le reste de l'équipe ; la caisse communique avec lui uniquement via l'API décrite dans [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## Démarrer

```bash
npm install
npm run dev:all      # fausse API (port 4000) + caisse (port 5173)
```

Ouvrir http://localhost:5173 — identifiants de test : `caissier` / `caissier` (magasin quartier), `responsable` / `responsable` (manager) ou `admin` / `admin`. Le seuil d'écart de clôture des deux magasins est de 20 DH. Plafond de remise d'un caissier : 10 % et 50 DH au magasin centre, 10 % sans plafond en DH au magasin quartier. PIN de test des responsables : `246810` (Responsable), `135790` (Falcon, admin).

Autres commandes : `npm run mock` (API seule), `npm run dev` (caisse seule), `npm test` (tests de la logique métier : calculs HT/TVA/TTC, panier, paiement, vente, ticket, session de caisse et rapport, retours et remboursements, droits du caissier et PIN responsable, code-barres, synchronisation hors ligne), `npm run build`.

Pour pointer vers la vraie API : créer un fichier `.env` avec `VITE_API_URL=https://…/api`.

La fausse API garde ce qu'elle reçoit (ventes, sessions de caisse, stocks) dans `mock-api/state.json`, ignoré par git : la relancer ne perd rien. Pour repartir de zéro : l'arrêter et supprimer ce fichier. Côté caisse, les données du poste sont dans IndexedDB (DevTools → Application → IndexedDB → `pos-caisse`) ; les données de test d'avant la version finale de l'étape 6b (ventes sans `session_id`, clôtures sans détail par moyen de paiement) y restent signalées comme illisibles : effacer cette base si besoin. Après la mise à jour, il faut aussi se reconnecter une fois : la session enregistrée n'a pas encore le seuil d'écart du magasin. L'étape 6c fait passer la base locale en version 3 (table des retours, index sur le numéro de ticket) : la mise à jour se fait seule au premier lancement, rien n'est perdu ; seules les ventes enregistrées avant l'étape 6c n'ont pas d'identifiant de ligne (leurs retours se font par le rang de la ligne, comme prévu au §5). L'étape 6d passe la base en version 4 (table des responsables et de l'empreinte de leur PIN), seule elle aussi ; il faut se reconnecter une fois, la session enregistrée n'ayant pas encore le plafond de remise du magasin.

## Structure

```
docs/API_CONTRACT.md     contrat d'API (seule version qui fait foi), à valider avec l'équipe
docs/SECURITE.md         audit de sécurité : en-têtes d'hébergement, propositions pour l'API, risques acceptés
mock-api/                fausse API conforme au contrat (données des captures du POS actuel), état dans state.json
src/
  api/client.ts          seul point d'accès à l'API
  lib/totals.js          calcul HT / TVA / TTC partagé avec la fausse API (+ tests)
  lib/buildSale.ts       construction de la vente selon le §5 du contrat (+ tests)
  lib/receipt.ts         contenu du ticket 80 mm et du rapport de session, tirés des données enregistrées (+ tests)
  lib/cashSession.ts     session de caisse : montants attendus par moyen, comptage billets / pièces, seuil d'écart, contrôles, rapport (+ tests)
  lib/buildRefund.ts     retour selon le §10 : reste à retourner, montant remboursé par ligne (§7), moyens de remboursement proposés, contrôles (+ tests)
  lib/code128.ts         code-barres Code 128 du numéro de ticket, écrit pour le projet (+ tests)
  lib/pin.ts             vérification du PIN d'un responsable contre son empreinte PBKDF2 (WebCrypto), contrôle de la liste reçue (+ tests)
  state/                 règles métier : panier (cart.ts), paiement, clients, ventes en attente, session de connexion, droits du caissier et blocage du PIN (permissions.ts)
  db/                    base locale IndexedDB (Dexie) : catalogue, clients, outbox, ventes en attente, sessions de caisse, leurs ventes et leurs retours ; recherche d'un ticket (refunds.ts) ; responsables du magasin (approvers.ts)
  sync/                  envoi de l'outbox dans l'ordre (ouverture, ventes par lot, retours, mouvements, clôture) et mise à jour du catalogue (+ tests)
  sw/sw.ts               service worker de la PWA (rechargement sans réseau)
  components/            écrans et fenêtres : connexion, choix du magasin, ouverture de caisse, caisse, paiement, session, retour, autorisation responsable, ticket…
  config/store.ts        mentions du ticket par magasin (valeurs fictives), impression automatique
  config/cash.ts         billets et pièces proposés pour compter les espèces (liste à modifier si besoin)
  types.ts               types alignés sur le contrat
```

Montants en **centimes** partout (jamais de flottants pour l'argent).

## Déjà fait

- Base : grille de produits (filtres catégories / marques, recherche, stock), saisie code-barres / code article (douchette + Entrée, Ctrl+Shift+S), panier (quantité, remise par ligne, autres charges, remise totale), totaux HT / TVA / TTC
- Étape 1 — Connexion, choix du magasin puis de la caisse (sauté s'il n'y a qu'une caisse), session conservée après F5, déconnexion
- Design — écran plus lisible : grand champ de scan, boutons − / +, total mis en avant, couleurs à sens fixe
- Étape 2 — Client : recherche (nom, téléphone, matricule), ajout rapide avec id UUID, retour au client de passage, case SMS
- Étape 3 — Paiement : espèces (F2) avec rendu de monnaie, paiement mixte (espèces, carte, mobile, crédit), montant exact (F4) ; vente construite selon le §5 du contrat
- Étape 4 — Mise en attente et liste d'attente : reprise, suppression, prix changés signalés
- Étape 5 — Ticket 80 mm avec récapitulatif TVA par taux, impression automatique, réimpression du dernier ticket
- Étape 6 — Hors ligne : PWA, base locale IndexedDB, catalogue en cache synchronisé avec `updated_since`, ventes écrites dans l'outbox puis envoyées par `POST /api/sales/batch`, indicateur En ligne / Hors ligne
- Étape 6b — Session de caisse (contrat v0.4, §2 et §9) : ouverture avec fond de caisse saisi ou compté par billets et pièces (vérifiée auprès de l'API quand elle répond), reprise après F5, entrées / sorties d'espèces avec motif et ticket 80 mm, rapport X, clôture avec attendu / compté / écart pour espèces, carte et mobile (note obligatoire dès qu'il y a un écart ; au-delà du seuil du magasin, un caissier ne clôture pas seul), rapport de clôture 80 mm imprimé puis réimprimable ; tout marche hors ligne et part dans l'ordre par la même outbox
- Étape 6c — Retours et remboursements (contrat v0.5, §7 et §10) : bouton Retour, ticket retrouvé par sa douchette (code-barres Code 128 imprimé sur chaque ticket) ou son numéro, auprès de l'API ou dans le journal du poste hors ligne ; retour partiel ou total, en plusieurs fois, sans jamais dépasser le vendu ; montant remboursé = part réellement payée (remises comprises), la somme des retours retombe exactement sur le total payé ; motif obligatoire ; remboursement proposé (crédit non remboursé d'abord, puis le moyen d'origine) et modifiable ; ticket de remboursement 80 mm ; stock remis ; retours déduits des montants attendus et détaillés dans les rapports X et de clôture ; envoi par la même outbox
- Étape 6d — Droits du caissier (contrat v0.6, §2 et §11) : un caissier fait autoriser par un responsable une remise au-delà du plafond du magasin (signalée dans le panier, PIN demandé au paiement), un retour, une sortie d'espèces, la suppression d'une vente en attente et une clôture au-delà du seuil d'écart ; fenêtre « Autorisation responsable » (choix du responsable puis PIN, vérifié sur le poste même hors ligne), 3 PIN faux de suite bloquent 1 minute ; `approved_by` envoyé avec l'opération et nom du responsable sur le ticket ou le rapport ; un manager ou un admin ne voit jamais la fenêtre
- Audit de sécurité (voir [`docs/SECURITE.md`](docs/SECURITE.md))

## À faire

- [x] 6b — Session de caisse : ouverture avec fond de caisse, entrées / sorties d'espèces, clôture par moyen de paiement avec seuil d'écart, rapports X et de clôture
- [x] 6c — Retours et remboursements
- [x] 6d — Droits du caissier et autorisation d'un responsable (PIN)
- [ ] 6e — Articles au poids (codes-barres de la balance) et historique des tickets
- [ ] 7 — Branchement sur la vraie API de l'équipe
- [ ] 8 — Revue finale avant livraison et tests en magasin
