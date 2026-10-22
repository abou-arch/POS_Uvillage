export interface Totals { ht: number; tva: number; ttc: number }
export interface VatGroup extends Totals { rate: number }
export interface TotalsLine { quantity: number; unit_price_ttc: number; discount?: number; tva_rate: number }
export function lineTotals(quantity: number, unitPriceTtc: number, discount: number, tvaRate: number): Totals;
export function allocate(amount: number, weights: number[]): number[];
export function vatBreakdown(lines: TotalsLine[], otherCharges?: number, globalDiscount?: number): VatGroup[];
export function vatBreakdownOfLines(lines: { tva_rate: number; total_ttc: number }[], otherCharges?: number, globalDiscount?: number): VatGroup[];
export function saleTotals(lines: TotalsLine[], otherCharges?: number, globalDiscount?: number): Totals;
export function formatMad(cents: number): string;
