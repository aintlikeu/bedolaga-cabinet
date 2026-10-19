// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';
import type { SettingDefinition } from '../../api/adminSettings';
import { SETTINGS_TREE, paymentProviderEnabledKey, splitPaymentChildren } from './constants';

/**
 * Дерево настроек по задачам: подключённые провайдеры оплаты сверху, остальные
 * свёрнуты; инфраструктура — в группе «Система» под пометкой «Расширенные».
 * И строка настройки: одна пометка «Изменено» со значением по умолчанию, ключ — по кнопке.
 */

const s = ruLocale.admin.settings;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ruLocale);
      if (typeof value !== 'string') return typeof options === 'string' ? options : key;
      return value.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String((options as Record<string, unknown>)?.[name] ?? ''),
      );
    },
    i18n: { language: 'ru', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const copied = vi.hoisted(() => [] as string[]);
vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: (text: string) => {
    copied.push(text);
    return Promise.resolve();
  },
}));

afterEach(cleanup);

function setting(partial: Partial<SettingDefinition> & { key: string }): SettingDefinition {
  return {
    name: partial.key
      .split('_')
      .map((part) => part[0] + part.slice(1).toLowerCase())
      .join(' '),
    category: { key: 'X', label: 'X' },
    type: 'bool',
    is_optional: false,
    current: false,
    original: false,
    has_override: false,
    read_only: false,
    env_locked: false,
    choices: [],
    hint: null,
    ...partial,
  };
}

describe('дерево по задачам', () => {
  it('инфраструктура собрана в «Системе» с пометкой «Расширенные» и стоит последней', () => {
    const groups = SETTINGS_TREE.groups;
    const system = groups[groups.length - 1];
    expect(system.id).toBe('system');
    expect(system.advanced).toBe(true);
    expect(system.children.map((c) => c.id)).toEqual(
      expect.arrayContaining(['db_postgres', 'db_redis', 'sys_logging', 'sys_other']),
    );
    expect(groups.some((g) => g.id === 'database')).toBe(false);
  });

  it('маркетинг — отдельная группа', () => {
    const marketing = SETTINGS_TREE.groups.find((g) => g.id === 'marketing');
    expect(marketing?.children.map((c) => c.id)).toEqual([
      'users_referral',
      'users_contests',
      'sys_tracking',
    ]);
  });

  it('у каждой группы есть подпись', () => {
    for (const group of SETTINGS_TREE.groups) {
      expect(typeof (s.groups as Record<string, string>)[group.id], group.id).toBe('string');
    }
  });
});

describe('платёжные провайдеры', () => {
  const payments = SETTINGS_TREE.groups.find((g) => g.id === 'payments');
  if (!payments) throw new Error('нет группы payments');

  it('ключ «подключён»: категория + _ENABLED, у звёзд свой, у общих — нет', () => {
    const byId = (id: string) => {
      const child = payments.children.find((c) => c.id === id);
      if (!child) throw new Error(`нет пункта ${id}`);
      return child;
    };
    expect(paymentProviderEnabledKey(byId('payments_yookassa'))).toBe('YOOKASSA_ENABLED');
    expect(paymentProviderEnabledKey(byId('payments_stars'))).toBe('TELEGRAM_STARS_ENABLED');
    expect(paymentProviderEnabledKey(byId('payments_apple_iap'))).toBe('APPLE_IAP_ENABLED');
    expect(paymentProviderEnabledKey(byId('payments_general'))).toBeNull();
  });

  it('подключённые сверху в исходном порядке, общие пункты всегда среди них', () => {
    const on = new Set(['LAVA_ENABLED', 'YOOKASSA_ENABLED']);
    const { connected, notConnected } = splitPaymentChildren(payments.children, (key) =>
      on.has(key),
    );
    expect(connected.map((c) => c.id)).toEqual([
      'payments_general',
      'payments_yookassa',
      'payments_lava',
    ]);
    expect(notConnected).toHaveLength(payments.children.length - 3);
  });
});

describe('SettingsTreeSidebar', () => {
  async function renderSidebar(activeSection = 'payments_general') {
    const { SettingsTreeSidebar } = await import('./SettingsTreeSidebar');
    render(
      <SettingsTreeSidebar
        activeSection={activeSection}
        onSectionChange={() => {}}
        favoritesCount={0}
        searchQuery=""
        onSearchChange={() => {}}
        allSettings={[setting({ key: 'YOOKASSA_ENABLED', current: true })]}
      />,
    );
  }

  it('сворачивает неподключённых провайдеров и показывает их по кнопке', async () => {
    await renderSidebar();
    const toggle = screen.getByRole('button', { name: /Не подключены/ });

    expect(screen.getByText(s.tree.payments_yookassa)).toBeTruthy();
    expect(screen.queryByText(s.tree.payments_lava)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(s.tree.payments_lava)).toBeTruthy();
    expect(screen.getAllByRole('img', { name: s.providerConnected })).toHaveLength(1);
  });

  it('раскрывает свёрнутых, если открыт раздел неподключённого провайдера', async () => {
    await renderSidebar('payments_lava');
    expect(screen.getByText(s.tree.payments_lava)).toBeTruthy();
  });

  it('показывает пометку «Расширенные» перед системной группой', async () => {
    await renderSidebar();
    expect(screen.getByText(s.advancedLabel)).toBeTruthy();
  });
});

describe('SettingsTableRow', () => {
  async function renderRow(def: SettingDefinition) {
    const { SettingsTableRow } = await import('./SettingsTableRow');
    render(
      <SettingsTableRow
        setting={def}
        isFavorite={false}
        onToggleFavorite={() => {}}
        onUpdate={() => {}}
        onReset={() => {}}
      />,
    );
  }

  it('изменённая настройка: одна пометка и значение по умолчанию', async () => {
    await renderRow(setting({ key: 'BALANCE_BUTTON_VISIBLE', has_override: true, original: true }));

    expect(screen.getByText(s.modified)).toBeTruthy();
    expect(screen.queryByText(s.badgeDb)).toBeNull();
    expect(screen.getByText(`По умолчанию: ${s.enabled}`)).toBeTruthy();
  });

  it('у секрета значение по умолчанию не показывается', async () => {
    await renderRow(
      setting({
        key: 'LAVA_SECRET_KEY',
        type: 'str',
        has_override: true,
        is_secret: true,
        original: '••••',
      }),
    );
    expect(screen.queryByText(/По умолчанию/)).toBeNull();
  });

  it('ключ копируется по кнопке, а не висит текстом', async () => {
    await renderRow(setting({ key: 'BALANCE_BUTTON_VISIBLE' }));

    expect(screen.queryByText('BALANCE_BUTTON_VISIBLE')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /BALANCE_BUTTON_VISIBLE/ }));
    await vi.waitFor(() => expect(copied).toContain('BALANCE_BUTTON_VISIBLE'));
    expect(await screen.findByText(s.keyCopied)).toBeTruthy();
  });

  it('ключ из .env объясняется текстом, а не только подсказкой при наведении', async () => {
    await renderRow(setting({ key: 'BALANCE_BUTTON_VISIBLE', env_locked: true }));
    expect(screen.getByText(s.envLockedShort)).toBeTruthy();
  });
});
