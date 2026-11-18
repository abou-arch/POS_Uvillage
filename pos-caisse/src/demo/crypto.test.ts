import { describe, expect, it } from 'vitest';
import { pbkdf2Sync, precomputePbkdf2, randomBytes, sha256 } from './crypto';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

// Valeurs de référence calculées avec crypto.pbkdf2Sync de Node.
describe('PBKDF2-SHA256 de la démo', () => {
  it('donne le SHA-256 attendu', () => {
    expect(hex(sha256('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('donne les mêmes empreintes que Node', () => {
    expect(hex(pbkdf2Sync('password', 'salt', 1, 32, 'sha256'))).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
    expect(hex(pbkdf2Sync('password', 'salt', 2, 32, 'sha256'))).toBe('ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
    expect(hex(pbkdf2Sync('password', 'salt', 4096, 32, 'sha256'))).toBe('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
    expect(hex(pbkdf2Sync('246810', fromHex('00112233445566778899aabbccddeeff'), 1000, 32, 'sha256')))
      .toBe('86e00dcfbb6bc368ad355e286a3ac9584a9722d4b3d2e760c21db92dcfd5e0f0');
  });

  it('gère une clé de plus de 32 octets et un mot de passe de plus de 64 octets', () => {
    expect(hex(pbkdf2Sync('passwordPASSWORDpassword', 'saltSALTsaltSALTsaltSALTsaltSALTsalt', 4096, 40, 'sha256')))
      .toBe('348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9');
    expect(hex(pbkdf2Sync('k'.repeat(100), 'salt', 3, 32, 'sha256'))).toBe('219c68bb88f1010f4a763b7c8fd58639c2280baf6820814c6d404891fcd85c3d');
  });

  it('écrit ses octets en base64 comme un Buffer', () => {
    expect(pbkdf2Sync('password', 'salt', 1, 32, 'sha256').toString('base64')).toBe('Eg+2z/z4syxD5yJSVsT4N6hlSMkszDVICAWYfLcL4Xs=');
    expect(randomBytes(16)).toHaveLength(16);
  });

  it('refuse un autre algorithme', () => {
    expect(() => pbkdf2Sync('a', 'b', 1, 32, 'sha512')).toThrow();
  });
});

describe('precomputePbkdf2', () => {
  it('prépare le sel et l’empreinte que pbkdf2Sync rend ensuite, identiques au calcul complet', async () => {
    await precomputePbkdf2(['246810'], 2000, 32, 16);
    const salt = randomBytes(16);
    const fast = pbkdf2Sync('246810', salt, 2000, 32, 'sha256');
    // Le même calcul avec un autre nombre d'itérations n'est pas dans le cache : il passe par le calcul complet.
    const slow = pbkdf2Sync('246810', salt, 2001, 32, 'sha256');
    expect(fast).not.toEqual(slow);
    expect(fast.toString('base64')).toBe(await webCrypto('246810', salt, 2000));
  });
});

async function webCrypto(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
