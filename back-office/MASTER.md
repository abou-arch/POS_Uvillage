# Back-office : design system

Source unique des choix visuels du back-office. Toute couleur, taille, espacement, coin, ombre ou durée vient d'ici
(jetons CSS dans `src/styles.css`, bloc `:root`). Pas de valeur en dur dans les composants.

## Thèses validées

**Visuelle.** Interface claire, calme et dense pour l'outil de tous les jours d'une supérette : fond gris neutre très
clair et surfaces blanches, encre presque noire, un seul accent bleu Majorelle (#3A3FC4, clin d'œil à Marrakech, qui
tranche avec le bleu ordinaire de Falcon) ; Inter pour tout le texte, titres compris, chiffres tabulaires ; base de
4 px, lignes de tableau de 36 px, beaucoup d'information par écran ; composants plats à filet de 1 px, coins de 8 px,
aucune ombre sauf fenêtres et info-bulles ; les quatre familles de Falcon (achats, ventes dues, ventes, dépenses)
gardent leur couleur, en pastille d'icône.

Police : Inter seule, titres compris. Elle est déjà livrée avec l'application (`@fontsource-variable/inter`), donc
aucune requête réseau dans un magasin à la connexion fragile, et ses chiffres tabulaires alignent les montants en
colonne. La hiérarchie vient du poids et de la taille, pas d'une seconde police.

**Interaction.** Rapide et sèche : survols et états en 120 ms, fenêtres et info-bulles en 180 ms à l'entrée (fondu,
montée de 4 px) et 120 ms à la sortie, courbe `cubic-bezier(0.2, 0, 0, 1)` ; survol = changement de fond ou de filet,
jamais d'agrandissement ; graphiques dessinés une fois au chargement (barres en 240 ms, 20 ms d'écart entre deux
mois) ; aucune animation au défilement, aucun chiffre qui compte, aucun rebond, aucune boucle ; « réduire les
animations » rend tout instantané.

**Motifs permis.** Point médian comme séparateur dans une ligne d'informations secondaires (magasin · caissier ·
heure) ; tiret cadratin comme marque de case vide dans les tableaux ; pastilles d'icône colorées des tuiles du tableau
de bord ; filet entre les lignes des tableaux denses (on suit une ligne d'un bout à l'autre).

Curseurs : densité 8/10 (lignes de 36 px), mouvement 2/10 (rapide et sec, rien au défilement), variance non fixée.

## Couleurs

| Jeton | Valeur | Rôle | Contraste |
|---|---|---|---|
| `--bg` | `#f3f4f6` | fond de page | encre 16,1:1 |
| `--surface` | `#ffffff` | panneaux, tableaux, champs | encre 17,8:1 |
| `--surface-2` | `#f8f9fa` | en-têtes de tableau, pieds de fenêtre | |
| `--line` | `#e4e7eb` | filets (décor) | |
| `--line-soft` | `#eef0f3` | filets entre lignes | |
| `--field` | `#8a919e` | bord des champs et boutons secondaires | 3,2:1 sur blanc |
| `--ink` | `#16181d` | texte principal | |
| `--ink-2` | `#4b5260` | texte secondaire fort | 7,9:1 sur blanc |
| `--muted` | `#626977` | libellés, métadonnées | 5,0:1 sur fond, 5,5:1 sur blanc |
| `--faint` | `#9aa1ad` | décor seulement (jamais de texte) | |
| `--accent` | `#3a3fc4` | Majorelle : liens, bouton principal, focus | 7,8:1 sur blanc |
| `--accent-strong` | `#2e33a8` | survol du bouton principal | |
| `--accent-press` | `#262a8c` | appui sur le bouton principal | |
| `--on-accent` | `#ffffff` | texte sur l'accent ou sur l'encre | 7,8:1 sur l'accent |
| `--accent-soft` | `#eceefc` | survol des lignes, fond actif du menu | accent dessus 6,8:1 |
| `--accent-line` | `#c7cbf4` | bord d'un élément actif | |
| `--ok` / `--ok-soft` | `#16794a` / `#e6f4ec` | argent reçu, payé | 4,8:1 |
| `--warn` / `--warn-soft` | `#8a5208` / `#fdf3dc` | reste dû, attention | 5,8:1 |
| `--bad` / `--bad-soft` | `#b42318` / `#fdecea` | perte, erreur, suppression | 5,8:1 |

Familles du tableau de bord (pastilles et filets, jamais du texte sur fond plein) :

| Jeton | Valeur | Famille |
|---|---|---|
| `--f-buy` / `--f-buy-soft` | `#0e7490` / `#e3f4f8` | achats (4,7:1) |
| `--f-due` / `--f-due-soft` | `#c2410c` / `#fdeee4` | ventes dues (4,6:1) |
| `--ok` / `--ok-soft` | | ventes |
| `--bad` / `--bad-soft` | | dépenses |
| `--f-customers` | `#c2185b` | clients (filet du compteur) |
| `--f-suppliers` | `#6d5dd3` | fournisseurs |
| `--accent` | | factures d'achat |
| `--ok` | | tickets de vente |

