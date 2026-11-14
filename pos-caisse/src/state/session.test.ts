import { describe, expect, it } from 'vitest';
import type { Auth, Session, Store } from '../types';
import {
  autoSelection, clearSession, closingThreshold, discountLimits, initialStore, isAuth, isSession, loadSession, onlyRegister, saveSession,
  selectRegister, SESSION_KEY,
} from './session';

const limits = { cashier_max_discount_percent: 10, cashier_max_discount: 5000 };
const centre: Store = { id: 'st_1', name: 'Magasin centre', closing_difference_threshold: 2000, ...limits, registers: [{ id: 'reg_1', name: 'Caisse 1' }, { id: 'reg_2', name: 'Caisse 2' }] };
const quartier: Store = { id: 'st_2', name: 'Magasin quartier', closing_difference_threshold: 2000, ...limits, registers: [{ id: 'reg_3', name: 'Caisse 1' }] };
const sansCaisse: Store = { id: 'st_3', name: 'Magasin vide', closing_difference_threshold: 0, ...limits, registers: [] };
const auth = (...stores: Store[]): Auth => ({ token: 'tok_1', user: { id: 'u_1', name: 'Falcon', role: 'admin' }, stores });

// localStorage en mémoire : pas de navigateur sous Vitest.
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('choix du magasin et de la caisse', () => {
  it("entre directement s'il n'y a qu'un magasin avec une seule caisse", () => {
    expect(autoSelection([quartier])).toEqual({ storeId: 'st_2', registerId: 'reg_3' });
    expect(selectRegister(auth(quartier))).toEqual({ ...auth(quartier), storeId: 'st_2', registerId: 'reg_3' });
  });
  it('fait choisir la caisse quand le seul magasin en a plusieurs', () => {
    expect(autoSelection([centre])).toBeNull();
    expect(initialStore([centre])).toBe(centre);
    expect(isSession(selectRegister(auth(centre)))).toBe(false);
  });
  it('fait choisir le magasin quand il y en a plusieurs', () => {
    expect(autoSelection([centre, quartier])).toBeNull();
    expect(initialStore([centre, quartier])).toBeNull();
  });
  it('ne choisit rien sans magasin ou sans caisse', () => {
    expect(autoSelection([])).toBeNull();
    expect(autoSelection([sansCaisse])).toBeNull();
  });
  it("prend d'office la caisse d'un magasin qui n'en a qu'une", () => {
    expect(onlyRegister(quartier)).toEqual({ id: 'reg_3', name: 'Caisse 1' });
    expect(onlyRegister(centre)).toBeNull();
  });
  it('garde le magasin et la caisse choisis', () => {
    expect(selectRegister(auth(centre, quartier), 'st_1', 'reg_2'))
      .toEqual({ ...auth(centre, quartier), storeId: 'st_1', registerId: 'reg_2' });
  });
  it("refuse une caisse qui n'appartient pas au magasin", () => {
    expect(isSession(selectRegister(auth(centre, quartier), 'st_1', 'reg_3'))).toBe(false);
  });
});

