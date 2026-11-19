// Ce que partagent les pages de gestion (hors composants) : contexte d'ouverture, fuseau, horloge, types, export CSV.
import { createContext, useEffect, useState, type ReactNode } from 'react';
import { TIME_ZONE } from '../../config/store';
import type { ManagementData } from '../../db/management';
import { toCsv } from '../../lib/stats';
import type { ManagementPage } from '../../state/permissions';
import type { PrintDoc } from '../../state/usePrint';
import type { Session } from '../../types';

/** Ouvre l'espace Gestion (bouton de l'en-tête). null : déjà dedans, le bouton n'est pas affiché. */
export const ManageContext = createContext<((page?: ManagementPage) => void) | null>(null);

export const TZ = TIME_ZONE;

/** Ce que l'espace Gestion imprime : un ticket ou un rapport 80 mm, ou un rapport A4 (page Rapports). */
export type ManagementPrint = { kind: 'doc'; doc: PrintDoc } | { kind: 'page'; node: ReactNode };
export type PrintFn = (job: ManagementPrint) => void;

/** Ce que reçoit chaque page de gestion. */
export interface PageProps {
  session: Session;
  data: ManagementData;
  print: PrintFn;
  onNavigate: (page: ManagementPage) => void;
}

/** Heure courante, relue chaque minute : « aujourd'hui » change à minuit sans recharger la page. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** « mer. 18 nov. » pour un jour « 2026-11-18 ». */
export const dayLabel = (key: string, withMonth = true) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', ...(withMonth ? { month: 'short' } : {}) })
    .format(new Date(`${key}T12:00:00Z`));

/** « 18/11/2026 » pour un jour « 2026-11-18 ». */
export const shortDay = (key: string) => key.split('-').reverse().join('/');

/** Télécharge un CSV lisible par Excel en français (BOM UTF-8 pour les accents et l'arabe). */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
