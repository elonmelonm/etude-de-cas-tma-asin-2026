import {
  annulerRendezVous,
  changerStatutRendezVous,
  ERREURS_METIER,
  listerRendezVousUsager,
  prendreRendezVous,
  RendezVous,
} from '../src/rendezVous';

describe('Module de règles de gestion — Prise de rendez-vous au guichet (TMA DEP/ASIN 2026)', () => {
  const DATE_EXPORT = '2026-11-20T18:00';

  describe('1. Reproduction et validation des 7 tickets TMA (Section 4)', () => {
    /**
     * TMA-101 : « J’ai pris rendez-vous pour le samedi 14 novembre. Une fois sur place, j’ai trouvé le centre fermé. »
     * Trace : POST /api/rendez-vous {"npi":"0614253647","service":"PASSEPORT","dateHeure":"2026-11-14T10:00"}
     * Date de création en base (RDV n°742) : 2026-11-09 23:59:11
     */
    it('should reject a Saturday appointment with HTTP 409 when replaying ticket TMA-101', () => {
      const maintenant = '2026-11-09T23:59:11';
      const resultat = prendreRendezVous(
        {
          npi: '0614253647',
          service: 'PASSEPORT',
          dateHeure: '2026-11-14T10:00', // Samedi 14 novembre 2026
        },
        [],
        maintenant
      );

      expect(resultat).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: 'Le centre est fermé le week-end.',
      });
    });

    /**
     * TMA-102 : « Le mardi 10 novembre à 9 h 00, quatre usagers avaient rendez-vous sur le même créneau. Nous n’avons que trois guichets. »
     * En base : RDV n°632 (PASSEPORT), n°644 (CNI), n°681 (PERMIS) existaient déjà avant la réservation du n°697 le 2026-11-04 23:43:37.
     */
    it('should reject a 4th booking on the same slot with HTTP 409 when replaying ticket TMA-102', () => {
      const maintenant = '2026-11-04T23:43:37';
      const creneau10Nov09h: RendezVous[] = [
        {
          id: 632,
          npi: '0638958971',
          service: 'PASSEPORT',
          dateHeure: '2026-11-10 09:00:00',
          statut: 'confirme',
          creeLe: '2026-10-28 03:47:09',
        },
        {
          id: 644,
          npi: '0671968463',
          service: 'CNI',
          dateHeure: '2026-11-10 09:00:00',
          statut: 'confirme',
          creeLe: '2026-10-30 00:20:56',
        },
        {
          id: 681,
          npi: '0609394161',
          service: 'PERMIS',
          dateHeure: '2026-11-10 09:00:00',
          statut: 'confirme',
          creeLe: '2026-11-02 18:47:35',
        },
      ];

      // Tentative de réservation du 4e rendez-vous (n°697)
      const resultat = prendreRendezVous(
        {
          npi: '0620214467',
          service: 'CNI',
          dateHeure: '2026-11-10T09:00',
        },
        creneau10Nov09h,
        maintenant
      );

      expect(resultat).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: 'Ce créneau est complet.',
      });
    });

    /**
     * TMA-103 : « Quand un usager tape une lettre dans son NPI, l’écran affiche “Erreur interne du serveur” au lieu d’expliquer le problème. »
     * Trace : POST /api/rendez-vous {"npi":"06142A3647","service":"CNI","dateHeure":"2026-11-23T09:00"}
     */
    it('should return HTTP 400 with explicit validation message instead of 500 when NPI contains a letter (TMA-103)', () => {
      const resultat = prendreRendezVous(
        {
          npi: '06142A3647',
          service: 'CNI',
          dateHeure: '2026-11-23T09:00',
        },
        [],
        DATE_EXPORT
      );

      expect(resultat).toEqual({
        succes: false,
        codeHttp: 400,
        erreur: 'Le NPI doit comporter exactement 10 chiffres.',
      });
    });

    /**
     * TMA-104 : « Le mardi 17 novembre à 18 h, j’ai voulu annuler mon rendez-vous du jeudi 19 à 10 h.
     * L’application a refusé : “Annulation impossible moins de 24 h avant”. »
     * En base : RDV n°709 du 2026-11-19 10:00:00 (écart réel = 40 heures >= 24 heures).
     */
    it('should allow cancellation 40 hours before appointment with HTTP 200 when replaying ticket TMA-104', () => {
      const rdv709: RendezVous = {
        id: 709,
        npi: '0339205992',
        service: 'PERMIS',
        dateHeure: '2026-11-19 10:00:00',
        statut: 'confirme',
        creeLe: '2026-11-06 11:04:18',
      };

      const resultat = annulerRendezVous(rdv709, '2026-11-17T18:00');

      expect(resultat).toEqual({
        succes: true,
        codeHttp: 200,
        donnees: {
          ...rdv709,
          statut: 'annule',
        },
      });
    });

    /**
     * TMA-105 : « J’ai cliqué par erreur sur “Honoré” pour un rendez-vous que l’usager avait annulé.
     * L’application a accepté, et le rendez-vous apparaît maintenant comme honoré. »
     * En base : RDV n°292 (npi 0330677555, PASSEPORT, 2026-11-12 10:00:00), annulé le 23/09/2026.
     */
    it('should reject marking a cancelled appointment as honore with HTTP 409 when replaying ticket TMA-105', () => {
      const rdv292Annule: RendezVous = {
        id: 292,
        npi: '0330677555',
        service: 'PASSEPORT',
        dateHeure: '2026-11-12 10:00:00',
        statut: 'annule',
        creeLe: '2026-09-19 09:18:00',
      };

      const resultat = changerStatutRendezVous(
        rdv292Annule,
        'honore',
        '2026-11-12T10:13:00'
      );

      expect(resultat).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: 'Ce rendez-vous est déjà clôturé.',
      });
    });

    /**
     * TMA-106 : « Dans “Mes rendez-vous”, mon prochain rendez-vous, celui du 2 décembre,
     * n’est pas en haut de la liste. Il n’est même pas sur la première page. »
     * En base : Usager 0203040506 possède 13 rendez-vous (IDs 1 à 11, 259, et 826 du 02/12/2026 à 08:30).
     */
    it('should place the December 2nd upcoming appointment first and sort chronologically by page of 10 (TMA-106)', () => {
      const rdvUsager0203040506: RendezVous[] = [
        { id: 1, npi: '0203040506', service: 'PASSEPORT', dateHeure: '2026-01-05 08:30:00', statut: 'honore' },
        { id: 2, npi: '0203040506', service: 'CNI', dateHeure: '2026-02-12 10:00:00', statut: 'honore' },
        { id: 3, npi: '0203040506', service: 'PERMIS', dateHeure: '2026-03-03 14:30:00', statut: 'absent' },
        { id: 4, npi: '0203040506', service: 'PASSEPORT', dateHeure: '2026-04-21 09:00:00', statut: 'honore' },
        { id: 5, npi: '0203040506', service: 'CNI', dateHeure: '2026-05-08 11:30:00', statut: 'honore' },
        { id: 6, npi: '0203040506', service: 'PERMIS', dateHeure: '2026-05-19 15:00:00', statut: 'absent' },
        { id: 7, npi: '0203040506', service: 'PASSEPORT', dateHeure: '2026-06-02 08:00:00', statut: 'honore' },
        { id: 8, npi: '0203040506', service: 'CNI', dateHeure: '2026-06-16 13:30:00', statut: 'honore' },
        { id: 9, npi: '0203040506', service: 'PERMIS', dateHeure: '2026-07-07 10:30:00', statut: 'honore' },
        { id: 10, npi: '0203040506', service: 'PASSEPORT', dateHeure: '2026-07-28 09:30:00', statut: 'absent' },
        { id: 11, npi: '0203040506', service: 'CNI', dateHeure: '2026-08-11 14:00:00', statut: 'honore' },
        { id: 259, npi: '0203040506', service: 'PERMIS', dateHeure: '2026-09-25 11:00:00', statut: 'honore' },
        { id: 826, npi: '0203040506', service: 'PASSEPORT', dateHeure: '2026-12-02 08:30:00', statut: 'confirme' },
      ];

      const page1 = listerRendezVousUsager(rdvUsager0203040506, DATE_EXPORT, 1, 10, '0203040506');
      const page2 = listerRendezVousUsager(rdvUsager0203040506, DATE_EXPORT, 2, 10, '0203040506');

      expect(page1.page).toBe(1);
      expect(page1.parPage).toBe(10);
      expect(page1.total).toBe(13);
      expect(page1.totalPages).toBe(2);
      expect(page1.rendezVous).toHaveLength(10);

      // Le prochain rendez-vous (02/12/2026, id 826) est en tête, suivi des plus récents aux plus anciens
      expect(page1.rendezVous.map((r) => r.id)).toEqual([
        826, // 2026-12-02 08:30 (prochain RDV en tête)
        259, // 2026-09-25 11:00
        11,  // 2026-08-11 14:00
        10,  // 2026-07-28 09:30
        9,   // 2026-07-07 10:30
        8,   // 2026-06-16 13:30
        7,   // 2026-06-02 08:00
        6,   // 2026-05-19 15:00
        5,   // 2026-05-08 11:30
        4,   // 2026-04-21 09:00
      ]);

      expect(page2.rendezVous.map((r) => r.id)).toEqual([
        3, // 2026-03-03 14:30
        2, // 2026-02-12 10:00
        1, // 2026-01-05 08:30
      ]);
    });

    /**
     * TMA-107 (Ticket conforme) : « J’ai un rendez-vous pour mon passeport la semaine prochaine.
     * Je ne peux pas en prendre un autre pour retirer mon permis. »
     * En base : RDV n°800 (npi 0102030405, PASSEPORT, 2026-11-26 10:00:00, confirme).
     * Trace : POST /api/rendez-vous {"npi":"0102030405","service":"PERMIS","dateHeure":"2026-11-27T09:00"} -> 409
     */
    it('should confirm compliant behavior by rejecting a second upcoming appointment for another service with HTTP 409 (TMA-107)', () => {
      const rdvExistant800: RendezVous[] = [
        {
          id: 800,
          npi: '0102030405',
          service: 'PASSEPORT',
          dateHeure: '2026-11-26 10:00:00',
          statut: 'confirme',
          creeLe: '2026-11-16 08:51:02',
        },
      ];

      const resultat = prendreRendezVous(
        {
          npi: '0102030405',
          service: 'PERMIS',
          dateHeure: '2026-11-27T09:00',
        },
        rdvExistant800,
        DATE_EXPORT
      );

      expect(resultat).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: 'Vous avez déjà un rendez-vous à venir.',
      });
    });
  });

  describe('2. Couverture exhaustive des règles de gestion et anomalies Bonus', () => {
    it('should reject NPIs with 11 or 12 digits found in database audit (Bonus 1: IDs 459 and 642)', () => {
      const rdv459 = prendreRendezVous(
        { npi: '01234567890', service: 'PERMIS', dateHeure: '2026-11-25T09:30' },
        [],
        DATE_EXPORT
      );
      const rdv642 = prendreRendezVous(
        { npi: '061425364711', service: 'PERMIS', dateHeure: '2026-11-25T14:00' },
        [],
        DATE_EXPORT
      );

      expect(rdv459).toEqual({
        succes: false,
        codeHttp: 400,
        erreur: ERREURS_METIER.NPI_INVALIDE.message,
      });
      expect(rdv642).toEqual({
        succes: false,
        codeHttp: 400,
        erreur: ERREURS_METIER.NPI_INVALIDE.message,
      });
    });

    it('should reject slots at 16:00 and 16:30 found in database audit (Bonus 2: IDs 490, 698, 842)', () => {
      const a16h00 = prendreRendezVous(
        { npi: '0387129160', service: 'PASSEPORT', dateHeure: '2026-12-08T16:00' },
        [],
        DATE_EXPORT
      );
      const a16h30 = prendreRendezVous(
        { npi: '0051291680', service: 'PASSEPORT', dateHeure: '2026-11-25T16:30' },
        [],
        DATE_EXPORT
      );
      const avant08h00 = prendreRendezVous(
        { npi: '0051291680', service: 'PASSEPORT', dateHeure: '2026-11-25T07:30' },
        [],
        DATE_EXPORT
      );
      const horsPas30Min = prendreRendezVous(
        { npi: '0051291680', service: 'PASSEPORT', dateHeure: '2026-11-25T10:15' },
        [],
        DATE_EXPORT
      );

      for (const res of [a16h00, a16h30, avant08h00, horsPas30Min]) {
        expect(res).toEqual({
          succes: false,
          codeHttp: 409,
          erreur: ERREURS_METIER.HEURE_HORS_GRILLE.message,
        });
      }
    });

    it('should allow booking at boundary slots 08:00 and 15:30 on a weekday', () => {
      const a08h00 = prendreRendezVous(
        { npi: '0123456789', service: 'CNI', dateHeure: '2026-11-23T08:00' },
        [],
        DATE_EXPORT
      );
      const a15h30 = prendreRendezVous(
        { npi: '9876543210', service: 'PERMIS', dateHeure: '2026-11-23T15:30' },
        [],
        DATE_EXPORT
      );

      expect(a08h00.succes).toBe(true);
      expect(a15h30.succes).toBe(true);
    });

    it('should not block a user whose past Saturday appointment remained stuck in confirme status (Bonus 4: ID 742)', () => {
      const rdvPasseBloqueEnConfirme: RendezVous[] = [
        {
          id: 742,
          npi: '0614253647',
          service: 'PASSEPORT',
          dateHeure: '2026-11-14 10:00:00', // Passé par rapport au 20/11/2026
          statut: 'confirme',
        },
      ];

      const resultat = prendreRendezVous(
        {
          npi: '0614253647',
          service: 'PASSEPORT',
          dateHeure: '2026-11-25T10:00',
        },
        rdvPasseBloqueEnConfirme,
        DATE_EXPORT
      );

      expect(resultat.succes).toBe(true);
      expect(resultat.codeHttp).toBe(201);
    });

    it('should free up a slot when one of the 3 appointments is cancelled', () => {
      const creneauAvecUnAnnule: RendezVous[] = [
        { id: 1, npi: '1111111111', service: 'CNI', dateHeure: '2026-11-25T09:00', statut: 'confirme' },
        { id: 2, npi: '2222222222', service: 'PASSEPORT', dateHeure: '2026-11-25T09:00', statut: 'confirme' },
        { id: 3, npi: '3333333333', service: 'PERMIS', dateHeure: '2026-11-25T09:00', statut: 'annule' },
      ];

      const resultat = prendreRendezVous(
        { npi: '4444444444', service: 'CNI', dateHeure: '2026-11-25T09:00' },
        creneauAvecUnAnnule,
        DATE_EXPORT
      );

      expect(resultat.succes).toBe(true);
      expect(resultat.codeHttp).toBe(201);
    });

    it('should reject unknown service, malformed dates, non-existent calendar dates, past dates, and Sunday dates', () => {
      expect(
        prendreRendezVous(
          { npi: '0123456789', service: 'VISA', dateHeure: '2026-11-25T10:00' },
          [],
          DATE_EXPORT
        )
      ).toEqual({
        succes: false,
        codeHttp: 400,
        erreur: ERREURS_METIER.SERVICE_INCONNU.message,
      });

      expect(
        prendreRendezVous(
          { npi: '0123456789', service: 'CNI', dateHeure: '25/11/2026 10:00' },
          [],
          DATE_EXPORT
        )
      ).toEqual({
        succes: false,
        codeHttp: 400,
        erreur: ERREURS_METIER.DATE_HEURE_ILLISIBLE.message,
      });

      // Date calendaire inexistante : 31 novembre
      expect(
        prendreRendezVous(
          { npi: '0123456789', service: 'CNI', dateHeure: '2026-11-31T10:00' },
          [],
          DATE_EXPORT
        )
      ).toEqual({
        succes: false,
        codeHttp: 400,
        erreur: ERREURS_METIER.DATE_HEURE_ILLISIBLE.message,
      });

      // Date passée
      expect(
        prendreRendezVous(
          { npi: '0123456789', service: 'CNI', dateHeure: '2026-11-19T10:00' },
          [],
          DATE_EXPORT
        )
      ).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: ERREURS_METIER.DATE_PASSEE.message,
      });

      // Dimanche 22 novembre 2026
      expect(
        prendreRendezVous(
          { npi: '0123456789', service: 'CNI', dateHeure: '2026-11-22T10:00' },
          [],
          DATE_EXPORT
        )
      ).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: ERREURS_METIER.WEEK_END.message,
      });
    });

    it('should enforce all cancellation and status change edge cases', () => {
      const rdvConfirme: RendezVous = {
        id: 800,
        npi: '0102030405',
        service: 'PASSEPORT',
        dateHeure: '2026-11-26T10:00',
        statut: 'confirme',
      };

      // Annulation pile 24h avant -> autorisée
      expect(annulerRendezVous(rdvConfirme, '2026-11-25T10:00').succes).toBe(true);

      // Annulation 23h59 avant -> refusée (409)
      expect(annulerRendezVous(rdvConfirme, '2026-11-25T10:01')).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: ERREURS_METIER.ANNULATION_TARDIVE.message,
      });

      // Annulation d'un RDV déjà honoré -> refusée (409)
      expect(
        annulerRendezVous({ ...rdvConfirme, statut: 'honore' }, '2026-11-20T10:00')
      ).toEqual({
        succes: false,
        codeHttp: 409,
        erreur: ERREURS_METIER.ANNULATION_NON_CONFIRME.message,
      });

      // Statut demandé inconnu par un agent -> refusé (400)
      expect(changerStatutRendezVous(rdvConfirme, 'confirme')).toEqual({
        succes: false,
        codeHttp: 400,
        erreur: ERREURS_METIER.STATUT_INCONNU.message,
      });

      // Clôture valide vers 'absent' -> 200
      expect(changerStatutRendezVous(rdvConfirme, 'absent')).toEqual({
        succes: true,
        codeHttp: 200,
        donnees: { ...rdvConfirme, statut: 'absent' },
      });
    });

    it('should handle French formatted stored dates (JJ/MM/AAAA HH:MM) and Date instances cleanly (Bonus 3 & Bonus 5)', () => {
      const rdvStockesFormatFr: RendezVous[] = [
        { id: 527, npi: '0203040506', service: 'CNI', dateHeure: '28/07/2026 09:00', statut: 'honore' },
        { id: 826, npi: '0203040506', service: 'PASSEPORT', dateHeure: '02/12/2026 08:30', statut: 'confirme' },
        { id: 900, npi: '0203040506', service: 'PERMIS', dateHeure: '10/12/2026 14:00', statut: 'confirme' },
      ];

      // 20 novembre 2026 18:00 GMT+1 = 17:00 UTC
      const maintenantDate = new Date('2026-11-20T17:00:00Z');
      const page1 = listerRendezVousUsager(rdvStockesFormatFr, maintenantDate, 1, 10);

      expect(page1.rendezVous.map((r) => r.id)).toEqual([826, 900, 527]);
    });
  });
});
