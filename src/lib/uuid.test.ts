import { describe, expect, it } from 'vitest';
import { uuidv4 } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv4', () => {
  it('produit un UUID v4', () => {
    expect(uuidv4()).toMatch(V4);
  });
  it('fonctionne sans crypto.randomUUID (page servie en http)', () => {
    const insecure = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const ids = new Set(Array.from({ length: 200 }, () => uuidv4(insecure)));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });
});
