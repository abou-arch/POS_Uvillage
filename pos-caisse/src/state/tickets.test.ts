import { describe, expect, it } from 'vitest';
import type { ReceiptData } from '../lib/receipt';
import type { OutboxItem } from '../sync/sync';
import type { Refund, Sale } from '../types';
import { searchTickets, ticketCounter, ticketRows, ticketTime } from './tickets';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function receipt(counter: number, time: string, customer: string | null): ReceiptData {
  const sale = {
    id: uuid(counter), number: `ST2-REG3-${String(counter).padStart(6, '0')}`, created_at: `2026-11-14T${time}:00Z`,
    totals: { ht: 1000, tva: 200, ttc: 1200 },
  } as Sale; // seuls ces champs comptent ici
  return { sale, cashier: 'Caissier 1', customer };
}
// Cinq ventes de la journée, dans l'ordre des compteurs.
const R = [
  receipt(1, '08:05', null), receipt(2, '09:10', 'Fatima Zahra'), receipt(3, '10:15', null),
  receipt(4, '11:20', 'Ahmed Benani'), receipt(12, '12:25', 'Hélène'),
];
const saleItem = (r: ReceiptData, error: string | null): OutboxItem => ({ kind: 'sale', id: r.sale.id, sale: r.sale, error });

describe('tickets de la session', () => {
  it('le plus récent d’abord ; état d’envoi lu dans la file', () => {
    const rows = ticketRows(R, [saleItem(R[3], null), saleItem(R[4], 'Article inconnu')], []);
    expect(rows.map((r) => r.data.sale.number)).toEqual([
      'ST2-REG3-000012', 'ST2-REG3-000004', 'ST2-REG3-000003', 'ST2-REG3-000002', 'ST2-REG3-000001',
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      { kind: 'rejected', error: 'Article inconnu' }, { kind: 'pending' }, { kind: 'sent' }, { kind: 'sent' }, { kind: 'sent' },
    ]);
  });

  it('montant déjà rendu par les retours de la session', () => {
    const refunds = [
      { original_sale_id: R[1].sale.id, totals: { ttc: 300 } }, { original_sale_id: R[1].sale.id, totals: { ttc: 200 } },
    ] as Refund[];
    const rows = ticketRows(R, [], refunds);
    expect(rows.find((r) => r.data === R[1])?.refunded).toBe(500);
    expect(rows.find((r) => r.data === R[0])?.refunded).toBe(0);
  });

  it('critère 6e : retrouver le 3e ticket de la journée par son numéro', () => {
    const rows = ticketRows(R, [], []);
    expect(searchTickets(rows, '3').map((r) => r.data)).toEqual([R[2]]);
    expect(searchTickets(rows, '000003').map((r) => r.data)).toEqual([R[2]]);
    expect(searchTickets(rows, ' st2-reg3-000003 ').map((r) => r.data)).toEqual([R[2]]);
    expect(searchTickets(rows, '12').map((r) => r.data)).toEqual([R[4]]);
  });

  it('recherche par client, sans accents ni majuscules ; vide : tout', () => {
    const rows = ticketRows(R, [], []);
    expect(searchTickets(rows, 'fatima').map((r) => r.data)).toEqual([R[1]]);
    expect(searchTickets(rows, 'helene').map((r) => r.data)).toEqual([R[4]]);
    expect(searchTickets(rows, 'personne')).toEqual([]);
    expect(searchTickets(rows, '  ')).toHaveLength(5);
  });

  it('compteur et heure du ticket', () => {
    expect(ticketCounter('ST2-REG3-000012')).toBe(12);
    expect(ticketCounter('vente')).toBeNull();
    // Fuseau à décalage fixe (+9 h, sans heure d'été) : le résultat pour Africa/Casablanca dépend de la version des
    // données de fuseaux du moteur JS (19:58 avec Node 24.13, 18:58 avec Node 24.22) et ferait échouer le test.
    expect(ticketTime('2026-11-14T18:58:08Z', 'Asia/Tokyo')).toBe('03:58');
    expect(ticketTime('2026-11-14T18:58:08Z', 'UTC')).toBe('18:58');
  });
});
