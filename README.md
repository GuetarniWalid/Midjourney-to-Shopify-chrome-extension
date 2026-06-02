# MyselfMonArt — Moteur de rendu des mockups

Ce dépôt contient le **moteur de rendu** des mockups (dossier [`webapp/`](webapp/)).

L'ancien système (extension Chrome + plugin Photoshop UXP + serveur WebSocket) a été **remplacé** :
- la génération des mockups se fait désormais en **headless via Photopea** (fidèle à Photoshop,
  sans Adobe ni plugin), piloté par le serveur de `webapp/` ;
- l'**interface utilisateur** (page « Publisher », mobile + desktop) est servie par le backend
  MyselfMonArt (`/publisher`) ; elle appelle ce moteur pour les rendus et le backend pour la
  publication Shopify.

➡️ Voir [`webapp/README.md`](webapp/README.md) pour l'installation, le lancement et le tunnel.
