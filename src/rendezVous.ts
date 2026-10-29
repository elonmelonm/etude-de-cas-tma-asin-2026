/**
 * Module de règles de gestion — Prise de rendez-vous au guichet (TMA DEP/ASIN 2026)
 *
 * Ce module est totalement indépendant de toute base de données et de tout framework.
 * Toutes les heures sont traitées à l'heure du Bénin (GMT+1, sans heure d'été).
 * L'heure courante (`maintenant`) est systématiquement reçue en paramètre afin de
 * garantir la reproductibilité et la testabilité déterministe.
 */

export const SERVICES_VALIDES = ['PASSEPORT', 'CNI', 'PERMIS'] as const;
export type ServiceRendezVous = (typeof SERVICES_VALIDES)[number];

export const STATUTS_VALIDES = ['confirme', 'honore', 'absent', 'annule'] as const;
export type StatutRendezVous = (typeof STATUTS_VALIDES)[number];

export const STATUTS_CLOTURE_AGENT = ['honore', 'absent'] as const;
export type StatutClotureAgent = (typeof STATUTS_CLOTURE_AGENT)[number];

export const CAPACITE_MAX_CRENEAU = 3;
export const TAILLE_PAGE_DEFAUT = 10;
export const DELAI_MIN_ANNULATION_HEURES = 24;
export const HEURE_OUVERTURE_MINUTES = 8 * 60; // 08:00 -> 480 min
export const HEURE_DERNIER_CRENEAU_MINUTES = 15 * 60 + 30; // 15:30 -> 930 min
export const DUREE_CRENEAU_MINUTES = 30;

/**
 * Table officielle des messages et codes HTTP de refus (Section 2 du sujet).
 */
export const ERREURS_METIER = {
  NPI_INVALIDE: {
    codeHttp: 400,
    message: 'Le NPI doit comporter exactement 10 chiffres.',
  },
  SERVICE_INCONNU: {
    codeHttp: 400,
    message: 'Service inconnu : choisissez PASSEPORT, CNI ou PERMIS.',
  },
  DATE_HEURE_ILLISIBLE: {
    codeHttp: 400,
    message: 'Date et heure invalides (format attendu : AAAA-MM-JJTHH:MM).',
  },
  DATE_PASSEE: {
    codeHttp: 409,
    message: 'Impossible de prendre un rendez-vous dans le passé.',
  },
  WEEK_END: {
    codeHttp: 409,
    message: 'Le centre est fermé le week-end.',
  },
  HEURE_HORS_GRILLE: {
    codeHttp: 409,
    message: 'Créneau invalide : de 08:00 à 15:30, toutes les 30 minutes.',
  },
  RDV_DEJA_A_VENIR: {
    codeHttp: 409,
    message: 'Vous avez déjà un rendez-vous à venir.',
  },
  CRENEAU_PLEIN: {
    codeHttp: 409,
    message: 'Ce créneau est complet.',
  },
  ANNULATION_NON_CONFIRME: {
    codeHttp: 409,
    message: 'Ce rendez-vous ne peut plus être annulé.',
  },
  ANNULATION_TARDIVE: {
    codeHttp: 409,
    message: 'Annulation impossible moins de 24 h avant le rendez-vous.',
  },
  STATUT_INCONNU: {
    codeHttp: 400,
    message: 'Statut invalide : honore ou absent.',
  },
  RDV_DEJA_CLOTURE: {
    codeHttp: 409,
    message: 'Ce rendez-vous est déjà clôturé.',
  },
} as const;

export interface RendezVous {
  id?: number;
  npi: string;
  service: ServiceRendezVous | string;
  dateHeure: string;
  statut: StatutRendezVous | string;
  creeLe?: string;
}

export interface DemandeCreationRendezVous {
  npi: unknown;
  service: unknown;
  dateHeure: unknown;
}

export type ResultatValidation<T> =
  | {
      succes: true;
      codeHttp: 200 | 201;
      donnees: T;
    }
  | {
      succes: false;
      codeHttp: 400 | 409;
      erreur: string;
    };

