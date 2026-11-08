# Caisse POS — contexte
Je développe UNIQUEMENT l'écran de caisse d'un POS (supérette au Maroc, multi-magasins, hors ligne obligatoire, TVA). Le back-office et l'API sont faits par d'autres membres de l'équipe. Le POS actuel à remplacer s'appelle « Falcon POS » (même logique d'écran : panier à gauche, grille de produits à droite).

## Stack
React 19 + TypeScript + Vite. Fausse API Express dans mock-api/ (port 4000). Tests avec Vitest.

## Règles non négociables
- Le contrat docs/API_CONTRACT.md fait foi. Ne jamais appeler un endpoint qui n'y est pas ; si un besoin manque, propose-moi une modification du contrat au lieu de l'inventer.
- Tous les montants en centimes (entiers). Jamais de flottants pour l'argent.
- Calculs HT/TVA/TTC uniquement via src/lib/totals.js (partagé avec la fausse API).
- Tous les appels réseau passent par src/api/client.ts.
- Les règles métier du panier vivent dans src/state/cart.ts, pas dans les composants.
- Refuser les saisies aberrantes (quantités, montants) : l'ancien POS a des valeurs absurdes en base.
- Les ventes ont un id UUID v4 généré par la caisse.
- Interface en français, libellés articles FR + AR possibles.
- Après chaque changement : npm run build et npm test doivent passer. Ajoute des tests pour toute logique métier.
- Pas de nouvelle dépendance sans me demander, sauf celles nommées dans mon prompt.

## Commandes
npm run dev:all · npm run mock · npm test · npm run build
