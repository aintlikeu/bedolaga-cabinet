// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';
import { ToastProvider } from '@/components/Toast';
import { PlatformProvider } from '@/platform/PlatformProvider';

/**
 * Вкладка «Кнопки»: редактор меню режима «Полное меню» с предпросмотром и
 * переключатель режимов. Бот читает раскладку только активного режима, поэтому
 * неактивный режим помечается и объясняется.
 */

const m = ruLocale.admin.botMenu;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ruLocale);
      if (typeof value !== 'string') return key;
      return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'ru', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const DEFAULT_IDS = [
  'connect',
  'happ',
  'balance',
  'subscription',
  'buy_traffic',
  'trial',
  'buy',
  'simple_buy',
  'resume_checkout',
  'custom',
  'promocode',
  'referral',
  'contests',
  'support',
  'activate',
  'info',
  'language',
];

const backend = vi.hoisted(() => ({
  mode: 'default',
  items: [] as { id: string; visible: boolean }[],
  locked: [] as string[],
  puts: [] as { id: string; visible: boolean }[][],
  previews: [] as { scenario: string; items?: { id: string; visible: boolean }[] }[],
}));

vi.mock('@/api/adminSettings', () => ({
  adminSettingsApi: {
    getSetting: (key: string) => Promise.resolve({ key, current: backend.mode }),
  },
}));

vi.mock('@/api/botMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/botMenu')>();
  const layout = () => ({
    items: structuredClone(backend.items),
    wide: ['balance', 'connect', 'happ'],
    setting_backed: { balance: 'BALANCE_BUTTON_VISIBLE', info: 'INFO_BUTTON_VISIBLE' },
    locked: backend.locked,
  });
  return {
    ...actual,
    botMenuApi: {
      getLayout: () => Promise.resolve(layout()),
      updateLayout: (items: { id: string; visible: boolean }[]) => {
        backend.puts.push(structuredClone(items));
        backend.items = structuredClone(items);
        return Promise.resolve(layout());
      },
      preview: (request: { scenario: string; items?: { id: string; visible: boolean }[] }) => {
        backend.previews.push(structuredClone(request));
        const visible = (request.items ?? backend.items).filter((item) => item.visible);
        return Promise.resolve({
          rows: [[{ text: `${request.scenario}:${visible[0]?.id}`, kind: 'callback' }]],
        });
      },
    },
  };
});

// Редактор режима Cabinet проверяется своими тестами; здесь важно только, что он открывается.
vi.mock('../MenuEditorTab', () => ({ MenuEditorTab: () => <div>cabinet-editor</div> }));

beforeEach(() => {
  backend.mode = 'default';
  backend.items = DEFAULT_IDS.map((id) => ({ id, visible: true }));
  backend.locked = [];
  backend.puts = [];
  backend.previews = [];
});
afterEach(cleanup);

let client: QueryClient;

async function renderSection(onOpenSection?: (section: string) => void) {
  const { ButtonsSection } = await import('./ButtonsSection');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PlatformProvider>
          <ButtonsSection onOpenSection={onOpenSection} />
        </PlatformProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(m.intro);
}

function row(id: keyof typeof m.items): HTMLElement {
  const item = screen.getByText(m.items[id].title, { selector: 'p' }).closest('li');
  if (!item) throw new Error(`строка ${id} не найдена`);
  return item;
}

function visibilitySwitch(id: keyof typeof m.items): HTMLButtonElement {
  return within(row(id)).getByRole('switch') as HTMLButtonElement;
}

function orderOnScreen(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('p')?.firstChild?.textContent ?? '');
}

describe('ButtonsSection', () => {
  it('открывает редактор активного режима и помечает его', async () => {
    await renderSection();
    const tab = screen.getByRole('tab', { name: new RegExp(m.mode.default) });

    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(within(tab).getByText(m.mode.active)).toBeTruthy();
    expect(screen.queryByText(m.mode.inactiveTitle)).toBeNull();
  });

  it('неактивный режим объясняет, что меню заработает после переключения', async () => {
    backend.mode = 'cabinet';
    const onOpenSection = vi.fn();
    const { ButtonsSection } = await import('./ButtonsSection');
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <PlatformProvider>
            <ButtonsSection onOpenSection={onOpenSection} />
          </PlatformProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('cabinet-editor')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(m.mode.default) }));
    expect(await screen.findByText(m.mode.inactiveTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.mode.switch }));
    expect(onOpenSection).toHaveBeenCalledWith('iface_general');
  });
});

describe('BotMenuEditor', () => {
  it('переставляет и скрывает кнопки, сохраняет одним запросом', async () => {
    await renderSection();

    fireEvent.click(
      within(row('balance')).getByRole('button', { name: `${m.items.balance.title}: ${m.moveUp}` }),
    );
    fireEvent.click(visibilitySwitch('support'));
    expect(orderOnScreen().slice(0, 3)).toEqual([
      m.items.connect.title,
      m.items.balance.title,
      m.items.happ.title,
    ]);

    fireEvent.click(screen.getByRole('button', { name: ruLocale.common.save }));
    await vi.waitFor(() => expect(backend.puts).toHaveLength(1));

    const sent = backend.puts[0];
    expect(sent.slice(0, 3).map((item) => item.id)).toEqual(['connect', 'balance', 'happ']);
    expect(sent.find((item) => item.id === 'support')?.visible).toBe(false);
  });

  it('«Отмена» возвращает сохранённое меню', async () => {
    await renderSection();
    fireEvent.click(visibilitySwitch('info'));
    fireEvent.click(screen.getByRole('button', { name: ruLocale.common.cancel }));

    expect(visibilitySwitch('info').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: ruLocale.common.save })).toBeNull();
  });

  it('скрытие ключевой кнопки предупреждает о последствиях', async () => {
    await renderSection();
    fireEvent.click(visibilitySwitch('buy'));

    expect(within(row('buy')).getByText(m.criticalHidden.buy)).toBeTruthy();
  });

  it('кнопку с настройкой из .env переключить нельзя', async () => {
    backend.locked = ['balance'];
    await renderSection();

    expect(visibilitySwitch('balance').disabled).toBe(true);
    expect(within(row('balance')).getByText(m.locked)).toBeTruthy();
  });

  it('предпросмотр строится по черновику и сценарию', async () => {
    await renderSection();
    expect(await screen.findByText('new:connect')).toBeTruthy();

    fireEvent.click(visibilitySwitch('connect'));
    fireEvent.click(screen.getByRole('radio', { name: m.preview.scenarios.active }));

    expect(await screen.findByText('active:happ')).toBeTruthy();
    expect(backend.puts).toHaveLength(0);
  });

  it('фоновое обновление не затирает несохранённые правки', async () => {
    await renderSection();
    fireEvent.click(visibilitySwitch('info'));

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['admin-bot-menu'] });
    });

    expect(visibilitySwitch('info').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: ruLocale.common.save })).toBeTruthy();
  });
});
