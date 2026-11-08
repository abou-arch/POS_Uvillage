# Prompts — Caisse POS (Claude Code / Cowork)

Mode d'emploi :

- Un prompt = une session (ou `/clear` entre deux). Commit après chaque étape validée.
- Commence toujours par l'étape 0 : le fichier `CLAUDE.md` donne le contexte à Claude Code à chaque session, tu n'as plus à le répéter.
- Si Claude part dans une mauvaise direction, arrête-le tôt : demande-lui d'abord son plan (« montre-moi ton plan avant de coder »).

---

## Étape 0 — Créer `CLAUDE.md` (une seule fois)

```
Crée un fichier CLAUDE.md à la racine du projet avec exactement ce contenu, puis lis docs/API_CONTRACT.md et README.md et résume-moi en 5 lignes l'état du projet.

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
```

---

## Étape 1 — Choix du magasin et de la caisse

```
Objectif : à la connexion, le caissier choisit son magasin et sa caisse.

- Si l'utilisateur n'a qu'un magasin avec une seule caisse, on passe directement à l'écran de caisse.
- Sinon, écran de choix (magasin puis caisse) après le login.
- La session (token, user, magasin, caisse) est conservée dans localStorage pour survivre à un rechargement de page ; bouton Déconnexion qui l'efface.
- Le nom du magasin et de la caisse restent affichés dans l'en-tête.

Critères : je me connecte avec admin/admin (2 magasins) et je peux choisir ; caissier/caissier arrive directement sur la caisse ; F5 ne me déconnecte pas. Build et tests OK.
```

---

## Étape 2 — Client : recherche et ajout rapide

```
Objectif : remplacer « Client de passage » par un sélecteur de client, comme dans Falcon POS.

- Champ de recherche avec suggestions (GET /api/customers?search=), délai de 300 ms entre les frappes.
- Bouton « + » qui ouvre une petite fenêtre : nom (obligatoire), téléphone, ICE (facultatif) → POST /api/customers avec un id UUID généré côté caisse.
- Une croix remet « Client de passage » (customer = null).
- La case « Envoyer un SMS au client » est désactivée si le client n'a pas de téléphone.

Critères : je retrouve « Ahmed » en tapant « ah » ; je crée un client et il est sélectionné automatiquement. Build et tests OK.
```

---

## Étape 3 — Paiement et enregistrement de la vente

```
Objectif : rendre actifs les boutons Espèces, Multiple et Pay All, et enregistrer la vente.

- Espèces : fenêtre avec montant reçu (boutons rapides 10/20/50/100/200 DH + saisie), rendu de monnaie calculé, validation impossible si reçu < total.
- Multiple : plusieurs lignes de paiement (cash, card, mobile, credit). Le crédit n'est autorisé que si un client est sélectionné. Validation quand la somme = total.
- Pay All : paiement immédiat du total en espèces, sans fenêtre.
- Construire l'objet Sale exactement selon le §5 du contrat : id UUID, number = « <magasin>-<caisse>-<compteur sur 6 chiffres> » avec un compteur par caisse conservé en localStorage, lignes avec total_ht / total_tva / total_ttc calculés via totals.js.
- POST /api/sales. En cas de succès : vider le panier et afficher la confirmation (numéro de ticket + rendu). En cas d'erreur réseau : NE PAS perdre la vente — la garder dans une liste « ventes à envoyer » en localStorage (l'étape hors ligne remplacera ce stockage).
- Raccourcis clavier : F2 = Espèces, F4 = Pay All, Échap = fermer la fenêtre.
- Mettre à jour le stock affiché dans la grille après la vente.

Mets la construction de la vente dans une fonction pure src/lib/buildSale.ts, avec des tests (TVA mixte 0 % et 20 %, remise de ligne, autres charges, remise globale, paiement multiple).

Critères : une vente en espèces arrive dans GET /api/sales avec des totaux exacts ; une vente renvoyée deux fois n'est comptée qu'une fois ; si je coupe la fausse API, la vente est conservée. Build et tests OK.
```

---

## Étape 4 — Mise en attente (Hold) et liste d'attente

```
Objectif : reproduire le bouton Hold et la « Liste d'attente » de Falcon POS.

- Hold : enregistre le panier courant (lignes, client, charges, remises) avec une note facultative et l'heure, puis vide le panier.
- Bouton « Liste d'attente » dans l'en-tête avec un badge du nombre de ventes en attente.
- Depuis la liste : reprendre une vente (si le panier actuel n'est pas vide, demander confirmation) ou la supprimer.
- Les ventes en attente sont propres à la caisse (non envoyées à l'API) et survivent à un rechargement.
- À la reprise, rafraîchir prix et stock depuis le catalogue actuel et signaler les lignes dont le prix a changé.

Critères : je mets 2 paniers en attente, je recharge la page, je les retrouve et je peux en encaisser un. Build et tests OK.
```

