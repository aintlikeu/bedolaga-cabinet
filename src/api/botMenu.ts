import apiClient from './client';

/** Кнопки главного меню режима «Полное меню»; совпадают с DEFAULT_MENU_ORDER в боте. */
export const BOT_MENU_ITEM_IDS = [
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
] as const;

export type BotMenuItemId = (typeof BOT_MENU_ITEM_IDS)[number];

export interface BotMenuItem {
  id: BotMenuItemId;
  visible: boolean;
}

export interface BotMenuLayout {
  items: BotMenuItem[];
  /** Кнопки во всю ширину ряда; остальные идут парами. */
  wide: BotMenuItemId[];
  /** Кнопки со своей настройкой *_BUTTON_VISIBLE: сохранение пишет в неё. */
  setting_backed: Partial<Record<BotMenuItemId, string>>;
  /** Кнопки, чья настройка задана в .env — их видимость здесь не меняется. */
  locked: BotMenuItemId[];
}

export type BotMenuScenario = 'new' | 'active' | 'trial' | 'expired';

export interface BotMenuPreviewButton {
  text: string;
  kind: 'callback' | 'url' | 'web_app';
}

export interface BotMenuPreview {
  rows: BotMenuPreviewButton[][];
}

export const BOT_MENU_QUERY_KEY = ['admin-bot-menu'] as const;

export const botMenuApi = {
  getLayout: async (): Promise<BotMenuLayout> => {
    const response = await apiClient.get<BotMenuLayout>('/cabinet/admin/bot-menu');
    return response.data;
  },

  updateLayout: async (items: BotMenuItem[]): Promise<BotMenuLayout> => {
    const response = await apiClient.put<BotMenuLayout>('/cabinet/admin/bot-menu', { items });
    return response.data;
  },

  preview: async (request: {
    scenario: BotMenuScenario;
    is_admin: boolean;
    language?: string;
    items?: BotMenuItem[];
  }): Promise<BotMenuPreview> => {
    const response = await apiClient.post<BotMenuPreview>(
      '/cabinet/admin/bot-menu/preview',
      request,
    );
    return response.data;
  },
};
