import { describe, expect, it } from 'vitest';
import {
  currentLocale,
  hasKey,
  keysFor,
  t,
  tPluralize,
} from '@lib/i18n';

describe('t', () => {
  it('returns the translated string for a known key', () => {
    expect(t('nav.trends', 'en')).toBe('Trends');
    expect(t('nav.trends', 'ru')).toBe('Тренды');
  });
  it('ru dictionary fully covers en (fallback is a no-op today)', () => {
    // The vocab-parity test below guarantees ru ⊇ en, so every en key
    // resolves for ru as well; assert that invariant here for a couple of keys.
    expect(t('top.auto', 'ru', { sec: 60 })).toBe('авто 60с');
    expect(t('error.retry', 'ru')).toBe('Повторить');
  });
  it('returns the key itself when unknown', () => {
    expect(t('missing.key', 'en')).toBe('missing.key');
  });
  it('interpolates params', () => {
    expect(t('top.auto', 'en', { sec: 60 })).toBe('auto 60s');
    expect(t('updated.at', 'ru', { time: '14:00' })).toBe('Обновлено 14:00');
  });
});

describe('tPluralize', () => {
  it('replaces {placeholders}', () => {
    expect(tPluralize('a {x} b', { x: 1 })).toBe('a 1 b');
  });
  it('leaves unknown placeholders intact', () => {
    expect(tPluralize('a {x}', {})).toBe('a {x}');
  });
});

describe('currentLocale', () => {
  it('prefers the stored preference over the doc language', () => {
    expect(currentLocale('en', 'ru')).toBe('en');
    expect(currentLocale('ru', 'en')).toBe('ru');
  });
  it('falls back to the doc language', () => {
    expect(currentLocale(null, 'ru')).toBe('ru');
    expect(currentLocale(undefined, 'en')).toBe('en');
  });
  it('defaults to en', () => {
    expect(currentLocale(null, undefined)).toBe('en');
  });
});

describe('vocab', () => {
  it('en and ru cover the same keys', () => {
    const en = keysFor('en').sort();
    const ru = keysFor('ru').sort();
    expect(ru).toEqual(en);
  });
  it('hasKey works', () => {
    expect(hasKey('top.auto', 'en')).toBe(true);
    expect(hasKey('nope', 'en')).toBe(false);
  });
});