---

## Étape 5 — Ticket de caisse 80 mm

```
Objectif : imprimer un ticket après chaque vente (et réimprimer le dernier).

- Composant Ticket rendu dans une zone dédiée et une feuille de style @media print pour une imprimante thermique 80 mm (largeur ~72 mm utiles, police monospace, pas de marges).
- Contenu : nom du magasin, adresse et ICE (valeurs à placer dans un fichier src/config/store.ts, avec des valeurs fictives), numéro de ticket, date/heure, caissier, client (ou « Client de passage »), lignes (désignation, qté × prix, remise, total), récapitulatif TVA par taux (base HT, TVA), total HT, total TVA, total TTC, détail des paiements, rendu, message de remerciement.
- Impression automatique après validation du paiement (option activable dans src/config/store.ts) + bouton « Réimprimer le dernier ticket ».
- Le montant affiché doit toujours provenir de l'objet Sale enregistré, jamais d'un recalcul.

Critères : l'aperçu avant impression du navigateur montre un ticket propre sur une seule colonne ; le récapitulatif TVA est juste pour un panier à 0 % + 20 %. Build et tests OK.
```

---

## Étape 6 — Mode hors ligne (PWA)

```
Objectif : la caisse doit continuer à vendre sans connexion. Dépendances autorisées : vite-plugin-pwa et dexie.

1. PWA : application installable, ressources mises en cache, fonctionne au rechargement sans réseau.
2. Base locale Dexie (IndexedDB) avec les tables : products, categories, brands, customers, outbox (ventes à envoyer), held (ventes en attente — migrer depuis localStorage), meta (dernière synchro, compteur de tickets).
3. Catalogue : au démarrage, afficher immédiatement le cache, puis synchroniser avec GET /api/products?updated_since=<dernière synchro> ; les articles active=false sont retirés du cache.
4. Ventes : toute vente validée est d'abord écrite dans outbox, puis envoyée. Un service de synchronisation vide l'outbox via POST /api/sales/batch quand le réseau revient (événement online + tentative toutes les 30 s, attente progressive en cas d'échec). « created » et « duplicate » = retirer de l'outbox ; « error » = garder et marquer en erreur.
5. Stock local : décrémenter le stock en cache à chaque vente pour que la grille reste juste hors ligne.
6. Indicateur dans l'en-tête : En ligne / Hors ligne + nombre de ventes en attente d'envoi ; un clic force la synchro.
7. Si le token expire pendant la coupure, ne jamais perdre l'outbox : demander de se reconnecter puis reprendre l'envoi.

Écris des tests pour le service de synchronisation (avec fetch simulé) : envoi réussi, doublon, erreur partielle, coupure au milieu d'un lot.

Critères : je coupe la fausse API, je fais 3 ventes, je recharge la page, je relance l'API → les 3 ventes arrivent une seule fois et l'indicateur repasse à 0. Build et tests OK.
```

---

## Étape 7 — Branchement sur la vraie API

```
L'équipe a livré l'API à cette adresse : <URL>. Voici sa documentation / ses différences avec notre contrat : <coller ici>.

1. Compare l'API réelle avec docs/API_CONTRACT.md et liste-moi toutes les différences AVANT de modifier quoi que ce soit.
2. Adapte uniquement src/api/client.ts (adaptateurs si les formats diffèrent) et le fichier .env (VITE_API_URL). Les composants ne doivent pas changer.
3. Mets à jour docs/API_CONTRACT.md pour refléter ce qui a été convenu.
4. Ajoute un test d'intégration qu'on peut lancer à la main contre l'API de test (npm run test:api) : login, catalogue, création de vente, doublon.
```

---

## Étape 8 — Revue finale avant livraison

```
Fais une revue complète de la caisse comme un développeur senior avant mise en production chez un client :

- Exactitude des montants (arrondis, TVA, remises, rendu de monnaie) : cherche les cas limites et ajoute des tests si besoin.
- Robustesse hors ligne : y a-t-il un seul scénario où une vente peut être perdue ou envoyée deux fois ?
- Saisies aberrantes : quantité négative, énorme, décimale sur un article à l'unité, remise > total.
- Sécurité : token, données en localStorage/IndexedDB, déconnexion.
- Ergonomie caisse : tout faisable au clavier et à la douchette, temps de réponse.

Donne-moi la liste des problèmes classés par gravité, puis corrige les critiques et les importants. Termine par une checklist de test manuel à faire en magasin (douchette, imprimante, coupure Wi-Fi, deux caisses en parallèle).
```
