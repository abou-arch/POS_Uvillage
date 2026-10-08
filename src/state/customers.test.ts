import { describe, expect, it } from 'vitest';
import { buildCustomer, MAX_MATRICULE_LENGTH, MAX_NAME_LENGTH, normalizePhone, prefillFrom } from './customers';

const form = (f: Partial<{ name: string; phone: string; matricule: string }>) => ({ name: '', phone: '', matricule: '', ...f });

describe('téléphone', () => {
  it('met les numéros marocains au format +212', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('+212612345678');
    expect(normalizePhone('07.12.34.56.78')).toBe('+212712345678');
    expect(normalizePhone('0522-12-34-56')).toBe('+212522123456');
    expect(normalizePhone('212612345678')).toBe('+212612345678');
    expect(normalizePhone('00212612345678')).toBe('+212612345678');
    expect(normalizePhone('+212 (0)6 12 34 56 78')).toBe('+212612345678');
  });
  it('garde les numéros étrangers en format international', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
  });
  it('refuse les numéros aberrants', () => {
    for (const bad of ['abc', '12345', '06 12', '0612345678901', '+12', '06a2345678']) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });
});

describe('nouveau client', () => {
  it('construit le client avec le nom seul', () => {
    expect(buildCustomer(form({ name: '  Ahmed   Benali ' }), 'id-1'))
      .toEqual({ ok: true, customer: { id: 'id-1', name: 'Ahmed Benali', phone: null, matricule: null } });
  });
  it('normalise le téléphone et le matricule', () => {
    expect(buildCustomer(form({ name: 'Ahmed', phone: '06 00 00 00 01', matricule: '2023 001 542' }), 'id-2'))
      .toEqual({ ok: true, customer: { id: 'id-2', name: 'Ahmed', phone: '+212600000001', matricule: '2023001542' } });
  });
  it('garde les zéros au début du matricule', () => {
    const result = buildCustomer(form({ name: 'Ahmed', matricule: '0012345' }));
    expect(result.ok && result.customer.matricule).toBe('0012345');
  });
  it('accepte un matricule long, dans la limite', () => {
    expect(buildCustomer(form({ name: 'Ahmed', matricule: '1'.repeat(MAX_MATRICULE_LENGTH) })).ok).toBe(true);
  });
  it('exige un nom raisonnable', () => {
    expect(buildCustomer(form({ name: '   ' }))).toMatchObject({ ok: false, errors: { name: 'Le nom est obligatoire.' } });
    expect(buildCustomer(form({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }))).toMatchObject({ ok: false });
  });
  it('signale un téléphone ou un matricule invalide', () => {
    for (const matricule of ['12AB', '1'.repeat(MAX_MATRICULE_LENGTH + 1), '-123']) {
      const result = buildCustomer(form({ name: 'Ahmed', phone: '12345', matricule }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['matricule', 'phone']);
    }
  });
  it('génère un UUID v4 quand aucun id n’est fourni', () => {
    const result = buildCustomer(form({ name: 'Ahmed' }));
    expect(result.ok && result.customer.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('pré-remplissage depuis la recherche', () => {
  it('reconnaît un téléphone, un matricule ou un nom', () => {
    expect(prefillFrom('06 12 34')).toEqual({ phone: '06 12 34' });
    expect(prefillFrom('+33 6 12')).toEqual({ phone: '+33 6 12' });
    expect(prefillFrom('2023 001 542')).toEqual({ matricule: '2023001542' });
    expect(prefillFrom(' Zineb ')).toEqual({ name: 'Zineb' });
    expect(prefillFrom('  ')).toEqual({});
  });
});