export interface PageRendezVous {
  page: number;
  parPage: number;
  total: number;
  totalPages: number;
  rendezVous: RendezVous[];
}

interface ComposantesDateBenin {
  annee: number;
  mois: number;
  jour: number;
  heure: number;
  minute: number;
  seconde: number;
  timestampMs: number;
  jourSemaine: number; // 0 = Dimanche ... 6 = Samedi
  isoMinute: string; // AAAA-MM-JJTHH:MM
}

/**
 * Analyse et valide une date/heure exprimée à l'heure du Bénin (GMT+1).
 *
 * - Pour une saisie utilisateur (`modeStrictIso = true`), exige le format `AAAA-MM-JJTHH:MM`
 *   (tolère optionnellement `:00` pour les secondes).
 * - Pour une date issue de la base ou horloge (`modeStrictIso = false`), accepte aussi
 *   le séparateur espace `AAAA-MM-JJ HH:MM(:SS)` ou un objet `Date`.
 */
export const analyserDateHeureBenin = (
  valeur: unknown,
  modeStrictIso = true
): ComposantesDateBenin | null => {
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) {
      return null;
    }
    // Conversion en heure du Bénin (UTC+1)
    const decalageBeninMs = 60 * 60 * 1000;
    const dateBenin = new Date(valeur.getTime() + decalageBeninMs);
    const annee = dateBenin.getUTCFullYear();
    const mois = dateBenin.getUTCMonth() + 1;
    const jour = dateBenin.getUTCDate();
    const heure = dateBenin.getUTCHours();
    const minute = dateBenin.getUTCMinutes();
    const seconde = dateBenin.getUTCSeconds();
    return {
      annee,
      mois,
      jour,
      heure,
      minute,
      seconde,
      timestampMs: Date.UTC(annee, mois - 1, jour, heure - 1, minute, seconde),
      jourSemaine: dateBenin.getUTCDay(),
      isoMinute: `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}T${String(heure).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  }

  if (typeof valeur !== 'string') {
    return null;
  }

  const texte = valeur.trim();
  const regex = modeStrictIso
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
    : /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

  const match = regex.exec(texte);
  let annee: number;
  let mois: number;
  let jour: number;
  let heure: number;
  let minute: number;
  let seconde: number;

  if (match) {
    annee = Number(match[1]);
    mois = Number(match[2]);
    jour = Number(match[3]);
    heure = Number(match[4]);
    minute = Number(match[5]);
    seconde = match[6] !== undefined ? Number(match[6]) : 0;
  } else if (!modeStrictIso) {
    // Tolérance en lecture (mode non-strict) pour le format français JJ/MM/AAAA HH:MM(:SS)
    // observé dans les traces de production (cf. TMA-101, TMA-106 et Bonus 5)
    const matchFr = /^(\d{2})\/(\d{2})\/(\d{4})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texte);
    if (!matchFr) {
      return null;
    }
    jour = Number(matchFr[1]);
    mois = Number(matchFr[2]);
    annee = Number(matchFr[3]);
    heure = Number(matchFr[4]);
    minute = Number(matchFr[5]);
    seconde = matchFr[6] !== undefined ? Number(matchFr[6]) : 0;
  } else {
    return null;
  }

  if (
    mois < 1 ||
    mois > 12 ||
    jour < 1 ||
    jour > 31 ||
    heure < 0 ||
    heure > 23 ||
    minute < 0 ||
    minute > 59 ||
    seconde < 0 ||
    seconde > 59
  ) {
    return null;
  }

  // En mode saisie de créneau strict, les secondes éventuelles doivent être à 00
  if (modeStrictIso && seconde !== 0) {
    return null;
  }

  // Vérification de l'existence réelle de la date dans le calendrier (ex: rejet du 30 février ou 31 novembre)
  const dateRefUtc = new Date(Date.UTC(annee, mois - 1, jour, heure, minute, seconde));
  if (
    dateRefUtc.getUTCFullYear() !== annee ||
    dateRefUtc.getUTCMonth() + 1 !== mois ||
    dateRefUtc.getUTCDate() !== jour
  ) {
    return null;
  }

  // Timestamp absolu : heure du Bénin = UTC+1, donc UTC = heure_benin - 1h
  const timestampMs = Date.UTC(annee, mois - 1, jour, heure - 1, minute, seconde);
  const jourSemaine = dateRefUtc.getUTCDay(); // 0 = Dimanche, 1 = Lundi, ..., 6 = Samedi

  return {
    annee,
    mois,
    jour,
    heure,
    minute,
    seconde,
    timestampMs,
    jourSemaine,
    isoMinute: `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}T${String(heure).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
};

