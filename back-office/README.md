# Back-office (Gestion)

Application web des responsables et de l'administrateur, branchée sur le serveur (`server/`, routes du §12 du contrat). React, TypeScript, Vite, comme la caisse ; aucune autre dépendance.

## Démarrer

```bash
npm --prefix ../server run demo   # serveur avec les données de démonstration (port 4100)
npm install
npm run dev                       # http://localhost:5180
```

Connexion : `admin` / `admin` (tout) ou `responsable` / `responsable` (ses magasins). Un caissier est refusé. L'adresse de l'API se règle dans `.env.local` (voir `.env.example`) ; https obligatoire hors du poste.

Autres commandes : `npm test` (montants, quantités, périodes dans le fuseau du magasin, CSV), `npm run build`, `npm run lint`.

## Pages

- **Tableau de bord** : chiffre net, tickets, panier moyen comparés à la période précédente, ventes par heure ou par jour, moyens de paiement, meilleurs articles, par magasin ou par caissier, stock bas, sessions ouvertes, opérations à vérifier, clients qui doivent de l'argent.
- **Rapports** : TVA par taux (pour le comptable), par moyen de paiement, caissier, jour, catégorie, magasin, article avec marge ; export CSV de chaque tableau, impression.
- **Ventes** : tickets de toutes les caisses avec payé et dû, filtres (à crédit, annulées, à vérifier), détail, annulation (stock remis), export CSV.
- **Retours** et **Sessions de caisse** : comptages et écarts, mouvements d'espèces, ventes de la session, clôture depuis le back-office d'un poste en panne.
- **Articles** : code, unité, stock, prix d'achat et de vente, TVA, statut ; création et modification (envoyées aux caisses à leur synchronisation), stock par magasin, mouvements.
- **Catégories et marques**, **Stock** (réception avec prix d'achat, ajustement avec motif, inventaire ; journal).
- **Clients** : reste dû, achats, règlement d'une dette.
- **Administration** (admin) : utilisateurs (rôle, magasins, mot de passe, PIN de 6 chiffres), magasins (adresse et ICE du ticket, seuils, caisses, règles de la balance), réglages (taux de TVA, fuseau).

En haut : le magasin (ou tous) et, sur les pages datées, la période (jours du fuseau du magasin, `Africa/Casablanca` par défaut).