Séries des graphiques : palette catégorielle validée (daltonisme), ordre fixe, inchangée : `--s1` ventes `#2a78d6`,
`--s2` achats `#eb6834`, `--s3` dépenses `#1baf7a`, puis `--s4` à `--s8`.

## Texte

Inter (`'Inter Variable', system-ui, 'Segoe UI', Roboto, sans-serif`), `font-variant-numeric: tabular-nums` partout
où il y a des montants.

| Jeton | Taille / poids | Usage |
|---|---|---|
| `--fs-xs` | 12 px / 500 | libellés, métadonnées, en-têtes de tableau |
| `--fs-sm` | 13 px | tableaux, boutons |
| `--fs-md` | 14 px / 400, interligne 1,45 | texte courant |
| `--fs-lg` | 15 px / 600 | titres de panneau |
| `--fs-xl` | 20 px / 650 | valeurs des tuiles |
| `--fs-2xl` | 22 px / 700 | titre de page |
| `--fs-3xl` | 26 px / 700 | grands compteurs |

## Espacement, coins, ombres, plans

- Espacement, base 4 px : `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 24, `--sp-6` 32.
- Hauteurs : ligne de tableau `--row` 36 px, bouton et champ `--control` 34 px (`--control-sm` 32 px en petit), pastille
  d'icône `--chip` 40 px, barre du haut `--bar` 56 px, menu `--sidebar` 248 px.
- Coins : `--r-sm` 6 px (boutons, champs, pastilles), `--r-md` 8 px (panneaux, tuiles, fenêtres), `--r-full`
  999 px (badges).
- Ombres : aucune sur les panneaux. `--shadow-pop` `0 16px 40px rgb(22 24 29 / .18)` pour fenêtres et info-bulles.
- Focus : `--ring` `0 0 0 3px rgb(58 63 196 / .25)` sur les champs, anneau de 2 px Majorelle décalé de 2 px ailleurs.
- Voile derrière fenêtres et menu mobile : `--scrim` `rgb(22 24 29 / .4)`.
- Plans : info-bulles 5, barre du haut 10, voile 15, menu mobile 20, notification 30 ; fenêtres en `<dialog>` natif
  (couche du navigateur).

## Mouvement

| Jeton | Valeur | Usage |
|---|---|---|
| `--dur-fast` | 120 ms | survol, focus, appui, changement d'état |
| `--dur-enter` | 180 ms | fenêtre, info-bulle, notification qui apparaît |
| `--dur-exit` | 120 ms | ce qui disparaît |
| `--dur-chart` | 240 ms | barres, courbe, anneau au premier affichage |
| `--stagger` | 20 ms | écart entre deux barres |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | partout |
| `--rise` | 4 px | montée d'une fenêtre, d'une info-bulle, d'une notification |
| `--dur-spin` | 700 ms, linéaire | indicateur de chargement, seule boucle tolérée : il ne tourne que pendant une attente |

Interdit : agrandissement au survol, rebond, ressort, boucle infinie, apparition au défilement, compteurs animés,
animation de `width`, `height`, `top`, `left`. Seuls `opacity` et `transform` s'animent. Sous
`prefers-reduced-motion: reduce`, toutes les durées valent 0.

## Composants de base (5 états : repos, survol, focus, appui, désactivé)

- **Bouton principal** : fond `--accent`, texte blanc ; survol `--accent-strong` ; appui plus sombre ; focus anneau ;
  désactivé opacité 0,45.
- **Bouton secondaire** : fond blanc, bord `--field` ; survol fond `--surface-2` et bord `--ink-2` ; appui `--line`.
- **Bouton discret** (icône) : transparent ; survol `--surface-2`.
- **Bouton danger** : texte et bord `--bad` ; survol fond `--bad-soft`.
- **Champ** : bord `--field`, coin `--r-sm` ; focus bord `--accent` + `--ring` ; invalide bord `--bad`.
- **Panneau** : `--surface`, filet `--line`, coin `--r-md`, sans ombre.
- **Badge** : coin `--r-full`, fond doux de sa famille, texte de la couleur forte.
- **Lien** : `--accent`, souligné au survol.
- **Ligne de tableau** : 36 px, filet `--line-soft` ; survol `--accent-soft` ; cliquable = curseur main.

## Caisse (pos-caisse)

Mêmes jetons, mêmes règles, avec ce qu'impose un écran tactile tenu par une caissière pressée :

- Cibles de 44 px au moins (`--control` 44 px, `--control-sm` 36 px) au lieu de 34 et 32 px.
- Vert foncé `--ok-strong` `#0f5c37` (survol du bouton « Espèces »), filets `--ok-line` `#b5dcc6`,
  `--warn-line` `#f0d49b`, rouge foncé `--bad-strong` `#912018`.
- Le total à payer est un aplat `--accent`, texte `--on-accent` (7,8:1).
- `--dur-flash` 600 ms : une ligne ajoutée au panier ou un montant qui change s'allume en `--accent-soft`, puis s'éteint.
- Seule boucle tolérée : le voyant de synchro clignote pendant un envoi (une attente, comme un chargement).
- Retirés : onde au toucher, article qui vole vers le total, total qui défile, confettis, halos de fond.
