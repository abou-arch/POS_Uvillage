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

## Étape 6a — Ménage avant les nouvelles fonctions

```
Deux petites corrections, sans toucher au code de la caisse :

1. Le dépôt contient deux contrats d'API : API_CONTRACT.md à la racine du dépôt (dossier parent, v0.1, périmé) et docs/API_CONTRACT.md (v0.3, à jour). Remplace le contenu du fichier de la racine par une seule ligne qui renvoie vers pos-caisse/docs/API_CONTRACT.md, pour que l'équipe back-office ne lise plus l'ancienne version.
2. Mets à jour la section « Déjà fait / À faire » du README : les étapes 1 à 6 sont faites (voir git log) ; il reste les étapes 6b à 6e, puis 7 et 8.

Critères : un seul contrat fait foi ; le README décrit l'état réel. Build et tests OK.
```

---

## Étape 6b — Session de caisse : ouverture, entrées/sorties d'espèces, clôture

```
Objectif : chaque caisse travaille dans une session : fond de caisse à l'ouverture, mouvements d'espèces pendant la journée, comptage à la clôture.

Ce que fait Odoo POS 19 (référence fonctionnelle lue dans le code Community — n'en copie rien, écris notre propre code) :
- Ouverture : le caissier saisit le fond de caisse, directement ou en comptant billets et pièces, et une note facultative. Odoo refuse d'ouvrir hors ligne : nous, nous devons pouvoir.
- Entrée / sortie d'espèces : type, montant, motif obligatoire. Un petit ticket est imprimé à chaque mouvement, et la liste des mouvements de la session est consultable.
- Clôture : pour chaque moyen de paiement, attendu / compté / écart. Espèces attendues = fond + paiements en espèces + entrées − sorties ; les ventes à crédit ne comptent pas. Pour la carte, le « compté » est prérempli avec l'attendu et le caissier le corrige avec le total du terminal. Les espèces peuvent être comptées par billets et pièces. Notes d'ouverture et de clôture.
- Un écart au-delà d'un seuil autorisé ne peut être validé que par un responsable.
- La clôture est bloquée tant qu'il reste des commandes en cours (on propose de les reprendre ou de les supprimer). Odoo exige aussi que toutes les ventes soient envoyées et d'être en ligne : nous, non (voir plus bas).

AVANT DE CODER : propose-moi la modification du contrat (docs/API_CONTRACT.md, version 0.4) et attends ma validation. Ce que j'attends :
- Une session a un id UUID v4 généré par la caisse, store_id, register_id, le caissier qui l'ouvre, opened_at, opening_cash (centimes), opening_note facultative. À la clôture : closed_at, closed_by, pour chaque moyen de paiement (cash, card, mobile) l'attendu, le compté et l'écart, le détail du comptage des espèces (facultatif), closing_note.
- Une seule session ouverte par caisse.
- Chaque vente porte un session_id.
- Mouvements d'espèces hors vente : id UUID v4, session_id, type in | out, montant, motif obligatoire, created_at, created_by.
- Seuil d'écart autorisé, fourni par l'API pour chaque magasin.
- Hors ligne : l'ouverture, les mouvements et la clôture passent par la même file d'envoi (outbox) que les ventes, avec des appels idempotents (même id envoyé deux fois = un seul enregistrement). Ordre garanti : l'ouverture part avant les ventes de la session, la clôture après toutes ses ventes et tous ses mouvements. Différence volontaire avec Odoo : on peut clôturer hors ligne (calcul local) et ouvrir aussitôt une nouvelle session.

Puis, une fois le contrat validé :
- Après le choix magasin/caisse : si aucune session n'est ouverte sur cette caisse, écran « Ouverture de caisse » : fond de caisse saisi directement ou par comptage (billets 200, 100, 50, 20 DH ; pièces 10, 5, 2, 1 DH, 0,50, 0,20, 0,10 DH — liste dans une constante, facile à modifier), note. Sinon on reprend la session en cours (elle survit à F5 et à une coupure).
- Bouton « Entrée / sortie d'espèces » dans l'en-tête : type, montant, motif obligatoire ; ticket 80 mm du mouvement ; liste des mouvements de la session.
- Bouton « Clôturer la caisse » :
  - impossible s'il reste des ventes en attente (Hold) : proposer de les reprendre ou de les supprimer ;
  - tableau par moyen de paiement : attendu, compté, écart. Espèces comptées en saisie directe ou par billets et pièces ; carte et mobile préremplis avec l'attendu, modifiables ;
  - écart différent de 0 → note de clôture obligatoire ;
  - écart au-delà du seuil : un caissier ne peut pas valider (message « faites valider par un responsable » ; le code PIN arrivera à l'étape 6d) ; admin et manager peuvent valider.
- Calcul dans une fonction pure src/lib/cashSession.ts, avec des tests : espèces attendues = fond + paiements en espèces des ventes de la session + entrées − sorties (− remboursements en espèces quand l'étape 6c existera). Attention : dans notre Sale, le montant d'un paiement en espèces est déjà le montant dû, la monnaie rendue est à part (vérifie dans src/lib/buildSale.ts) : ne la soustrais pas une deuxième fois.
- Rapport de clôture (Z) imprimable en 80 mm, en réutilisant le ticket : nombre de ventes, total TTC, totaux par moyen de paiement, HT/TVA par taux, entrées/sorties, fond, attendu / compté / écart par moyen de paiement, notes, et le nombre d'éléments pas encore envoyés s'il y en a. Bouton « Rapport X » pour imprimer le même rapport pendant la session sans la clôturer.
- Après la clôture : retour à l'écran d'ouverture.
- Mets à jour la fausse API (mock-api) selon le nouveau contrat.

Critères : j'ouvre avec 500 DH, je fais une vente espèces de 120 DH (le client donne 200 DH), une vente carte de 80 DH et une sortie de 50 DH ; à la clôture les espèces attendues sont 570 DH et la carte 80 DH ; si je compte 560 DH, l'écart de −10 DH apparaît et une note est exigée. Fausse API coupée pendant toute la session, clôture comprise : rien n'est perdu, tout part dans le bon ordre au retour. Build et tests OK.
```

