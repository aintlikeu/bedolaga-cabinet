import apiClient from './client';

/** Пункты навигации кабинета; совпадают с DEFAULT_NAV_ORDER в боте. */
export const NAV_ITEM_IDS = [
  'dashboard',
  'subscription',
  'balance',
  'referral',
  'gift',
  'wheel',
  'contests',
  'polls',
  'support',
  'info',
  'profile',
] as const;

export type NavItemId = (typeof NAV_ITEM_IDS)[number];

/** Без них пользователь теряет дорогу к подписке и выходу; бот всё равно держит их видимыми. */
export const ALWAYS_VISIBLE_NAV: ReadonlySet<NavItemId> = new Set([
  'dashboard',
  'subscription',
  'profile',
]);

export interface NavLayoutItem {
  id: NavItemId;
  visible: boolean;
}

export interface NavLayout {
  items: NavLayoutItem[];
}

export const NAV_LAYOUT_QUERY_KEY = ['cabinet-navigation'] as const;

export const navigationApi = {
  /** Публичный эндпоинт: раскладку видят все, кто открыл кабинет. */
  getLayout: async (): Promise<NavLayout> => {
    const response = await apiClient.get<NavLayout>('/cabinet/navigation');
    return response.data;
  },

  updateLayout: async (layout: NavLayout): Promise<NavLayout> => {
    const response = await apiClient.put<NavLayout>('/cabinet/admin/navigation', layout);
    return response.data;
  },
};