describe('conservation de la session (F5)', () => {
  it('relit la session complète après un rechargement', () => {
    const storage = memoryStorage();
    const session: Session = { ...auth(centre, quartier), storeId: 'st_1', registerId: 'reg_2' };
    saveSession(session, storage);
    expect(loadSession(storage)).toEqual(session);
  });
  it("relit une connexion dont le magasin n'est pas encore choisi", () => {
    const storage = memoryStorage();
    saveSession(auth(centre, quartier), storage);
    expect(loadSession(storage)).toEqual(auth(centre, quartier));
  });
  it("renvoie à l'écran de choix si le magasin ou la caisse n'existe plus", () => {
    const gone = { ...auth(centre, quartier), storeId: 'st_9', registerId: 'reg_1' };
    expect(loadSession(memoryStorage({ [SESSION_KEY]: JSON.stringify(gone) }))).toEqual(auth(centre, quartier));
    // ... sauf s'il ne reste qu'une caisse possible : on la reprend.
    const single = { ...auth(quartier), storeId: 'st_9', registerId: 'reg_9' };
    expect(loadSession(memoryStorage({ [SESSION_KEY]: JSON.stringify(single) })))
      .toEqual({ ...auth(quartier), storeId: 'st_2', registerId: 'reg_3' });
  });
  it('ignore une session absente, illisible ou incomplète', () => {
    expect(loadSession(memoryStorage())).toBeNull();
    const valid = auth(centre);
    const bad = [
      '{pas du json',
      '"texte"',
      JSON.stringify({ ...valid, token: '' }),
      JSON.stringify({ ...valid, stores: 'st_1' }),
      JSON.stringify({ ...valid, user: { ...valid.user, role: 'pirate' } }),
      JSON.stringify({ ...valid, stores: [{ id: 'st_1', name: 'Magasin', registers: [{ name: 'Caisse sans id' }] }] }),
      JSON.stringify({ ...valid, stores: [{ id: 'st_1', name: 'Magasin', registers: [] }] }), // sans seuil d'écart (§2)
      JSON.stringify({ ...valid, stores: [{ ...centre, closing_difference_threshold: -1 }] }),
      JSON.stringify({ ...valid, stores: [{ ...centre, closing_difference_threshold: 10.5 }] }),
    ];
    for (const raw of bad) expect(loadSession(memoryStorage({ [SESSION_KEY]: raw }))).toBeNull();
  });
  it("la déconnexion efface la session, et rien d'autre", () => {
    const storage = memoryStorage({ 'pos.held': '[]' });
    saveSession(auth(quartier), storage);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
    expect(storage.getItem('pos.held')).toBe('[]');
  });
  it('ne plante pas si le stockage est indisponible', () => {
    const fail = () => { throw new Error('stockage bloqué'); };
    const broken = { getItem: fail, setItem: fail, removeItem: fail };
    expect(() => saveSession(auth(quartier), broken)).not.toThrow();
    expect(() => clearSession(broken)).not.toThrow();
    expect(loadSession(broken)).toBeNull();
  });
});

describe('seuil d’écart de clôture (§2)', () => {
  it('lu dans la réponse du login, pour le magasin choisi', () => {
    const session = selectRegister(auth({ ...centre, closing_difference_threshold: 5000 }, quartier), 'st_1', 'reg_2');
    expect(isSession(session) && closingThreshold(session)).toBe(5000);
    expect(isAuth(auth(centre))).toBe(true);
    expect(isAuth({ ...auth(centre), stores: [{ id: 'st_1', name: 'Magasin centre', registers: [] }] })).toBe(false);
  });
});

describe('plafond de remise d’un caissier (§2, contrat 0.6)', () => {
  it('lu dans la réponse du login, pour le magasin choisi ; null = pas de plafond de ce type', () => {
    const session = selectRegister(auth(centre, { ...quartier, cashier_max_discount_percent: 15, cashier_max_discount: null }), 'st_2', 'reg_3');
    expect(isSession(session) && discountLimits(session)).toEqual({ percent: 15, amount: null });
    const centreSession = selectRegister(auth(centre), 'st_1', 'reg_1');
    expect(isSession(centreSession) && discountLimits(centreSession)).toEqual({ percent: 10, amount: 5000 });
  });
  it('connexion enregistrée avant la mise à jour (sans plafond) ou plafond aberrant : il faut se reconnecter', () => {
    const { cashier_max_discount_percent: _p, cashier_max_discount: _a, ...old } = centre;
    expect(isAuth(auth(old as Store))).toBe(false);
    expect(isAuth(auth({ ...centre, cashier_max_discount_percent: 120 }))).toBe(false);
    expect(isAuth(auth({ ...centre, cashier_max_discount_percent: 12.5 }))).toBe(false);
    expect(isAuth(auth({ ...centre, cashier_max_discount: -1 }))).toBe(false);
    expect(isAuth(auth({ ...centre, cashier_max_discount_percent: null, cashier_max_discount: null }))).toBe(true);
  });
  it('magasin introuvable : aucune remise sans autorisation', () => {
    const session = { ...auth(centre), storeId: 'st_9', registerId: 'reg_1' };
    expect(discountLimits(session)).toEqual({ percent: 0, amount: 0 });
  });
});