---

## Étape 6c — Retours et remboursements

```
Objectif : rendre tout ou partie d'un ticket, avec remboursement et remise en stock.

Ce que fait Odoo POS 19 (référence fonctionnelle lue dans le code Community — n'en copie rien) :
- Depuis l'écran des tickets, on retrouve la vente, puis on choisit ligne par ligne la quantité à rendre. Quantité rendable = quantité vendue − quantité déjà rendue ; au-delà, refus avec un message clair.
- Chaque ligne rendue pointe vers la LIGNE d'origine (pas seulement vers l'article) et reprend son prix unitaire, sa remise et sa TVA : un retour est taxé comme la vente qu'il rembourse. Le client de la vente est repris automatiquement.
- On passe ensuite à l'écran de paiement habituel pour rembourser.
- Odoo enregistre le retour comme une commande à quantités négatives liée à la commande d'origine. Nous gardons un document séparé à montants positifs, parce que notre contrat n'accepte que des montants positifs.

AVANT DE CODER : propose-moi la modification du contrat et attends ma validation :
- Ajouter un id UUID v4 à chaque ligne de vente (nouvelles ventes) pour qu'un retour vise une ligne précise, même si le même article apparaît deux fois dans le ticket. Pour les ventes déjà enregistrées sans id de ligne, on se repère à la position de la ligne.
- Retrouver une vente par son numéro de ticket (saisi ou scanné) : nouvel endpoint de lecture. Hors ligne, seules les ventes enregistrées sur cette caisse sont retrouvables.
- Un retour : id UUID v4, number (même logique que les tickets, avec un préfixe R), original_sale_id, session_id, lignes rendues (original_line_id, product_id, quantité, montants HT/TVA/TTC), motif obligatoire, totaux, remboursements (method, amount), created_at. Envoyé par l'outbox, idempotent.
- Règle de calcul : une ligne rendue rembourse la part du TTC réellement payé pour cette ligne (après remise de ligne et part de la remise globale / des autres charges répartie selon le §7), au prorata de la quantité rendue, au centime près, avec le taux de TVA de la ligne d'origine. Ajoute cette règle au §7, marquée « à valider avec le comptable ».
- L'API remet en stock et refuse (422) un retour qui dépasse ce qui reste à rendre sur une ligne.

Puis :
- Bouton « Retour » : numéro de ticket (saisie ou douchette) → lignes de la vente avec quantité vendue, déjà rendue et encore rendable → choix des quantités → motif (défectueux, erreur de caisse, changement d'avis, autre + texte).
- Interdire de rendre plus que vendu, en comptant les retours précédents, y compris ceux encore dans l'outbox.
- Remboursement : réutilise la fenêtre de paiement existante en mode « remboursement ». Par défaut le même moyen que la vente d'origine, espèces si elle était en paiement multiple ; une vente à crédit diminue le crédit (method credit).
- Le client de la vente d'origine est repris sur le retour.
- Ticket de retour imprimable en 80 mm.
- Calcul dans une fonction pure src/lib/buildRefund.ts avec des tests : retour partiel, retour total, deux retours successifs sur la même vente, même article sur deux lignes, TVA mixte, remise de ligne, remise globale, arrondis (la somme des retours partiels est exactement le total payé, jamais 1 centime de plus).
- Les remboursements en espèces entrent dans les espèces attendues de la session (étape 6b).
- Mets à jour la fausse API.

Critères : je vends 3 articles dont un avec remise, je les rends en deux retours : la somme remboursée est exactement le total payé ; un 3e retour est refusé. Build et tests OK.
```

