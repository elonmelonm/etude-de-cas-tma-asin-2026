-- =============================================================================
-- Étude de cas TMA DEP/ASIN 2026 — Requêtes SQL de mesure d'impact (Section 5)
-- Date de référence de l'export : vendredi 20 novembre 2026 à 18 h 00 (GMT+1)
-- Compatible SQLite, PostgreSQL et MySQL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rendez-vous confirmés à venir pris un samedi ou un dimanche
--    (pour prévenir les usagers concernés)
-- -----------------------------------------------------------------------------
-- Note : tous les rendez-vous de week-end en base tombent un samedi :
--   2026-11-21, 2026-11-28, 2026-12-05 et 2026-12-12 (5 rendez-vous à venir).
--   (Les 3 samedis passés : 2026-10-31 et 2026-11-14 correspondent aux IDs 475, 715, 742).
SELECT
  id,
  npi,
  service,
  date_heure,
  statut,
  cree_le
FROM rendez_vous
WHERE statut = 'confirme'
  AND date_heure > '2026-11-20 18:00:00'
  AND CAST(strftime('%w', date_heure) AS INTEGER) IN (0, 6)
ORDER BY date_heure ASC, id ASC;

-- Équivalent standard PostgreSQL / MySQL (en commentaire pour portabilité) :
-- SELECT id, npi, service, date_heure, statut, cree_le
-- FROM rendez_vous
-- WHERE statut = 'confirme'
--   AND date_heure > TIMESTAMP '2026-11-20 18:00:00'
--   AND EXTRACT(DOW FROM date_heure) IN (0, 6) -- (PostgreSQL) ou DAYOFWEEK(date_heure) IN (1, 7) (MySQL)
-- ORDER BY date_heure ASC, id ASC


-- -----------------------------------------------------------------------------
-- 2. Créneaux qui comptent plus de 3 rendez-vous non annulés
-- -----------------------------------------------------------------------------
-- Résultat attendu : 3 créneaux (4 rendez-vous chacun) :
--   - 2026-10-22 10:30:00 (IDs 502, 511, 517, 519 — honorés)
--   - 2026-11-10 09:00:00 (IDs 632, 644, 681, 697 — honorés, cf. TMA-102)
--   - 2026-11-24 14:00:00 (IDs 728, 750, 763, 783 — confirmés à venir)
SELECT
  date_heure AS creneau,
  COUNT(*) AS nb_rendez_vous_non_annules
FROM rendez_vous
WHERE statut <> 'annule'
GROUP BY date_heure
HAVING COUNT(*) > 3
ORDER BY date_heure ASC;


-- -----------------------------------------------------------------------------
-- 3. Rendez-vous passés du statut « annulé » à un autre statut
-- -----------------------------------------------------------------------------
-- Résultat attendu : 4 rendez-vous (IDs 208, 231, 262, 292).
SELECT
  r.id AS rendez_vous_id,
  r.npi,
  r.service,
  r.date_heure,
  h.ancien_statut,
  h.nouveau_statut,
  h.modifie_le,
  h.modifie_par,
  r.statut AS statut_actuel
FROM historique_statuts h
INNER JOIN rendez_vous r ON r.id = h.rendez_vous_id
WHERE h.ancien_statut = 'annule'
  AND h.nouveau_statut <> 'annule'
ORDER BY h.modifie_le ASC, r.id ASC;


-- =============================================================================
-- BONUS : Requêtes d'audit complémentaires (Anomalies non signalées)
-- =============================================================================

-- Bonus A : Rendez-vous avec un NPI invalide (longueur != 10 chiffres)
-- Résultat : IDs 459 ('01234567890', 11 chiffres) et 642 ('061425364711', 12 chiffres)
SELECT
  id,
  npi,
  LENGTH(npi) AS longueur_npi,
  service,
  date_heure,
  statut
FROM rendez_vous
WHERE LENGTH(npi) <> 10
ORDER BY id ASC;

-- Bonus B : Rendez-vous pris sur des créneaux hors grille (après 15 h 30 : 16 h 00 et 16 h 30)
-- Résultat : IDs 490 (16:00), 698 (16:30) et 842 (2026-12-08 16:00:00, confirmé à venir)
SELECT
  id,
  npi,
  service,
  date_heure,
  statut
FROM rendez_vous
WHERE CAST(strftime('%H', date_heure) AS INTEGER) * 60 + CAST(strftime('%M', date_heure) AS INTEGER) > 930
   OR CAST(strftime('%H', date_heure) AS INTEGER) * 60 + CAST(strftime('%M', date_heure) AS INTEGER) < 480
   OR CAST(strftime('%M', date_heure) AS INTEGER) NOT IN (0, 30)
ORDER BY date_heure ASC;

-- Bonus C : Rendez-vous passés pris un samedi et restés bloqués au statut 'confirme'
-- Résultat : IDs 475 (2026-10-31), 715 (2026-11-14) et 742 (2026-11-14, cf. TMA-101)
SELECT
  id,
  npi,
  service,
  date_heure,
  statut
FROM rendez_vous
WHERE statut = 'confirme'
  AND date_heure <= '2026-11-20 18:00:00'
ORDER BY date_heure ASC;
