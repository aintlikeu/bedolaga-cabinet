import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import fa from '@/locales/fa.json';
import ru from '@/locales/ru.json';
import zh from '@/locales/zh.json';
import { findSettingsSection } from '../constants';
import { FEATURE_GROUPS, FEATURES, asBool, isFilled, requirementMet } from './featureRegistry';

/**
 * Реестр раздела «Функции» — данные, которые легко сломать опечаткой: ссылка на
 * несуществующий раздел дерева молча не откроется, а забытый перевод покажет
 * пользователю голый ключ.
 */

function lookup(locale: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

const LOCALES = { ru, en, zh, fa };

describe('FEATURES', () => {
  it('id функций уникальны', () => {
    const ids = FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('каждая функция в известной группе', () => {
    for (const feature of FEATURES) expect(FEATURE_GROUPS).toContain(feature.group);
  });

  it('«Настроить» ведёт в существующий раздел настроек или в админку', () => {
    for (const feature of FEATURES) {
      if (!feature.link) continue;
      if ('section' in feature.link) {
        expect(findSettingsSection(feature.link.section), feature.id).toBe(feature.link.section);
      } else {
        expect(feature.link.route.startsWith('/admin/'), feature.id).toBe(true);
      }
    }
  });

  it('у каждой функции один главный выключатель максимум', () => {
    for (const feature of FEATURES) {
      expect(feature.toggles.filter((toggle) => toggle.role === 'enabled').length).toBeLessThan(2);
    }
  });

  it('зависимый переключатель есть только там, где есть главный', () => {
    for (const feature of FEATURES) {
      const hasMain = feature.toggles.some((toggle) => toggle.role === 'enabled');
      for (const toggle of feature.toggles) {
        if (toggle.dependsOnEnabled) expect(hasMain, feature.id).toBe(true);
      }
    }
  });

  it.each(Object.entries(LOCALES))('все тексты раздела переведены (%s)', (_name, locale) => {
    const missing: string[] = [];
    const need = (path: string) => {
      if (typeof lookup(locale, path) !== 'string') missing.push(path);
    };
    need('admin.settings.features');
    for (const group of FEATURE_GROUPS) {
      need(`admin.features.groups.${group}.title`);
      need(`admin.features.groups.${group}.description`);
    }
    for (const feature of FEATURES) {
      need(`admin.features.items.${feature.id}.title`);
      need(`admin.features.items.${feature.id}.description`);
      if (feature.bot) need(`admin.features.coupling.bot.${feature.bot}`);
      if (feature.cabinet) need(`admin.features.coupling.cabinet.${feature.cabinet}`);
      if (feature.requires) need(`admin.features.requires.${feature.requires.messageKey}`);
      for (const toggle of feature.toggles) {
        need(
          toggle.role === 'option'
            ? `admin.features.options.${toggle.labelKey}`
            : `admin.features.toggles.${toggle.role}`,
        );
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('вспомогательные функции', () => {
  it('isFilled: пусто — null, undefined и пробелы; маска секрета считается заданной', () => {
    expect(isFilled(null)).toBe(false);
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled('  ')).toBe(false);
    expect(isFilled('••••••••')).toBe(true);
    expect(isFilled('smtp.example.com')).toBe(true);
  });

  it('requirementMet: хватает любого полного варианта', () => {
    const smtp = FEATURES.find((feature) => feature.id === 'email_auth')?.requires;
    const values = (map: Record<string, string>) => (key: string) => map[key];

    expect(requirementMet(smtp, values({}))).toBe(false);
    expect(requirementMet(smtp, values({ SMTP_HOST: 'h' }))).toBe(false);
    expect(requirementMet(smtp, values({ SMTP_HOST: 'h', SMTP_USER: 'u' }))).toBe(true);
    expect(requirementMet(smtp, values({ SMTP_HOST: 'h', SMTP_FROM_EMAIL: 'a@b.c' }))).toBe(true);
    expect(requirementMet(undefined, values({}))).toBe(true);
  });

  it('asBool понимает и строку, и булево', () => {
    expect(asBool(true)).toBe(true);
    expect(asBool('true')).toBe(true);
    expect(asBool('false')).toBe(false);
    expect(asBool(undefined)).toBe(false);
  });

  it('пробный период: включён при длительности > 0 и не запрещён для всех', () => {
    const trial = FEATURES.find((feature) => feature.id === 'trial');
    const status = (days: unknown, disabledFor: unknown) =>
      trial?.derivedStatus?.((key) => (key === 'TRIAL_DURATION_DAYS' ? days : disabledFor));

    expect(status(3, 'none')).toBe(true);
    expect(status(0, 'none')).toBe(false);
    expect(status(3, 'all')).toBe(false);
  });
});