---

## Étape 6d — Droits du caissier et autorisation responsable

```
Objectif : le caissier ne fait pas seul les opérations sensibles ; un responsable valide avec son code PIN.

AVANT DE CODER : propose-moi la modification du contrat et attends ma validation. Points à trancher (§8, point 5) :
- Plafond de remise d'un caissier (en % et/ou en DH), fourni par l'API par magasin.
- Comment vérifier un PIN responsable hors ligne sans stocker de PIN en clair sur la caisse (par exemple un hash par responsable téléchargé avec le catalogue). Donne-moi les risques de chaque option avant que je choisisse.

Puis :
- Opérations soumises à autorisation quand l'utilisateur connecté est cashier : remise au-delà du plafond, retour (6c), sortie d'espèces (6b), suppression d'une vente en attente, clôture avec un écart au-delà d'un seuil.
- Fenêtre « Autorisation responsable » : PIN → opération validée, et on enregistre qui l'a autorisée (approved_by) dans la vente, le retour ou le mouvement.
- 3 PIN faux de suite → blocage 1 minute.
- admin et manager ne voient pas cette fenêtre.
- Règles dans src/state/permissions.ts : fonctions pures + tests.

Critères : connecté en caissier, une remise de 30 % sur une ligne demande le PIN ; connecté en admin, non. Build et tests OK.
```

---

## Étape 6e — Articles au poids et historique des tickets

```
Objectif : vendre correctement les articles au poids et retrouver un ticket de la journée.

Ce que fait Odoo POS 19 (référence fonctionnelle lue dans le code Community — n'en copie rien) :
- Les codes-barres spéciaux suivent des règles configurables (une « nomenclature »), pas codées en dur. Exemple d'Odoo pour un prix : « 23 » + 5 chiffres d'article + 5 chiffres de valeur (3 entiers, 2 décimales) + chiffre de contrôle EAN-13. Un code-barres au poids suit la même idée avec une valeur en kg.
- Pour retrouver l'article, Odoo remplace la partie « valeur » par des zéros et recalcule le chiffre de contrôle : c'est ce « code de base » qui est enregistré sur l'article.
- L'écran des tickets liste les ventes, permet de chercher, de réimprimer et de lancer un retour.

AVANT DE CODER : propose-moi la modification du contrat et attends ma validation :
- Un champ unit sur l'article : unit (vendu à la pièce) ou kg.
- Règles de codes-barres balance fournies par l'API : préfixe, type (poids ou prix), nombre de chiffres entiers et décimaux. Le barcode d'un article au poids est son code de base.
- Demande-moi le format exact de la balance du client avant d'implémenter le décodage.

Puis :
- Article à la pièce : quantité entière obligatoire (refuser 1,5). Article au kg : saisie en kg, 3 décimales, affichage « 0,750 kg × 25,00 DH/kg ».
- Décodage du code-barres balance dans une fonction pure avec tests : chiffre de contrôle faux → refus ; code de base retrouvé ; code-barres de prix → quantité = prix ÷ prix au kg, arrondie à 3 décimales.
- Bouton « Tickets » : ventes de la session en cours (numéro, heure, client, total, statut d'envoi), recherche par numéro ou client, réimpression, accès direct au retour (6c).

Critères : un article à la pièce refuse 1,5 ; un code-barres balance ajoute le bon article avec le bon poids ; un code-barres au chiffre de contrôle faux est refusé ; je retrouve et réimprime le 3e ticket de la journée. Build et tests OK.
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