/**
 * Vérifie si un NPI est composé d'exactement 10 chiffres (0-9).
 * Corrige TMA-103 (lettres dans le NPI) et le Bonus 1 (NPI de 11 ou 12 chiffres).
 */
export const estNpiValide = (npi: unknown): npi is string => {
  return typeof npi === 'string' && /^\d{10}$/.test(npi);
};

/**
 * Vérifie si le service demandé fait partie des 3 services autorisés.
 */
export const estServiceValide = (service: unknown): service is ServiceRendezVous => {
  return (
    typeof service === 'string' &&
    (SERVICES_VALIDES as readonly string[]).includes(service)
  );
};

/**
 * Contrôle et valide une demande de prise de rendez-vous selon l'ensemble
 * des règles de la section 2.
 *
 * @param demande Données saisies (`npi`, `service`, `dateHeure`)
 * @param rendezVousExistants Liste des rendez-vous existants en base
 * @param maintenant Date/heure courante (heure du Bénin, ISO ou Date)
 */
export const prendreRendezVous = (
  demande: DemandeCreationRendezVous,
  rendezVousExistants: readonly RendezVous[],
  maintenant: string | Date
): ResultatValidation<RendezVous> => {
  // 1. Validation du NPI (exactement 10 chiffres) — TMA-103 & Bonus 1
  if (!estNpiValide(demande.npi)) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.NPI_INVALIDE.codeHttp,
      erreur: ERREURS_METIER.NPI_INVALIDE.message,
    };
  }

  // 2. Validation du service ('PASSEPORT', 'CNI', 'PERMIS')
  if (!estServiceValide(demande.service)) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.SERVICE_INCONNU.codeHttp,
      erreur: ERREURS_METIER.SERVICE_INCONNU.message,
    };
  }

  // 3. Validation du format et de l'existence calendaire de la date et heure
  const dateDemandee = analyserDateHeureBenin(demande.dateHeure, true);
  if (!dateDemandee) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.DATE_HEURE_ILLISIBLE.codeHttp,
      erreur: ERREURS_METIER.DATE_HEURE_ILLISIBLE.message,
    };
  }

  const horloge = analyserDateHeureBenin(maintenant, false);
  if (!horloge) {
    throw new Error('Paramètre `maintenant` invalide.');
  }

  // 4. Contrôle de date passée
  if (dateDemandee.timestampMs <= horloge.timestampMs) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.DATE_PASSEE.codeHttp,
      erreur: ERREURS_METIER.DATE_PASSEE.message,
    };
  }

  // 5. Contrôle des jours d'ouverture : lundi (1) à vendredi (5) — TMA-101
  if (dateDemandee.jourSemaine === 0 || dateDemandee.jourSemaine === 6) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.WEEK_END.codeHttp,
      erreur: ERREURS_METIER.WEEK_END.message,
    };
  }

  // 6. Contrôle de la grille horaire : de 08:00 à 15:30, par pas de 30 minutes — Bonus 2
  const minutesDepuisMinuit = dateDemandee.heure * 60 + dateDemandee.minute;
  const estSurPasDe30Min =
    dateDemandee.minute % DUREE_CRENEAU_MINUTES === 0 && dateDemandee.seconde === 0;
  const estDansPlageOuverture =
    minutesDepuisMinuit >= HEURE_OUVERTURE_MINUTES &&
    minutesDepuisMinuit <= HEURE_DERNIER_CRENEAU_MINUTES;

  if (!estSurPasDe30Min || !estDansPlageOuverture) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.HEURE_HORS_GRILLE.codeHttp,
      erreur: ERREURS_METIER.HEURE_HORS_GRILLE.message,
    };
  }

  // 7. Contrôle d'unicité du rendez-vous à venir pour l'usager, tous services confondus — TMA-107, Bonus 3 & Bonus 4
  const aDejaRendezVousAVenir = rendezVousExistants.some((rdv) => {
    if (rdv.npi !== demande.npi || rdv.statut !== 'confirme') {
      return false;
    }
    const dateRdv = analyserDateHeureBenin(rdv.dateHeure, false);
    return dateRdv !== null && dateRdv.timestampMs > horloge.timestampMs;
  });

  if (aDejaRendezVousAVenir) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.RDV_DEJA_A_VENIR.codeHttp,
      erreur: ERREURS_METIER.RDV_DEJA_A_VENIR.message,
    };
  }

  // 8. Contrôle de capacité du créneau : au plus 3 usagers non annulés — TMA-102
  const nbRendezVousActifsSurCreneau = rendezVousExistants.filter((rdv) => {
    if (rdv.statut === 'annule') {
      return false;
    }
    const dateRdv = analyserDateHeureBenin(rdv.dateHeure, false);
    return dateRdv !== null && dateRdv.isoMinute === dateDemandee.isoMinute;
  }).length;

  if (nbRendezVousActifsSurCreneau >= CAPACITE_MAX_CRENEAU) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.CRENEAU_PLEIN.codeHttp,
      erreur: ERREURS_METIER.CRENEAU_PLEIN.message,
    };
  }

  const nouveauRendezVous: RendezVous = {
    npi: demande.npi,
    service: demande.service,
    dateHeure: dateDemandee.isoMinute,
    statut: 'confirme',
    creeLe: horloge.isoMinute,
  };

  return {
    succes: true,
    codeHttp: 201,
    donnees: nouveauRendezVous,
  };
};

