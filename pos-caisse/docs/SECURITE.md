# Sécurité de la caisse

Audit du 24 octobre 2026, sur la caisse (étapes 0 à 6) et la fausse API. `npm audit` : 0 vulnérabilité.

## Corrigé

| Gravité | Problème | Correction |
|---|---|---|
| Importante | Identifiant et mot de passe de test préremplis dans la version de production. | Préremplis en développement seulement ; le build n'en contient plus (`src/components/Login.tsx`). |
| Importante | Aucune politique de sécurité du contenu (CSP) : un script injecté pouvait lire le token (localStorage) et les clients (IndexedDB) et les envoyer n'importe où. | CSP ajoutée au build : seuls les fichiers de la caisse s'exécutent, et le réseau ne va que vers l'API de `VITE_API_URL` (`vite.config.ts`). |
| Importante | Rien n'empêchait une API en `http` en production : mot de passe et token lisibles sur le Wi-Fi du magasin. | En production, la caisse refuse de démarrer si l'API n'est pas en `https` (sauf API sur le poste lui-même) et n'envoie rien (`src/api/client.ts`). |
| Importante | Fausse API ouverte à tout le réseau, avec des tokens qui se fabriquent à la main (`tok.u_1.x` = administrateur), des mots de passe en clair et les clients en lecture. | Elle n'écoute plus que le poste (`127.0.0.1`) ; `HOST=0.0.0.0` pour l'ouvrir volontairement. Elle ne doit jamais être déployée. |
| Moyenne | Les clients consultés (nom, téléphone, matricule) restaient sur le poste partagé sans limite de temps. | Effacés à la déconnexion ; ils se reconstituent au fil des recherches. Les ventes à envoyer et en attente restent : elles appartiennent à la caisse. |
| Faible | `store_id` non encodé dans l'URL du catalogue. | Encodé. |

## À poser à l'hébergement

Une balise meta ne peut pas tout faire : ces en-têtes HTTP sont à configurer sur le serveur qui sert la caisse.

- HTTPS partout, avec `Strict-Transport-Security: max-age=31536000`.
- `Content-Security-Policy: frame-ancestors 'none'` (ou `X-Frame-Options: DENY`) : la caisse ne doit pas pouvoir être intégrée dans une autre page.
- `X-Content-Type-Options: nosniff` et `Referrer-Policy: no-referrer`.
- `index.html` et `sw.js` servis avec `Cache-Control: no-cache`, pour que les mises à jour arrivent.
- Ne pas déployer `mock-api/`.

## Propositions pour l'API (à valider avant de modifier le contrat)

1. **Accès par magasin** : `store_id` (catalogue, ventes) doit faire partie des magasins de l'utilisateur du token, sinon `403`. Aujourd'hui, c'est la caisse qui envoie le magasin choisi.
2. **Prix contrôlés par le serveur** : l'API recalcule les totaux à partir des lignes, mais ne compare pas les prix unitaires au catalogue. Un poste modifié pourrait vendre à 0,01 DH. Comparer `unit_price_ttc` au prix du catalogue, en tolérant un prix qui vient de changer (ventes hors ligne ou en attente), et fixer un plafond de remise (§8, point 5).
3. **Caissier** : `cashier_id` doit être cohérent avec l'utilisateur du token. Attention aux ventes faites hors ligne par un caissier et envoyées après la connexion du suivant : il faut accepter un caissier du même magasin.
4. **Tokens** : signés, à durée de vie limitée (un service), révocables. Une route `POST /api/auth/logout` permettrait d'invalider le token à la déconnexion.
5. **Connexion** : mots de passe hachés (bcrypt ou argon2), nombre de tentatives limité, même message d'erreur pour un identifiant ou un mot de passe faux.
6. **CORS** limité à l'adresse de la caisse.
7. **Clients** : recherche avec un minimum de caractères et un nombre de résultats limité, pour qu'on ne puisse pas lister toute la base.

## Risques acceptés côté caisse

- **Token dans localStorage** : un script injecté pourrait le lire ; la CSP rend cela beaucoup plus difficile. Un cookie `HttpOnly` serait plus sûr mais demande de changer le contrat (authentification par cookie, CORS avec identifiants).
- **Données sur le poste non chiffrées** (IndexedDB) : catalogue, ventes à envoyer, ventes en attente avec leur client. C'est le prix du hors ligne ; la session Windows du poste doit être protégée par un mot de passe.
- **Pas de verrouillage automatique** : une caisse laissée ouverte reste utilisable. À décider : verrouiller après quelques minutes d'inactivité.
- **Données de l'API mises en cache sans vérification** (articles, clients) : une valeur aberrante peut gêner l'affichage. À traiter dans la revue finale (étape 8, saisies aberrantes).
