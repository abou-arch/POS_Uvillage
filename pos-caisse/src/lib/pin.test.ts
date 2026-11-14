import { describe, expect, it } from 'vitest';
import type { PinHash } from '../types';
import { decodeBase64, isApprover, isPinFormat, isPinHash, MIN_ITERATIONS, pinMatches } from './pin';

// Empreintes de référence calculées une fois avec Node (crypto.pbkdf2Sync, comme la fausse API), puis écrites ici :
// la caisse (WebCrypto) est vérifiée contre une autre implémentation, sans dépendre des types Node dans le build.
const SALT = 'c2VsLWFsZWF0b2lyZS0xNg=='; // « sel-aleatoire-16 », 16 octets
const pbkdf2 = (iterations: number, hash: string): PinHash => ({ algorithm: 'PBKDF2-SHA256', iterations, salt: SALT, hash });
const PIN_1000 = pbkdf2(1000, 'RIduNpvew1k8cZ4HhPuYOiAIUPEEbj56ZjMU7Y5Id1o='); // « 246810 », 1 000 itérations : le test reste rapide
const PIN_MIN = pbkdf2(MIN_ITERATIONS, 'HPAkuXC8y3d1RXSik5Fw0NN7CcGSVSuUGZize6oC+iY='); // « 246810 », 100 000 itérations

describe('vérification du PIN sur la caisse (§11)', () => {
  it('vecteur de référence PBKDF2-HMAC-SHA256 (RFC 7914, « passwd » / « salt », 1 itération)', async () => {
    // 55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc en base64
    const h: PinHash = { algorithm: 'PBKDF2-SHA256', iterations: 1, salt: 'c2FsdA==', hash: 'VawEblbjCJ/sFpHCJUS2BflBhSFt3gRl5oudV8INrLw=' };
    expect(await pinMatches('passwd', h)).toBe(true);
    expect(await pinMatches('passwe', h)).toBe(false);
  });

  it('bon PIN accepté, mauvais refusé, avec une empreinte calculée par l’API', async () => {
    expect(await pinMatches('246810', PIN_1000)).toBe(true);
    expect(await pinMatches('246811', PIN_1000)).toBe(false);
    expect(await pinMatches('', PIN_1000)).toBe(false);
    expect(await pinMatches('0246810', PIN_1000)).toBe(false);
  });

  it('empreinte illisible : ne correspond à rien, sans erreur', async () => {
    expect(await pinMatches('246810', { ...PIN_1000, hash: 'pas du base64 !' })).toBe(false);
    expect(await pinMatches('246810', { ...PIN_1000, salt: '%%%' })).toBe(false);
    expect(await pinMatches('246810', { ...PIN_1000, iterations: 0 })).toBe(false);
  });

  it('PIN tapé : chiffres seulement, 4 à 12', () => {
    expect(isPinFormat('246810')).toBe(true);
    expect(isPinFormat('1234')).toBe(true);
    expect(isPinFormat('123')).toBe(false);
    expect(isPinFormat('12a456')).toBe(false);
    expect(isPinFormat(' 246810')).toBe(false);
    expect(isPinFormat('1234567890123')).toBe(false);
  });
});

describe('liste des responsables reçue de l’API (§11)', () => {
  const approver = { user_id: 'u_3', name: 'Responsable', pin: PIN_MIN };

  it('responsable complet accepté ; empreinte au minimum d’itérations vérifiée', async () => {
    expect(isPinHash(PIN_MIN)).toBe(true);
    expect(isApprover(approver)).toBe(true);
    expect(await pinMatches('246810', PIN_MIN)).toBe(true);
  });

  it('empreinte refusée : autre algorithme, trop peu ou trop d’itérations, sel trop court, empreinte de mauvaise taille', () => {
    expect(isPinHash({ ...PIN_MIN, algorithm: 'SHA1' })).toBe(false);
    expect(isPinHash({ ...PIN_MIN, iterations: MIN_ITERATIONS - 1 })).toBe(false);
    expect(isPinHash({ ...PIN_MIN, iterations: 50_000_000 })).toBe(false);
    expect(isPinHash({ ...PIN_MIN, salt: btoa('court') })).toBe(false);
    expect(isPinHash({ ...PIN_MIN, hash: btoa('0123456789abcdef') })).toBe(false); // 16 octets au lieu de 32
    expect(isPinHash({ ...PIN_MIN, hash: 'pas du base64' })).toBe(false);
    expect(isPinHash(null)).toBe(false);
  });

  it('responsable sans nom, sans id ou sans empreinte : écarté', () => {
    expect(isApprover({ ...approver, name: ' ' })).toBe(false);
    expect(isApprover({ ...approver, user_id: '' })).toBe(false);
    expect(isApprover({ ...approver, pin: null })).toBe(false);
    expect(isApprover({ ...approver, pin: { ...PIN_MIN, pin: '246810' } })).toBe(true); // un champ en trop n'est pas gardé (voir db/approvers.ts)
  });

  it('base64', () => {
    expect(decodeBase64('YWJj')).toEqual(new Uint8Array([97, 98, 99]));
    expect(decodeBase64('YWJ')).toBeNull();
    expect(decodeBase64('YW?j')).toBeNull();
  });
});
