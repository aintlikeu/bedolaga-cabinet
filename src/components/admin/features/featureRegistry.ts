import type { NavItemId } from '../../../api/navigation';

/**
 * Реестр раздела «Функции»: что можно включить, скрыть или настроить у каждой
 * функции и какими ключами бота это делается. Новых ключей реестр не вводит —
 * он только собирает в одно место переключатели, разбросанные по дереву
 * настроек, «Брендингу» и отдельным страницам админки.
 */

/** Откуда берётся и куда пишется значение переключателя. */
export type FlagSource =
  /** Обычная настройка бота (`/cabinet/admin/settings/{key}`). */
  | { type: 'setting'; key: string }
  /** CABINET_GIFT_ENABLED — отдельный эндпоинт брендинга. */
  | { type: 'gift' }
  /** CABINET_EMAIL_AUTH_ENABLED — строка в БД главнее окружения, поэтому только через свой эндпоинт. */
  | { type: 'emailAuth' }
  /** is_enabled в конфиге колеса удачи. */
  | { type: 'wheel' }
  /** Видимость пункта в раскладке навигации кабинета (CABINET_NAV_LAYOUT). */
  | { type: 'nav'; id: NavItemId };

export type ToggleRole =
  /** «Функция работает»: выключение отключает её целиком. */
  | 'enabled'
  /** Отдельная кнопка в боте; функция при этом продолжает работать. */
  | 'botButton'
  /** Пункт в навигации кабинета; страница остаётся доступной по прямой ссылке. */
  | 'cabinet'
  /** Дополнительный переключатель со своей подписью (`admin.features.options.<labelKey>`). */
  | 'option';

export interface FeatureToggle {
  role: ToggleRole;
  source: FlagSource;
  labelKey?: string;
  /** Переключатель ничего не меняет, пока выключена сама функция. */
  dependsOnEnabled?: boolean;
  /** Кнопка главного меню режима «Полное меню»: в режиме «Cabinet» меню собирает вкладка «Кнопки». */
  mainMenuOnly?: boolean;
}

/** Как функция связана с кнопкой в боте или пунктом в кабинете, если отдельного переключателя нет. */
export type Coupling = 'withFeature' | 'whenContent' | 'always';

export type FeatureLink = { section: string } | { route: string };

/** Ключи, без которых включённая функция не заработает (пустое значение = не настроено). */
export interface FeatureRequirement {
  /** Достаточно любого из вариантов; внутри варианта нужны все ключи. */
  anyOf: string[][];
  messageKey: string;
}

export type FeatureGroupId = 'sales' | 'marketing' | 'support' | 'menu' | 'login';

export interface FeatureDefinition {
  id: string;
  group: FeatureGroupId;
  toggles: FeatureToggle[];
  /** Состояние функции, у которой нет одного выключателя (например, пробный период). */
  derivedStatus?: (value: (key: string) => unknown) => boolean;
  bot?: Coupling;
  cabinet?: Coupling;
  link?: FeatureLink;
  requires?: FeatureRequirement;
}

export const FEATURE_GROUPS: FeatureGroupId[] = ['sales', 'marketing', 'support', 'menu', 'login'];

const setting = (key: string): FlagSource => ({ type: 'setting', key });
const nav = (id: NavItemId): FlagSource => ({ type: 'nav', id });

function oauthProvider(provider: string): FeatureDefinition {
  const prefix = `OAUTH_${provider.toUpperCase()}`;
  return {
    id: `oauth_${provider}`,
    group: 'login',
    toggles: [{ role: 'enabled', source: setting(`${prefix}_ENABLED`) }],
    cabinet: 'withFeature',
    link: { section: 'users_auth' },
    requires: {
      anyOf: [[`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`]],
      messageKey: 'oauthKeys',
    },
  };
}

