# 🎴 OmniDex — Collection de Aldeide

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-En%20Ligne-success?style=flat-square&logo=github)](https://aldeide.github.io/omnidex/)
[![Unique Cards](https://img.shields.io/badge/Cartes%20Uniques-1%20089-blue?style=flat-square)](https://aldeide.github.io/omnidex/)
[![Total Shards](https://img.shields.io/badge/%C3%89clats-14%20754-purple?style=flat-square)](https://aldeide.github.io/omnidex/)
[![Ace Cards](https://img.shields.io/badge/Cartes%20Ace-8-f59e0b?style=flat-square)](https://aldeide.github.io/omnidex/)

Visualiseur interactif et exportateur de données pour la collection de cartes **OmniDex** du compte **Aldeide** (ID `#39`).

🌐 **Consulter la collection en ligne : [https://aldeide.github.io/omnidex/](https://aldeide.github.io/omnidex/)**

---

## 📊 Statistiques de la Collection

- **Titulaire** : Aldeide (Compte `#39`)
- **Cartes uniques** : **1 089** (1 091 exemplaires au total)
- **Éclats disponibles (Shards)** : **14 754**
- **Cartes Ace (8)** : *Alain Delon*, *Alexandre Dumas*, *Audrey Hepburn*, *Elliot Page*, *Greta Thunberg*, *Jean-Paul Belmondo*, *Lisa (Blackpink)*, *Novak Djokovic*
- **Cartes Mythiques** : 15
- **Cartes Iconiques** : 28
- **Cartes Star** : 42
- **Cartes Célèbres** : 139
- **Cartes Connues** : 356
- **Cartes Méconnues** : 503
- **Finitions holographiques spéciales** : 138 cartes (Starlight, Fireworks, Négative, Holo, etc.)
- **Classeurs thématiques (9)** :
  - *Tueurs en Série* (66 cartes)
  - *Dictateurs* (43 cartes)
  - *Anthonys* (43 cartes)
  - *Keep (À garder)* (43 cartes)
  - *Pédophiles* (29 cartes)
  - *Nazis and Friends* (25 cartes)
  - *#metoo* (10 cartes)
  - *Amours* (8 cartes)
  - *Googlers* (5 cartes)

---

## 📁 Structure du Projet

- **`index.html`** : Application web statique en mode sombre, responsive, avec filtres par rareté, classeur, recherche textuelle et affichage des illustrations officielles.
- **`collection_data.js`** : Données complètes de la collection encapsulées en JavaScript pour un chargement direct sans restriction CORS (consultable hors-ligne via simple double-clic).
- **`aldeide_cards.json`** : Données brutes de la collection au format JSON standard.
- **`aldeide_cards.csv`** : Export tabulaire complet encodé en UTF-8 avec BOM (compatible directement avec Microsoft Excel et LibreOffice).
- **`update_collection.bat`** : Lanceur 1-clic pour Windows afin de synchroniser automatiquement les nouvelles cartes acquises depuis le serveur WebSocket `wss://omnidex.cards/ws`.
- **`update_collection.mjs`** : Script Node.js de mise à jour en direct via WebSocket.

---

## 🔄 Mise à Jour Automatique

Pour mettre à jour la collection après avoir ouvert de nouveaux boosters ou effectué des échanges sur OmniDex :
1. Double-cliquez sur `update_collection.bat` (ou exécutez `node update_collection.mjs`).
2. Le script se connecte au serveur officiel avec votre jeton de session, synchronise vos cartes, et met à jour instantanément les fichiers `collection_data.js`, `.json` et `.csv`.
3. Effectuez un `git commit` et `git push` pour mettre à jour la page GitHub Pages en direct !
