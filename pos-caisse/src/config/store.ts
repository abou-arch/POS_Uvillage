// Mentions imprimées sur le ticket, par magasin. VALEURS FICTIVES : à remplacer par les vraies
// (adresse, ICE…) une fois validées avec le comptable (point 2 du §8 du contrat).

export interface StoreInfo { name: string; address: string[]; ice: string }

export const STORE_INFO: Record<string, StoreInfo> = {
  st_1: { name: 'Supérette Uvillage — Centre', address: ['12, avenue Mohammed V', '20000 Casablanca'], ice: '000000000000001' },
  st_2: { name: 'Supérette Uvillage — Quartier', address: ['Résidence Al Amal, bloc B', '20250 Casablanca'], ice: '000000000000002' },
};

/** Magasin absent de la liste ci-dessus : le nom vient de la session, sans adresse ni ICE. */
export const storeInfo = (storeId: string, fallbackName: string): StoreInfo =>
  STORE_INFO[storeId] ?? { name: fallbackName, address: [], ice: '' };

/** Imprimer le ticket dès que le paiement est validé (sinon : bouton « Réimprimer le dernier ticket »). */
export const AUTO_PRINT = true;

/** Fuseau des heures imprimées : celui du magasin, quel que soit le réglage du poste. */
export const TIME_ZONE = 'Africa/Casablanca';

export const THANK_YOU = ['Merci de votre visite !', 'شكرا لزيارتكم'];
