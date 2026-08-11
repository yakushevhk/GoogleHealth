/**
 * Minimal i18n — `en` and `ru`, key-based, with `{placeholder}` interpolation.
 * Isomorphic (no DOM requirement), used both in server templates and client
 * islands. Stored language round-trips through `<html data-lang>`; falls back
 * to `document.documentElement.lang`, then a hardcoded default.
 */
export type Locale = 'en' | 'ru';

const DICT: Record<Locale, Record<string, string>> = {
  en: {
    'nav.overview': 'Overview',
    'nav.trends': 'Trends',
    'nav.zones': 'HR Zones',
    'nav.raw': 'RAW',
    'top.refresh': 'Refresh data',
    'top.refreshing': 'Refreshing…',
    'top.auto': 'auto {sec}s',
    'top.auto.off': 'auto off',
    'top.live': 'LIVE',
    'top.entry': '+ Entry',
    'conn.no': 'no connection to Google Health',
    'preset.today': 'Today',
    'preset.yesterday': 'Yesterday',
    'preset.last7': 'Last 7 days',
    'preset.last30': 'Last 30 days',
    'preset.last90': 'Last 90 days',
    'preset.week_prev': 'Previous week',
    'preset.month_prev': 'Previous month',
    'updated.just': 'Updated just now',
    'updated.at': 'Updated {time}',
    'error.retry': 'Retry',
    'error.no_conn': 'No connection to Google Health',
    'error.no_data': 'No data',
    'settings.title': 'Dashboard settings',
    'settings.card_visibility': 'Show cards',
    'settings.reset': 'Reset defaults',
    'settings.compact': 'Compact mode',
    'chart.no_data': 'No {metric} data.',
  },
  ru: {
    'nav.overview': 'Обзор',
    'nav.trends': 'Тренды',
    'nav.zones': 'Зоны пульса',
    'nav.raw': 'RAW',
    'top.refresh': 'Обновить данные',
    'top.refreshing': 'Обновление…',
    'top.auto': 'авто {sec}с',
    'top.auto.off': 'авто выкл',
    'top.live': 'LIVE',
    'top.entry': '+ Запись',
    'conn.no': 'нет соединения с Google Health',
    'preset.today': 'Сегодня',
    'preset.yesterday': 'Вчера',
    'preset.last7': 'Последние 7 дней',
    'preset.last30': 'Последние 30 дней',
    'preset.last90': 'Последние 90 дней',
    'preset.week_prev': 'Предыдущая неделя',
    'preset.month_prev': 'Предыдущий месяц',
    'updated.just': 'Обновлено только что',
    'updated.at': 'Обновлено {time}',
    'error.retry': 'Повторить',
    'error.no_conn': 'Нет соединения с Google Health',
    'error.no_data': 'Нет данных',
    'settings.title': 'Настройки дашборда',
    'settings.card_visibility': 'Показывать карточки',
    'settings.reset': 'Сбросить по умолчанию',
    'settings.compact': 'Компактный режим',
    'chart.no_data': 'Нет данных {metric}.',
  },
};

export const LOCALES: Locale[] = ['en', 'ru'];

function normalizeLang(lang?: string): Locale {
  const l = (lang ?? '').toLowerCase();
  if (l.startsWith('ru')) return 'ru';
  return 'en';
}

/** Current locale, preferring the stored preference over the document lang. */
export function currentLocale(stored?: string | null, docLang?: string): Locale {
  if (stored) return normalizeLang(stored);
  return normalizeLang(docLang);
}

/** Simple `{name}` interpolation over a template string. */
export function tPluralize(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

/** Translate a key for a locale, interpolating `{params}`. */
export function t(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const table = DICT[locale];
  const template = table?.[key] ?? DICT.en[key] ?? key;
  return tPluralize(template, params);
}

/** Whether a key exists for a locale (for testing vocab completeness). */
export function hasKey(key: string, locale: Locale): boolean {
  return (DICT[locale]?.[key] ?? DICT.en[key]) !== undefined;
}

/** All keys (for a test that en ↔ ru cover the same set). */
export function keysFor(locale: Locale): string[] {
  return Object.keys(DICT[locale]);
}
