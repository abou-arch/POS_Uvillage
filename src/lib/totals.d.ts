export interface Totals { ht: number; tva: number; ttc: number }
export interface TotalsLine { quantity: number; unit_price_ttc: number; discount?: number; tva_rate: number }
export function lineTotals(quantity: number, unitPriceTtc: number, discount: number, tvaRate: number): Totals;
export function saleTotals(lines: TotalsLine[], otherCharges?: number, globalDiscount?: number): Totals;
export function formatMad(cents: number): string;
