import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminSettingsApi, type SettingDefinition } from '../../../api/adminSettings';
import { brandingApi } from '../../../api/branding';
import { NAV_LAYOUT_QUERY_KEY, navigationApi, type NavLayout } from '../../../api/navigation';
import { adminWheelApi } from '../../../api/wheel';
import { useNotify } from '../../../platform/hooks/useNotify';
import { getApiErrorMessage } from '../../../utils/api-error';
import { ChevronRightIcon, LockIcon, SearchIcon } from '@/components/icons';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { cn } from '../../../lib/utils';
import { isNavItemVisible } from '../../../hooks/useNavLayout';
import { backTo } from '../AdminBackButton';
import { Toggle } from '../Toggle';
import {
  FEATURE_GROUPS,
  FEATURES,
  asBool,
  requirementMet,
  type FeatureDefinition,
  type FeatureToggle,
  type FlagSource,
} from './featureRegistry';

/** Разрешённое состояние переключателя для отрисовки. */
interface FlagState {
  available: boolean;
  value: boolean;
  /** Задано в .env (или только для чтения): в админке не меняется. */
  locked: boolean;
}

const UNAVAILABLE: FlagState = { available: false, value: false, locked: false };

function sourceId(source: FlagSource): string {
  if (source.type === 'setting') return `setting:${source.key}`;
  if (source.type === 'nav') return `nav:${source.id}`;
  return source.type;
}

/** Раскладка с переключённой видимостью одного пункта; порядок не меняется. */
function withNavVisibility(layout: NavLayout, id: string, visible: boolean): NavLayout {
  return { items: layout.items.map((item) => (item.id === id ? { ...item, visible } : item)) };
}

// Откуда пользователь пришёл в раздел — туда вернёт «Назад» со страниц, на которые ведут карточки.
const FEATURES_LOCATION = { pathname: '/admin/settings', search: '?section=features' };

interface FeaturesTabProps {
  /** Открыть раздел настроек по id из дерева («Настроить» в карточке). */
  onOpenSection?: (section: string) => void;
}