export const FEATURES: FeatureDefinition[] = [
  // ── Продажи ────────────────────────────────────────────────────────────────
  {
    id: 'trial',
    group: 'sales',
    toggles: [],
    // Триал выключается не флагом, а нулевой длительностью или запретом для всех.
    derivedStatus: (value) =>
      Number(value('TRIAL_DURATION_DAYS') ?? 0) > 0 && value('TRIAL_DISABLED_FOR') !== 'all',
    bot: 'withFeature',
    cabinet: 'withFeature',
    link: { section: 'subs_trial' },
  },
  {
    id: 'simple_subscription',
    group: 'sales',
    toggles: [{ role: 'enabled', source: setting('SIMPLE_SUBSCRIPTION_ENABLED') }],
    bot: 'withFeature',
    link: { section: 'subs_simple' },
  },
  {
    id: 'traffic_topup',
    group: 'sales',
    toggles: [
      { role: 'enabled', source: setting('TRAFFIC_TOPUP_ENABLED') },
      {
        role: 'botButton',
        source: setting('BUY_TRAFFIC_BUTTON_VISIBLE'),
        dependsOnEnabled: true,
        mainMenuOnly: true,
      },
    ],
    link: { section: 'subs_traffic' },
  },
  {
    id: 'autopay',
    group: 'sales',
    toggles: [{ role: 'enabled', source: setting('ENABLE_AUTOPAY') }],
    link: { section: 'subs_autopay' },
  },
  {
    id: 'daily',
    group: 'sales',
    toggles: [{ role: 'enabled', source: setting('DAILY_SUBSCRIPTIONS_ENABLED') }],
    link: { section: 'subs_daily' },
  },
  {
    id: 'gifts',
    group: 'sales',
    toggles: [
      { role: 'enabled', source: { type: 'gift' } },
      // Не зависит от продаж: через эту кнопку же вручную активируют полученный код.
      { role: 'botButton', source: setting('GIFT_BUTTON_VISIBLE') },
      { role: 'cabinet', source: nav('gift'), dependsOnEnabled: true },
    ],
  },

  // ── Маркетинг ──────────────────────────────────────────────────────────────
  {
    id: 'referral',
    group: 'marketing',
    toggles: [
      { role: 'enabled', source: setting('REFERRAL_PROGRAM_ENABLED') },
      {
        role: 'botButton',
        source: setting('REFERRAL_BUTTON_VISIBLE'),
        dependsOnEnabled: true,
        mainMenuOnly: true,
      },
      { role: 'cabinet', source: nav('referral'), dependsOnEnabled: true },
    ],
    link: { section: 'users_referral' },
  },
  {
    id: 'partners',
    group: 'marketing',
    toggles: [
      {
        role: 'option',
        source: setting('REFERRAL_PARTNER_SECTION_VISIBLE'),
        labelKey: 'partnerSection',
      },
      { role: 'option', source: setting('REFERRAL_WITHDRAWAL_ENABLED'), labelKey: 'withdrawals' },
    ],
    link: { route: '/admin/partners/settings' },
  },
  {
    id: 'contests',
    group: 'marketing',
    toggles: [
      { role: 'enabled', source: setting('CONTESTS_ENABLED') },
      {
        role: 'botButton',
        source: setting('CONTESTS_BUTTON_VISIBLE'),
        dependsOnEnabled: true,
        mainMenuOnly: true,
      },
      { role: 'cabinet', source: nav('contests'), dependsOnEnabled: true },
    ],
    cabinet: 'whenContent',
    link: { section: 'users_contests' },
  },
  {
    id: 'wheel',
    group: 'marketing',
    toggles: [
      { role: 'enabled', source: { type: 'wheel' } },
      { role: 'cabinet', source: nav('wheel'), dependsOnEnabled: true },
    ],
    link: { route: '/admin/wheel' },
  },
  {
    id: 'polls',
    group: 'marketing',
    toggles: [{ role: 'cabinet', source: nav('polls') }],
    cabinet: 'whenContent',
  },
  {
    id: 'promocode',
    group: 'marketing',
    toggles: [
      { role: 'botButton', source: setting('PROMOCODE_BUTTON_VISIBLE'), mainMenuOnly: true },
    ],
    cabinet: 'always',
    link: { route: '/admin/promocodes' },
  },

  // ── Поддержка и язык ───────────────────────────────────────────────────────
  {
    id: 'support',
    group: 'support',
    toggles: [
      { role: 'enabled', source: setting('SUPPORT_MENU_ENABLED') },
      { role: 'cabinet', source: nav('support') },
    ],
    bot: 'withFeature',
    link: { section: 'users_support' },
  },
  {
    id: 'language',
    group: 'support',
    toggles: [{ role: 'enabled', source: setting('LANGUAGE_SELECTION_ENABLED') }],
    bot: 'withFeature',
    link: { section: 'users_localization' },
  },

  // ── Кнопки главного меню бота (режим «Полное меню») ────────────────────────
  {
    id: 'balance',
    group: 'menu',
    toggles: [
      { role: 'botButton', source: setting('BALANCE_BUTTON_VISIBLE'), mainMenuOnly: true },
      { role: 'cabinet', source: nav('balance') },
    ],
  },
  {
    id: 'info',
    group: 'menu',
    toggles: [
      { role: 'botButton', source: setting('INFO_BUTTON_VISIBLE'), mainMenuOnly: true },
      { role: 'cabinet', source: nav('info') },
    ],
  },
  {
    id: 'activate',
    group: 'menu',
    toggles: [
      { role: 'botButton', source: setting('ACTIVATE_BUTTON_VISIBLE'), mainMenuOnly: true },
    ],
    link: { section: 'iface_connect' },
  },

  // ── Вход в кабинет ─────────────────────────────────────────────────────────
  {
    id: 'email_auth',
    group: 'login',
    toggles: [{ role: 'enabled', source: { type: 'emailAuth' } }],
    cabinet: 'withFeature',
    link: { section: 'users_email' },
    // Как settings.is_smtp_configured(): хост и отправитель (адрес или логин).
    requires: {
      anyOf: [
        ['SMTP_HOST', 'SMTP_FROM_EMAIL'],
        ['SMTP_HOST', 'SMTP_USER'],
      ],
      messageKey: 'smtp',
    },
  },
  oauthProvider('google'),
  oauthProvider('yandex'),
  oauthProvider('vk'),
  oauthProvider('discord'),
];

/** Значение настройки «задано»: непустая строка, в том числе маска секрета. */
export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

/** Выполнено ли требование к настройкам; без требования — всегда да. */
export function requirementMet(
  requirement: FeatureRequirement | undefined,
  value: (key: string) => unknown,
): boolean {
  if (!requirement) return true;
  return requirement.anyOf.some((keys) => keys.every((key) => isFilled(value(key))));
}

/** Булево значение настройки так же, как его читает строка настроек ('true' или true). */
export function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}
