import { describe, expect, it } from 'vitest';
import type { NavItemId, NavLayout } from '@/api/navigation';
import { mobileNavItems } from '@/components/layout/AppShell/mobileNavRoutes';
import { applyNavLayout, isNavItemVisible } from './useNavLayout';

/** Раскладка навигации из админки: порядок и скрытые пункты в шапке, меню и нижней панели. */

const layout = (items: [NavItemId, boolean][]): NavLayout => ({
  items: items.map(([id, visible]) => ({ id, visible })),
});

const links = (...ids: NavItemId[]) => ids.map((navId) => ({ navId, path: `/${navId}` }));

describe('applyNavLayout', () => {
  it('без раскладки оставляет пункты как есть', () => {
    expect(
      applyNavLayout(links('dashboard', 'balance', 'info'), undefined).map((l) => l.navId),
    ).toEqual(['dashboard', 'balance', 'info']);
  });

  it('упорядочивает по раскладке и убирает скрытые', () => {
    const result = applyNavLayout(
      links('dashboard', 'subscription', 'balance', 'support', 'info'),
      layout([
        ['dashboard', true],
        ['support', true],
        ['subscription', true],
        ['info', false],
        ['balance', true],
      ]),
    );
    expect(result.map((l) => l.navId)).toEqual(['dashboard', 'support', 'subscription', 'balance']);
  });

  it('пункт, неизвестный раскладке, уходит в конец, а не пропадает', () => {
    const result = applyNavLayout(links('gift', 'dashboard'), layout([['dashboard', true]]));
    expect(result.map((l) => l.navId)).toEqual(['dashboard', 'gift']);
  });
});

describe('isNavItemVisible', () => {
  it('обязательные пункты видны даже при испорченной раскладке', () => {
    const broken = layout([
      ['profile', false],
      ['dashboard', false],
      ['subscription', false],
      ['balance', false],
    ]);
    expect(isNavItemVisible(broken, 'profile')).toBe(true);
    expect(isNavItemVisible(broken, 'dashboard')).toBe(true);
    expect(isNavItemVisible(broken, 'subscription')).toBe(true);
    expect(isNavItemVisible(broken, 'balance')).toBe(false);
  });
});

describe('mobileNavItems со скрытием', () => {
  it('скрытый пункт пропадает из нижней панели', () => {
    const paths = mobileNavItems({ isVisible: (key) => key !== 'balance' }).map((i) => i.path);
    expect(paths).toEqual(['/', '/subscriptions', '/support']);
  });

  it('скрытое колесо отдаёт слот рефералке', () => {
    const paths = mobileNavItems({
      wheelEnabled: true,
      referralEnabled: true,
      isVisible: (key) => key !== 'wheel',
    }).map((i) => i.path);
    expect(paths).toEqual(['/', '/subscriptions', '/balance', '/referral', '/support']);
  });
});
