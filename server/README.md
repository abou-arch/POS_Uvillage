# Serveur du POS

API de la caisse (contrat [`pos-caisse/docs/API_CONTRACT.md`](../pos-caisse/docs/API_CONTRACT.md), §2 à §11) et du back-office (§12, proposé). Node 24, Express, base SQLite intégrée à Node (`node:sqlite`) : un seul fichier, aucune dépendance de plus.

## Démarrer

```bash
npm install
npm run demo        # base remplie avec les données de démonstration, API sur http://127.0.0.1:4100/api
```

Comptes de démonstration : `admin` / `admin`, `responsable` / `responsable`, `caissier` / `caissier` (PIN des responsables : `135790` et `246810`).

Puis, dans deux autres terminaux :

```bash
npm --prefix ../back-office run dev          # back-office sur http://localhost:5180
npm --prefix ../pos-caisse run dev:serveur   # caisse branchée sur ce serveur, http://localhost:5173
```

Autres commandes : `npm start` (base existante), `npm run dev` (relance à chaque modification), `npm run seed -- --demo` (crée la base et s'arrête), `npm test` (40 tests : connexion, catalogue, ventes, retours, sessions, back-office, rapports).

Le port 4000 reste à la fausse API et à la passerelle BreakLine de la caisse : le serveur prend le 4100.

## Installation réelle

Base vide, un administrateur créé au premier lancement :

```bash
cp .env.example .env    # ADMIN_USERNAME, ADMIN_PASSWORD (8 caractères au moins), CORS_ORIGINS…
npm start
```

L'administrateur crée ensuite dans le back-office les magasins, caisses, utilisateurs, catégories et articles. `.env` et `data/` (la base) ne sont jamais commités.

## Valeurs provisoires (à remplacer par celles du client)

Les données de démonstration viennent des captures de Falcon POS (le POS actuel du client) : articles, prix, stocks, catégories. Sont **à confirmer** :

- taux de TVA (20, 14, 10, 7, 0 %) : réglables dans le back-office (Réglages) ;
- adresse et ICE de chaque magasin, imprimés sur le ticket : fictifs ;
- format des étiquettes de la balance (préfixes 21 poids et 23 prix) : réglable par magasin ;
- prix d'achat : 70 % du prix de vente, pour illustrer la marge.

## Sécurité (voir `pos-caisse/docs/SECURITE.md`)

- Mots de passe en scrypt ; PIN des responsables en PBKDF2-SHA256, 600 000 itérations, jamais en clair.
- Tokens aléatoires gardés en empreinte SHA-256, valables 7 jours (`TOKEN_TTL_HOURS`), révoqués à la déconnexion, au changement de mot de passe et à la désactivation du compte.
- 5 connexions ratées de suite bloquent le compte 15 minutes, avec le même message qu'un mauvais mot de passe.
- Chaque route vérifie que le magasin visé est un de ceux de l'utilisateur (`403`). Le back-office est fermé aux caissiers.
- Recherche de clients : 2 caractères au moins, 20 résultats au plus.
- Une vente dont un prix diffère du catalogue est acceptée (prix changé pendant une coupure) mais signalée au back-office.
- Écoute sur 127.0.0.1 par défaut ; en production, derrière un proxy https et avec `CORS_ORIGINS`.

## Structure

```
src/index.js          démarrage : base, données de départ, écoute
src/app.js            connexion, contrôle du token, erreurs au format du contrat
src/routes/pos.js     routes de la caisse (§2 à §11)
src/routes/admin.js   routes du back-office (§12)
src/reports.js        rapports : ventes, retours, TVA par taux, articles, caissiers, marge
src/core.js           magasins d'un utilisateur, mouvements de stock, reste dû d'un client
src/db.js             schéma SQLite (montants en centimes, stocks en millièmes)
src/security.js       mots de passe, tokens, PIN
src/seed.js           données de démonstration et premier administrateur
test/                 tests (node --test, base en mémoire)
```

Les calculs HT / TVA / TTC et des montants remboursés sont ceux de la caisse (`pos-caisse/src/lib/totals.js`), importés tels quels : la caisse et le serveur arrondissent pareil.