/**
 * Contrôle et exécute l'annulation d'un rendez-vous par l'usager.
 * Corrige TMA-104 (calcul exact de l'écart en heures >= 24 h).
 *
 * @param rendezVous Le rendez-vous ciblé
 * @param maintenant Date/heure courante (heure du Bénin)
 */
export const annulerRendezVous = (
  rendezVous: RendezVous,
  maintenant: string | Date
): ResultatValidation<RendezVous> => {
  // 1. Seul un rendez-vous au statut 'confirme' peut être annulé
  if (rendezVous.statut !== 'confirme') {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.ANNULATION_NON_CONFIRME.codeHttp,
      erreur: ERREURS_METIER.ANNULATION_NON_CONFIRME.message,
    };
  }

  const dateRdv = analyserDateHeureBenin(rendezVous.dateHeure, false);
  const horloge = analyserDateHeureBenin(maintenant, false);

  if (!dateRdv || !horloge) {
    throw new Error('Date du rendez-vous ou paramètre `maintenant` invalide.');
  }

  // 2. Délai de prévenance : jusqu'à 24 heures avant l'heure prévue (écart total >= 24h) — TMA-104
  const delaiMinMs = DELAI_MIN_ANNULATION_HEURES * 60 * 60 * 1000;
  const ecartMs = dateRdv.timestampMs - horloge.timestampMs;

  if (ecartMs < delaiMinMs) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.ANNULATION_TARDIVE.codeHttp,
      erreur: ERREURS_METIER.ANNULATION_TARDIVE.message,
    };
  }

  return {
    succes: true,
    codeHttp: 200,
    donnees: {
      ...rendezVous,
      statut: 'annule',
    },
  };
};

/**
 * Contrôle et applique un changement de statut par un agent ('honore' ou 'absent').
 * Corrige TMA-105 (les statuts 'honore', 'absent' et 'annule' sont définitifs).
 *
 * @param rendezVous Le rendez-vous ciblé
 * @param nouveauStatut Le statut demandé par l'agent
 * @param _maintenant Date/heure courante (optionnelle, conservée pour homogénéité de signature)
 */
