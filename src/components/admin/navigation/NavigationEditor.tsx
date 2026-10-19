import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALWAYS_VISIBLE_NAV,
  NAV_ITEM_IDS,
  NAV_LAYOUT_QUERY_KEY,
  navigationApi,
  type NavItemId,
  type NavLayoutItem,
} from '../../../api/navigation';
import { useFeatureFlags } from '../../../hooks/useFeatureFlags';
import { isNavItemVisible } from '../../../hooks/useNavLayout';
import { useNotify } from '../../../platform/hooks/useNotify';
import { useNativeDialog } from '../../../platform/hooks/useNativeDialog';
import { getApiErrorMessage } from '../../../utils/api-error';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { mobileNavItems } from '../../layout/AppShell/mobileNavRoutes';
import { OrderedToggleList, moveItem, sameOrderAndVisibility } from '../OrderedToggleList';

// Пункты, которые кабинет показывает только при включённой функции или при наличии записей.
const FEATURE_ITEMS: ReadonlySet<NavItemId> = new Set(['referral', 'gift', 'wheel']);
const CONTENT_ITEMS: ReadonlySet<NavItemId> = new Set(['contests', 'polls']);

/** Редактор навигации веб-кабинета: порядок пунктов, скрытие и предпросмотр. */
export function NavigationEditor() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { confirm: confirmDialog } = useNativeDialog();

  const layoutQuery = useQuery({
    queryKey: NAV_LAYOUT_QUERY_KEY,
    queryFn: navigationApi.getLayout,
  });

  const [draft, setDraft] = useState<NavLayoutItem[]>([]);
  const savedRef = useRef<NavLayoutItem[]>([]);
  // Черновик не затирается фоновым обновлением запроса, пока в нём есть правки.
  useEffect(() => {
    const items = layoutQuery.data?.items;
    if (!items) return;
    // Снимок до обновления: апдейтер setDraft выполнится позже присваивания ниже.
    const previousSaved = savedRef.current;
    setDraft((current) => (sameOrderAndVisibility(current, previousSaved) ? items : current));
    savedRef.current = items;
  }, [layoutQuery.data]);

  const hasChanges = !sameOrderAndVisibility(draft, savedRef.current);

  const saveMutation = useMutation({
    mutationFn: (items: NavLayoutItem[]) => navigationApi.updateLayout({ items }),
    onSuccess: (data) => {
      savedRef.current = data.items;
      setDraft(data.items);
      queryClient.setQueryData(NAV_LAYOUT_QUERY_KEY, data);
      notify.success(t('admin.navEditor.saved'));
    },
    onError: (err) => notify.error(getApiErrorMessage(err, t('common.error'))),
  });

  const move = useCallback((index: number, delta: -1 | 1) => {
    setDraft((items) => moveItem(items, index, delta));
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setDraft((items) =>
      items.map((item) =>
        item.id === id && !ALWAYS_VISIBLE_NAV.has(item.id)
          ? { ...item, visible: !item.visible }
          : item,
      ),
    );
  }, []);

  const resetOrder = useCallback(async () => {
    if (!(await confirmDialog(t('admin.navEditor.resetConfirm')))) return;
    setDraft((items) =>
      NAV_ITEM_IDS.map((id) => items.find((item) => item.id === id) ?? { id, visible: true }),
    );
  }, [confirmDialog, t]);

  if (layoutQuery.isLoading) {
    return (
      <SkeletonGroup className="space-y-3">
        <Skeleton variant="card" count={6} className="h-14" />
      </SkeletonGroup>
    );
  }

  if (layoutQuery.isError) {
    return (
      <div className="rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-400">
        {t('common.error')}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        <p className="text-sm text-dark-400">{t('admin.navEditor.intro')}</p>

        <OrderedToggleList
          items={draft.map((item) => ({
            id: item.id,
            title: t(`nav.${item.id}`),
            visible: item.visible,
            hint: FEATURE_ITEMS.has(item.id)
              ? t('admin.navEditor.hints.feature')
              : CONTENT_ITEMS.has(item.id)
                ? t('admin.navEditor.hints.content')
                : undefined,
            locked: ALWAYS_VISIBLE_NAV.has(item.id),
            lockedNote: t('admin.navEditor.alwaysVisible'),
          }))}
          onMove={move}
          onToggle={toggleVisible}
          disabled={saveMutation.isPending}
          labels={{
            moveUp: t('admin.navEditor.moveUp'),
            moveDown: t('admin.navEditor.moveDown'),
            visible: t('admin.navEditor.visible'),
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          {hasChanges && (
            <>
              <button
                type="button"
                onClick={() => saveMutation.mutate(draft)}
                disabled={saveMutation.isPending}
                className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-600 disabled:opacity-50"
              >
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => setDraft(savedRef.current)}
                disabled={saveMutation.isPending}
                className="rounded-xl bg-dark-700 px-4 py-2 text-sm font-medium text-dark-300 transition-colors hover:bg-dark-600 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={resetOrder}
            disabled={saveMutation.isPending}
            className="ml-auto rounded-xl bg-dark-700 px-4 py-2 text-sm text-dark-300 transition-colors hover:bg-dark-600 disabled:opacity-50"
          >
            {t('admin.navEditor.resetOrder')}
          </button>
        </div>
      </div>

      <NavigationPreview draft={draft} />
    </div>
  );
}

function NavigationPreview({ draft }: { draft: NavLayoutItem[] }) {
  const { t } = useTranslation();
  const flags = useFeatureFlags();
  const layout = { items: draft };

  // Видит ли пункт пользователь сейчас: функции и записи берутся из реального состояния кабинета.
  const featureOn = (id: NavItemId): boolean => {
    switch (id) {
      case 'referral':
        return flags.referralEnabled ?? true;
      case 'gift':
        return flags.giftEnabled ?? true;
      case 'wheel':
        return flags.wheelEnabled ?? true;
      case 'contests':
        return flags.hasContests ?? true;
      case 'polls':
        return flags.hasPolls ?? true;
      default:
        return true;
    }
  };

  const menu = draft.filter((item) => isNavItemVisible(layout, item.id));
  const bottomBar = mobileNavItems({
    wheelEnabled: flags.wheelEnabled,
    referralEnabled: flags.referralEnabled,
    isVisible: (key) => isNavItemVisible(layout, key),
  });

  return (
    <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
      <h3 className="text-sm font-semibold text-dark-200">{t('admin.navEditor.preview.title')}</h3>

      <div>
        <p className="mb-1.5 text-xs text-dark-400">{t('admin.navEditor.preview.menu')}</p>
        <ul className="space-y-1 rounded-xl border border-dark-700/50 bg-dark-800/50 p-2">
          {menu.map((item) => (
            <li key={item.id} className="rounded-lg px-3 py-1.5 text-[13px]">
              <span className={featureOn(item.id) ? 'text-dark-100' : 'text-dark-500 line-through'}>
                {t(`nav.${item.id}`)}
              </span>
              {!featureOn(item.id) && (
                <span className="ml-1.5 text-[10px] text-dark-500">
                  {t('admin.navEditor.preview.featureOff')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-dark-400">{t('admin.navEditor.preview.bottomBar')}</p>
        <div className="flex justify-around gap-1 rounded-xl border border-dark-700/50 bg-dark-800/50 p-2">
          {bottomBar.map((item) => (
            <span key={item.key} className="min-w-0 truncate text-center text-[11px] text-dark-200">
              {t(`nav.${item.key}`)}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-dark-500">{t('admin.navEditor.preview.note')}</p>
    </aside>
  );
}