export function FeaturesTab({ onOpenSection }: FeaturesTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  // Тот же запрос, что у страницы настроек: кэш общий, правки видны в дереве сразу.
  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => adminSettingsApi.getSettings(),
  });
  // Ключи запросов совпадают с «Брендингом», колесом и флагами кабинета — одна правда на всех.
  const giftQuery = useQuery({
    queryKey: ['gift-enabled'],
    queryFn: brandingApi.getGiftEnabled,
    retry: false,
  });
  const emailAuthQuery = useQuery({
    queryKey: ['email-auth-enabled'],
    queryFn: brandingApi.getEmailAuthEnabled,
    retry: false,
  });
  const wheelQuery = useQuery({
    queryKey: ['admin-wheel-config'],
    queryFn: adminWheelApi.getConfig,
    retry: false,
  });
  // Тот же ключ, что у навигации кабинета: админ сразу видит своё меню изменённым.
  const navQuery = useQuery({
    queryKey: NAV_LAYOUT_QUERY_KEY,
    queryFn: navigationApi.getLayout,
    retry: false,
  });

  const settingsByKey = useMemo(() => {
    const map = new Map<string, SettingDefinition>();
    for (const item of settingsQuery.data ?? []) map.set(item.key, item);
    return map;
  }, [settingsQuery.data]);

  const value = useCallback((key: string) => settingsByKey.get(key)?.current, [settingsByKey]);
  const isCabinetMenuMode = value('MAIN_MENU_MODE') === 'cabinet';

  const flagState = useCallback(
    (source: FlagSource): FlagState => {
      switch (source.type) {
        case 'setting': {
          const item = settingsByKey.get(source.key);
          if (!item) return UNAVAILABLE;
          return {
            available: true,
            value: asBool(item.current),
            locked: item.env_locked || item.read_only,
          };
        }
        case 'gift':
          return giftQuery.data
            ? { available: true, value: giftQuery.data.enabled, locked: false }
            : UNAVAILABLE;
        case 'emailAuth':
          return emailAuthQuery.data
            ? { available: true, value: emailAuthQuery.data.enabled, locked: false }
            : UNAVAILABLE;
        case 'wheel':
          return wheelQuery.data
            ? { available: true, value: wheelQuery.data.is_enabled, locked: false }
            : UNAVAILABLE;
        case 'nav':
          return navQuery.data
            ? { available: true, value: isNavItemVisible(navQuery.data, source.id), locked: false }
            : UNAVAILABLE;
      }
    },
    [settingsByKey, giftQuery.data, emailAuthQuery.data, wheelQuery.data, navQuery.data],
  );

  const toggleMutation = useMutation({
    mutationFn: async ({ source, next }: { source: FlagSource; next: boolean }) => {
      switch (source.type) {
        case 'setting':
          // Строкой, как и переключатель в дереве настроек.
          return adminSettingsApi.updateSetting(source.key, next ? 'true' : 'false');
        case 'gift':
          return brandingApi.updateGiftEnabled(next);
        case 'emailAuth':
          return brandingApi.updateEmailAuthEnabled(next);
        case 'wheel':
          return adminWheelApi.updateConfig({ is_enabled: next });
        case 'nav': {
          // Кэш уже обновлён в onMutate: отправляем раскладку целиком, вместе с соседними правками.
          const layout = queryClient.getQueryData<NavLayout>(NAV_LAYOUT_QUERY_KEY);
          if (!layout) throw new Error('navigation layout is not loaded');
          return navigationApi.updateLayout(layout);
        }
      }
    },
    onMutate: ({ source, next }) => {
      setPending((prev) => new Set(prev).add(sourceId(source)));
      if (source.type !== 'nav') return undefined;
      const previous = queryClient.getQueryData<NavLayout>(NAV_LAYOUT_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData(
          NAV_LAYOUT_QUERY_KEY,
          withNavVisibility(previous, source.id, next),
        );
      }
      return { previousNav: previous };
    },
    onError: (err, { source }, context) => {
      // Откатываем только свой пункт: соседние правки, сделанные тем временем, остаются.
      const current = queryClient.getQueryData<NavLayout>(NAV_LAYOUT_QUERY_KEY);
      if (source.type === 'nav' && context?.previousNav && current) {
        queryClient.setQueryData(
          NAV_LAYOUT_QUERY_KEY,
          withNavVisibility(current, source.id, isNavItemVisible(context.previousNav, source.id)),
        );
      }
      notify.error(getApiErrorMessage(err, t('common.error')));
    },
    onSettled: (_data, _err, { source }) => {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(sourceId(source));
        return next;
      });
      switch (source.type) {
        case 'setting':
          queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
          // Пункт «Рефералы» в навигации кабинета решается по условиям программы.
          if (source.key === 'REFERRAL_PROGRAM_ENABLED') {
            queryClient.invalidateQueries({ queryKey: ['referral-terms'] });
          }
          break;
        case 'gift':
          queryClient.invalidateQueries({ queryKey: ['gift-enabled'] });
          break;
        case 'emailAuth':
          queryClient.invalidateQueries({ queryKey: ['email-auth-enabled'] });
          break;
        case 'wheel':
          queryClient.invalidateQueries({ queryKey: ['admin-wheel-config'] });
          queryClient.invalidateQueries({ queryKey: ['wheel-config'] });
          break;
        case 'nav':
          queryClient.invalidateQueries({ queryKey: NAV_LAYOUT_QUERY_KEY });
          break;
      }
    },
  });

  const toggle = useCallback(
    (source: FlagSource) => {
      const state = flagState(source);
      if (!state.available || state.locked || pending.has(sourceId(source))) return;
      toggleMutation.mutate({ source, next: !state.value });
    },
    [flagState, pending, toggleMutation],
  );

  const query = search.trim().toLowerCase();
  const visibleFeatures = useMemo(() => {
    if (!query) return FEATURES;
    return FEATURES.filter((feature) =>
      [
        t(`admin.features.items.${feature.id}.title`),
        t(`admin.features.items.${feature.id}.description`),
      ].some((text) => text.toLowerCase().includes(query)),
    );
  }, [query, t]);

  if (settingsQuery.isLoading) {
    return (
      <SkeletonGroup className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Skeleton variant="card" count={6} className="h-36" />
        </div>
      </SkeletonGroup>
    );
  }

  if (settingsQuery.isError) {
    return (
      <div className="rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-400">
        {t('common.error')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-dark-400">{t('admin.features.intro')}</p>

      {isCabinetMenuMode && (
        <div className="rounded-xl border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-warning-400">{t('admin.features.cabinetMode.title')}</p>
          <p className="mt-1 text-dark-300">{t('admin.features.cabinetMode.body')}</p>
          {onOpenSection && (
            <button
              type="button"
              onClick={() => onOpenSection('buttons')}
              className="mt-2 text-sm font-medium text-accent-400 transition-colors hover:text-accent-300"
            >
              {t('admin.features.cabinetMode.open')}
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.features.search')}
          aria-label={t('admin.features.search')}
          className="w-full rounded-xl border border-dark-600 bg-dark-700/50 py-2.5 pl-9 pr-3 text-sm text-dark-100 placeholder-dark-500 transition-colors focus:border-accent-500 focus:outline-none"
        />
      </div>

      {visibleFeatures.length === 0 && (
        <p className="rounded-xl border border-dark-700/30 bg-dark-800/30 p-8 text-center text-sm text-dark-400">
          {t('admin.features.empty')}
        </p>
      )}

      {FEATURE_GROUPS.map((group) => {
        const features = visibleFeatures.filter((feature) => feature.group === group);
        if (features.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`features-group-${group}`}>
            <h3
              id={`features-group-${group}`}
              className="mb-1 text-sm font-semibold uppercase tracking-wide text-dark-300"
            >
              {t(`admin.features.groups.${group}.title`)}
            </h3>
            <p className="mb-3 text-xs text-dark-500">
              {t(`admin.features.groups.${group}.description`)}
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {features.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  value={value}
                  flagState={flagState}
                  pending={pending}
                  onToggle={toggle}
                  isCabinetMenuMode={isCabinetMenuMode}
                  onOpenSection={onOpenSection}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type CardStatus = 'on' | 'off' | 'needsSetup' | 'unavailable' | null;

function cardStatus(
  feature: FeatureDefinition,
  value: (key: string) => unknown,
  flagState: (source: FlagSource) => FlagState,
): CardStatus {
  if (feature.derivedStatus) return feature.derivedStatus(value) ? 'on' : 'off';
  const main = feature.toggles.find((toggle) => toggle.role === 'enabled');
  // Без общего выключателя состояние видно по самим переключателям.
  if (!main) return null;
  const state = flagState(main.source);
  if (!state.available) return 'unavailable';
  if (!state.value) return 'off';
  return requirementMet(feature.requires, value) ? 'on' : 'needsSetup';
}

const STATUS_STYLES: Record<Exclude<CardStatus, null>, string> = {
  on: 'bg-success-500/15 text-success-400',
  off: 'bg-dark-600 text-dark-300',
  needsSetup: 'bg-warning-500/15 text-warning-400',
  unavailable: 'bg-dark-600 text-dark-400',
};

interface FeatureCardProps {
  feature: FeatureDefinition;
  value: (key: string) => unknown;
  flagState: (source: FlagSource) => FlagState;
  pending: ReadonlySet<string>;
  onToggle: (source: FlagSource) => void;
  isCabinetMenuMode: boolean;
  onOpenSection?: (section: string) => void;
}

function FeatureCard({
  feature,
  value,
  flagState,
  pending,
  onToggle,
  isCabinetMenuMode,
  onOpenSection,
}: FeatureCardProps) {
  const { t } = useTranslation();
  const status = cardStatus(feature, value, flagState);
  const main = feature.toggles.find((toggle) => toggle.role === 'enabled');
  const featureOn = main ? flagState(main.source).value : true;
  const showRequirement = !!main && featureOn && !requirementMet(feature.requires, value);
  const title = t(`admin.features.items.${feature.id}.title`);

  return (
    <article className="flex flex-col rounded-2xl border border-dark-700/50 bg-dark-800/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-dark-100">{title}</h4>
          <p className="mt-0.5 text-xs leading-relaxed text-dark-400">
            {t(`admin.features.items.${feature.id}.description`)}
          </p>
        </div>
        {status && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              STATUS_STYLES[status],
            )}
          >
            {t(`admin.features.status.${status}`)}
          </span>
        )}
      </div>

      {feature.toggles.length > 0 && (
        <div className="mt-3 divide-y divide-dark-700/40 rounded-xl bg-dark-900/30">
          {feature.toggles.map((toggle) => (
            <ToggleRow
              key={sourceId(toggle.source)}
              toggle={toggle}
              title={title}
              state={flagState(toggle.source)}
              isPending={pending.has(sourceId(toggle.source))}
              onToggle={onToggle}
              featureOn={featureOn}
              isCabinetMenuMode={isCabinetMenuMode}
            />
          ))}
        </div>
      )}

      {showRequirement && feature.requires && (
        <p className="mt-3 rounded-lg bg-warning-500/10 px-3 py-2 text-xs text-warning-400">
          {t(`admin.features.requires.${feature.requires.messageKey}`)}
        </p>
      )}

      {/* Сноски и «Настроить» прижаты к низу: в ряду карточек они стоят на одной линии. */}
      {(feature.bot || feature.cabinet || feature.link) && (
        <div className="mt-auto space-y-3 pt-3">
          {(feature.bot || feature.cabinet) && (
            <ul className="space-y-0.5 text-[11px] text-dark-500">
              {feature.bot && <li>{t(`admin.features.coupling.bot.${feature.bot}`)}</li>}
              {feature.cabinet && (
                <li>{t(`admin.features.coupling.cabinet.${feature.cabinet}`)}</li>
              )}
            </ul>
          )}
          {feature.link && <FeatureLinkButton link={feature.link} onOpenSection={onOpenSection} />}
        </div>
      )}
    </article>
  );
}

interface ToggleRowProps {
  toggle: FeatureToggle;
  title: string;
  state: FlagState;
  isPending: boolean;
  onToggle: (source: FlagSource) => void;
  featureOn: boolean;
  isCabinetMenuMode: boolean;
}

function ToggleRow({
  toggle,
  title,
  state,
  isPending,
  onToggle,
  featureOn,
  isCabinetMenuMode,
}: ToggleRowProps) {
  const { t } = useTranslation();
  const label =
    toggle.role === 'option' && toggle.labelKey
      ? t(`admin.features.options.${toggle.labelKey}`)
      : t(`admin.features.toggles.${toggle.role}`);

  // Подсказка — почему переключатель сейчас ни на что не влияет или не меняется.
  let hint: string | null = null;
  if (!state.available) hint = t('admin.features.hints.unavailable');
  else if (state.locked) hint = t('admin.features.hints.envLocked');
  else if (toggle.mainMenuOnly && isCabinetMenuMode) hint = t('admin.features.hints.cabinetMode');
  else if (toggle.dependsOnEnabled && !featureOn) hint = t('admin.features.hints.dependsOnEnabled');

  const inert =
    (toggle.mainMenuOnly && isCabinetMenuMode) || (toggle.dependsOnEnabled && !featureOn);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1">
      <div className={cn('min-w-0', inert && 'opacity-60')}>
        <p className="flex items-center gap-1.5 text-[13px] text-dark-200">
          {label}
          {state.locked && <LockIcon className="h-3 w-3 text-warning-400" />}
        </p>
        {hint && <p className="text-[11px] text-dark-500">{hint}</p>}
      </div>
      <Toggle
        checked={state.value}
        onChange={() => onToggle(toggle.source)}
        disabled={!state.available || state.locked || isPending}
        aria-label={`${title}: ${label}`}
      />
    </div>
  );
}

function FeatureLinkButton({
  link,
  onOpenSection,
}: {
  link: NonNullable<FeatureDefinition['link']>;
  onOpenSection?: (section: string) => void;
}) {
  const { t } = useTranslation();
  const className =
    'inline-flex items-center gap-1 text-xs font-medium text-accent-400 transition-colors hover:text-accent-300';

  if ('route' in link) {
    return (
      <Link to={link.route} {...backTo(FEATURES_LOCATION)} className={className}>
        {t('admin.features.configure')}
        <ChevronRightIcon className="h-3.5 w-3.5" />
      </Link>
    );
  }
  if (!onOpenSection) return null;
  return (
    <button type="button" onClick={() => onOpenSection(link.section)} className={className}>
      {t('admin.features.configure')}
      <ChevronRightIcon className="h-3.5 w-3.5" />
    </button>
  );
}
