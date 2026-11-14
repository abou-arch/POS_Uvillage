# Prompt Claude Code — Caisse POS, étapes 6a à 6e

Lis ce fichier en entier avant de commencer.

## Contexte

- Tu travailles dans `pos-caisse/`. Lis `CLAUDE.md`, `README.md` et `docs/API_CONTRACT.md` : leurs règles s'appliquent à tout ce qui suit.
- Ces étapes ajoutent ce qui manque à la caisse par rapport à une caisse du marché : session et clôture, retours, droits du caissier, articles au poids, historique des tickets. Odoo POS 19 sert de référence **fonctionnelle uniquement** : les blocs « Ce que fait Odoo POS 19 » résument son fonctionnement, lu dans le code Community. Ne copie aucun code d'Odoo ni d'un autre POS, et ne lis pas le code d'Odoo Enterprise.

## Façon de travailler

1. Une étape à la fois, dans l'ordre 6a → 6b → 6c → 6d → 6e. Ne passe pas à l'étape suivante sans mon accord.
2. Au début de chaque étape, montre-moi ton plan avant de coder.
3. Pour les étapes 6b à 6e : propose d'abord la modification de `docs/API_CONTRACT.md` (nouvelle version, avec la liste des changements en tête du fichier) et **arrête-toi jusqu'à ma validation**. Le contrat engage l'équipe back-office.
4. Les règles marquées « à valider avec le comptable » restent marquées ainsi dans le contrat.
5. À la fin de chaque étape : `npm run build` et `npm test` passent. Donne-moi la liste des fichiers modifiés, les tests ajoutés, les vérifications manuelles à faire, et un message de commit. Je committe moi-même.
6. Si une consigne te paraît fausse, ou contredit le contrat ou `CLAUDE.md`, dis-le avant de coder au lieu de l'appliquer.

Commence par l'étape 6a.

---

## Étape 6a — Ménage avant les nouvelles fonctions

Deux petites corrections, sans toucher au code de la caisse :

1. Le dépôt contient deux contrats d'API : API_CONTRACT.md à la racine du dépôt (dossier parent, v0.1, périmé) et docs/API_CONTRACT.md (v0.3, à jour). Remplace le contenu du fichier de la racine par une seule ligne qui renvoie vers pos-caisse/docs/API_CONTRACT.md, pour que l'équipe back-office ne lise plus l'ancienne version.
2. Mets à jour la section « Déjà fait / À faire » du README : les étapes 1 à 6 sont faites (voir git log) ; il reste les étapes 6b à 6e, puis 7 et 8.

Critères : un seul contrat fait foi ; le README décrit l'état réel. Build et tests OK.

---

## Étape 6b — Session de caisse : ouverture, entrées/sorties d'espèces, clôture

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

---

## Étape 6c — Retours et remboursements

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

---

## Étape 6d — Droits du caissier et autorisation responsable

Objectif : le caissier ne fait pas seul les opérations sensibles ; un responsable valide avec son code PIN.

AVANT DE CODER : propose-moi la modification du contrat et attends ma validation. Points à trancher (§8, point 5) :
- Plafond de remise d'un caissier (en % et/ou en DH), fourni par l'API par magasin.
- Comment vérifier un PIN responsable hors ligne sans stocker de PIN en clair sur la caisse (par exemple un hash par responsable téléchargé avec le catalogue). Donne-moi les risques de chaque option avant que je choisisse.

Puis :
- Opérations soumises à autorisation quand l'utilisateur connecté est cashier : remise au-delà du plafond, retour (6c), sortie d'espèces (6b), suppression d'une vente en attente, clôture avec un écart au-delà du seuil (6b).
- Fenêtre « Autorisation responsable » : PIN → opération validée, et on enregistre qui l'a autorisée (approved_by) dans la vente, le retour, le mouvement ou la clôture.
- 3 PIN faux de suite → blocage 1 minute.
- admin et manager ne voient pas cette fenêtre.
- Règles dans src/state/permissions.ts : fonctions pures + tests.

Critères : connecté en caissier, une remise de 30 % sur une ligne demande le PIN ; connecté en admin, non. Build et tests OK.

---

## Étape 6e — Articles au poids et historique des tickets

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
