import { describe, expect, it } from 'vitest';
import { categoryHue, categoryPictogram } from './categoryLook';

describe('categoryPictogram', () => {
  it('reconnaît les catégories du magasin, accents et majuscules compris', () => {
    expect(categoryPictogram('Boulangerie')).toBe('bread');
    expect(categoryPictogram('Crèmerie')).toBe('dairy');
    expect(categoryPictogram('Sauces')).toBe('sauce');
    expect(categoryPictogram('Conserves')).toBe('can');
    expect(categoryPictogram('Boissons')).toBe('drink');
    expect(categoryPictogram('CHIPS')).toBe('chips');
    expect(categoryPictogram('Épicerie sucrée')).toBe('sweets');
    expect(categoryPictogram('Électronique')).toBe('plug');
    expect(categoryPictogram('Au poids')).toBe('weight');
    expect(categoryPictogram('Fruits et légumes')).toBe('produce');
    expect(categoryPictogram('Eaux et jus')).toBe('drink');
    expect(categoryPictogram('Gâteaux')).toBe('sweets'); // le « eau » de « gâteau » n'en fait pas une boisson
    expect(categoryPictogram('Épices')).toBe('sauce');
    expect(categoryPictogram('Épicerie salée')).toBe('tag'); // l'« épicerie » n'est pas une épice
  });

  it('donne une étiquette quand le nom est inconnu ou absent', () => {
    expect(categoryPictogram('Divers')).toBe('tag');
    expect(categoryPictogram('')).toBe('tag');
    expect(categoryPictogram(null)).toBe('tag');
  });
});

describe('categoryHue', () => {
  it('est stable pour une même catégorie et reste entre 0 et 359', () => {
    const hue = categoryHue('cat_1');
    expect(hue).toBe(categoryHue('cat_1'));
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it('est absente pour un article sans catégorie', () => {
    expect(categoryHue(null)).toBeNull();
  });
});