export const changerStatutRendezVous = (
  rendezVous: RendezVous,
  nouveauStatut: unknown,
  _maintenant?: string | Date
): ResultatValidation<RendezVous> => {
  // 1. Le statut demandé par un agent doit être 'honore' ou 'absent'
  if (
    typeof nouveauStatut !== 'string' ||
    !(STATUTS_CLOTURE_AGENT as readonly string[]).includes(nouveauStatut)
  ) {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.STATUT_INCONNU.codeHttp,
      erreur: ERREURS_METIER.STATUT_INCONNU.message,
    };
  }

  // 2. Un rendez-vous déjà 'honore', 'absent' ou 'annule' est définitivement clôturé — TMA-105
  if (rendezVous.statut !== 'confirme') {
    return {
      succes: false,
      codeHttp: ERREURS_METIER.RDV_DEJA_CLOTURE.codeHttp,
      erreur: ERREURS_METIER.RDV_DEJA_CLOTURE.message,
    };
  }

  return {
    succes: true,
    codeHttp: 200,
    donnees: {
      ...rendezVous,
      statut: nouveauStatut as StatutClotureAgent,
    },
  };
};

/**
 * Trie et découpe en pages de 10 les rendez-vous d'un usager.
 * Règle : « Les rendez-vous d'un usager sont listés du plus récent au plus ancien,
 * le prochain rendez-vous en tête, par pages de 10. »
 * Corrige TMA-106 (tri chronologique sur la date réelle et non tri alphabétique sur JJ/MM/AAAA).
 *
 * @param rendezVous Liste de rendez-vous (déjà filtrée ou globale)
 * @param maintenant Date/heure courante (heure du Bénin)
 * @param page Numéro de page (1-indexé, défaut : 1)
 * @param parPage Nombre d'éléments par page (défaut : 10)
 * @param npi Filtre optionnel par NPI de l'usager
 */
export const listerRendezVousUsager = (
  rendezVous: readonly RendezVous[],
  maintenant: string | Date,
  page = 1,
  parPage = TAILLE_PAGE_DEFAUT,
  npi?: string
): PageRendezVous => {
  const horloge = analyserDateHeureBenin(maintenant, false);
  if (!horloge) {
    throw new Error('Paramètre `maintenant` invalide.');
  }

  const pageNormalisee = Math.max(1, Math.floor(page));
  const taillePage = Math.max(1, Math.floor(parPage));

  const listeFiltree = npi
    ? rendezVous.filter((rdv) => rdv.npi === npi)
    : [...rendezVous];

  const avecTimestamp = listeFiltree.map((rdv) => {
    const parsed = analyserDateHeureBenin(rdv.dateHeure, false);
    const timestampMs = parsed ? parsed.timestampMs : 0;
    const estProchainAVenir =
      rdv.statut === 'confirme' && timestampMs > horloge.timestampMs;
    return {
      rdv,
      timestampMs,
      estProchainAVenir,
    };
  });

  avecTimestamp.sort((a, b) => {
    // 1. Le prochain rendez-vous confirmé à venir est toujours placé en tête
    if (a.estProchainAVenir !== b.estProchainAVenir) {
      return a.estProchainAVenir ? -1 : 1;
    }
    // Si plusieurs rendez-vous à venir existent (anomalie historique), le plus proche vient en premier
    if (a.estProchainAVenir && b.estProchainAVenir) {
      return a.timestampMs - b.timestampMs;
    }
    // 2. Tous les autres rendez-vous sont triés du plus récent au plus ancien (chronologique décroissant)
    return b.timestampMs - a.timestampMs;
  });

  const tries = avecTimestamp.map((item) => item.rdv);
  const total = tries.length;
  const totalPages = Math.max(1, Math.ceil(total / taillePage));
  const debut = (pageNormalisee - 1) * taillePage;
  const tranche = tries.slice(debut, debut + taillePage);

  return {
    page: pageNormalisee,
    parPage: taillePage,
    total,
    totalPages,
    rendezVous: tranche,
  };
};
