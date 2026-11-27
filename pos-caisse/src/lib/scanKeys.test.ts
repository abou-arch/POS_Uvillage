import { describe, expect, it } from "vitest";
import {
  isBurst,
  readScan,
  recordStroke,
  usChar,
  type Stroke,
} from "./scanKeys";

type Ev = Parameters<typeof recordStroke>[1];
const ev = (key: string, code: string, shiftKey = false): Ev => ({
  key,
  code,
  shiftKey,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
});

// Ce que le navigateur reçoit quand une douchette (clavier US) « tape » sur un poste AZERTY SANS Verr. Maj.
const AZERTY_NO_CAPS: Record<string, Ev> = {
  "6": ev("è", "Digit6"),
  "1": ev("&", "Digit1"),
  "0": ev("à", "Digit0"),
  "3": ev('"', "Digit3"),
  A: ev("Q", "KeyA", true),
  B: ev("B", "KeyB", true),
  I: ev("I", "KeyI", true),
  T: ev("T", "KeyT", true),
};
const scan = (text: string, table: Record<string, Ev>, gap = 10): Stroke[] => {
  const strokes: Stroke[] = [];
  [...text].forEach((c, i) => recordStroke(strokes, table[c], i * gap));
  return strokes;
};
const never = () => false;

describe("touche physique → caractère américain", () => {
  it("lettres, chiffres, symboles", () => {
    expect(usChar("KeyA", false)).toBe("a");
    expect(usChar("KeyA", true)).toBe("A");
    expect(usChar("Digit1", false)).toBe("1");
    expect(usChar("Digit1", true)).toBe("!");
    expect(usChar("Numpad7", false)).toBe("7");
    expect(usChar("Minus", true)).toBe("_");
    expect(usChar("Slash", false)).toBe("/");
    expect(usChar("ShiftLeft", false)).toBeNull();
    expect(usChar("IntlBackslash", false)).toBeNull();
  });
});

describe("douchette sur clavier AZERTY", () => {
  it('sans Verr. Maj : les chiffres sont bien lus (le champ, lui, a reçu « è&à" … »)', () => {
    const strokes = scan("6103", AZERTY_NO_CAPS);
    expect(isBurst(strokes)).toBe(true);
    expect(readScan(strokes, 'è&à"', never)).toBe("6103");
  });

  it("les lettres aussi : A reste A (le clavier AZERTY aurait donné Q)", () => {
    expect(readScan(scan("ABIT", AZERTY_NO_CAPS), "QBIT", never)).toBe("ABIT");
  });

  it("douchette réglée en AZERTY : la lecture du clavier est retenue si elle retrouve un article", () => {
    const strokes: Stroke[] = [];
    ["1", "1", "1"].forEach((c, i) =>
      recordStroke(strokes, ev(c, "Digit1", true), i * 10),
    );
    expect(readScan(strokes, "111", (t) => t === "111")).toBe("111");
  });

  it("saisie manuelle lente : le champ est gardé tel quel", () => {
    const strokes: Stroke[] = [];
    [..."olives"].forEach((c, i) =>
      recordStroke(strokes, ev(c, "KeyX"), i * 200),
    );
    expect(isBurst(strokes)).toBe(false);
    expect(readScan(strokes, "olives", never)).toBe("olives");
  });

  it("une touche Maj / Verr. Maj / Entrée au milieu de la rafale ne casse rien", () => {
    const strokes: Stroke[] = [];
    recordStroke(strokes, ev("CapsLock", "CapsLock"), 0);
    recordStroke(strokes, ev("Shift", "ShiftLeft", true), 5);
    ["1", "2", "3"].forEach((c, i) =>
      recordStroke(strokes, ev(c, `Digit${c}`), 10 + i * 10),
    );
    recordStroke(strokes, ev("Enter", "Enter"), 50);
    expect(strokes).toHaveLength(3);
    expect(readScan(strokes, "", never)).toBe("123");
  });

  it("une pause recommence la série : le début tapé à la main n’est pas mélangé au scan", () => {
    const strokes: Stroke[] = [];
    recordStroke(strokes, ev("x", "KeyX"), 0);
    ["1", "2", "3"].forEach((c, i) =>
      recordStroke(strokes, ev(c, `Digit${c}`), 1000 + i * 10),
    );
    expect(readScan(strokes, 'x&é"', never)).toBe("123");
  });

  it("les raccourcis Ctrl+Maj+S ne sont pas comptés", () => {
    const strokes: Stroke[] = [];
    recordStroke(strokes, { ...ev("S", "KeyS", true), ctrlKey: true }, 0);
    expect(strokes).toHaveLength(0);
  });
});
