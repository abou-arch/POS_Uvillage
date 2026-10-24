import { describe, expect, it } from 'vitest';
import { apiUrlProblem } from './client';

describe('adresse de l’API', () => {
  it('en production : HTTPS obligatoire', () => {
    expect(apiUrlProblem('https://api.uvillage.ma/api', true)).toBeNull();
    expect(apiUrlProblem('http://api.uvillage.ma/api', true)).toMatch(/non sécurisée.*http:\/\/api\.uvillage\.ma/);
    expect(apiUrlProblem('http://192.168.1.20:4000/api', true)).toMatch(/non sécurisée/); // réseau du magasin : lisible par tous
  });

  it('en production : HTTP toléré seulement vers le poste lui-même (fausse API)', () => {
    for (const local of ['http://localhost:4000/api', 'http://127.0.0.1:4000/api', 'http://[::1]:4000/api']) {
      expect(apiUrlProblem(local, true)).toBeNull();
    }
  });

  it('en développement : HTTP accepté partout', () => {
    expect(apiUrlProblem('http://192.168.1.20:4000/api', false)).toBeNull();
  });

  it('adresse illisible : signalée', () => {
    expect(apiUrlProblem('api.uvillage.ma', false)).toMatch(/invalide/);
    expect(apiUrlProblem('', true)).toMatch(/invalide/);
  });
});
