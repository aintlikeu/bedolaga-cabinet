import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOT_MENU_ITEM_IDS,
  BOT_MENU_QUERY_KEY,
  botMenuApi,
  type BotMenuItem,
  type BotMenuItemId,
  type BotMenuLayout,
  type BotMenuPreviewButton,
  type BotMenuScenario,
} from '../../../api/botMenu';
import { useNotify } from '../../../platform/hooks/useNotify';
import { useNativeDialog } from '../../../platform/hooks/useNativeDialog';
import { getApiErrorMessage } from '../../../utils/api-error';
import { cn } from '../../../lib/utils';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useDebouncedValue } from '../reachability/useDebouncedValue';
import { OrderedToggleList, moveItem, sameOrderAndVisibility } from '../OrderedToggleList';

// Без этих кнопок у пользователя пропадает главный путь — предупреждаем при скрытии.
const CRITICAL_ITEMS: ReadonlySet<BotMenuItemId> = new Set(['connect', 'buy', 'subscription']);

const SCENARIOS: BotMenuScenario[] = ['new', 'active', 'trial', 'expired'];

/** Редактор главного меню режима «Полное меню»: порядок, видимость и живой предпросмотр. */
export function BotMenuEditor() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { confirm: confirmDialog } = useNativeDialog();

  const layoutQuery = useQuery({ queryKey: BOT_MENU_QUERY_KEY, queryFn: botMenuApi.getLayout });

  const [draft, setDraft] = useState<BotMenuItem[]>([]);
  const savedRef = useRef<BotMenuItem[]>([]);
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
    mutationFn: (items: BotMenuItem[]) => botMenuApi.updateLayout(items),
    onSuccess: (data: BotMenuLayout) => {
      savedRef.current = data.items;
      setDraft(data.items);
      queryClient.setQueryData(BOT_MENU_QUERY_KEY, data);
      // Видимость части кнопок живёт в настройках бота — дерево настроек должно это увидеть.
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      notify.success(t('admin.botMenu.saved'));
    },
    onError: (err) => notify.error(getApiErrorMessage(err, t('common.error'))),
  });

  const move = useCallback((index: number, delta: -1 | 1) => {
    setDraft((items) => moveItem(items, index, delta));
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setDraft((items) =>
      items.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item)),
    );
  }, []);

  const resetOrder = useCallback(async () => {
    if (!layoutQuery.data || !(await confirmDialog(t('admin.botMenu.resetConfirm')))) return;
    // Порядок как в боте по умолчанию — это порядок id в BOT_MENU_ITEM_IDS; видимость не трогаем.
    setDraft((items) =>
      BOT_MENU_ITEM_IDS.map((id) => items.find((item) => item.id === id) ?? { id, visible: true }),
    );
  }, [layoutQuery.data, confirmDialog, t]);

  if (layoutQuery.isLoading) {
    return (
      <SkeletonGroup className="space-y-3">
        <Skeleton variant="card" count={6} className="h-14" />
      </SkeletonGroup>
    );
  }

  if (layoutQuery.isError || !layoutQuery.data) {
    return (
      <div className="rounded-xl border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm text-error-400">
        {t('common.error')}
      </div>
    );
  }

  const layout = layoutQuery.data;
  const wide = new Set(layout.wide);
  const locked = new Set(layout.locked);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <p className="text-sm text-dark-400">{t('admin.botMenu.intro')}</p>

        <OrderedToggleList
          items={draft.map((item) => ({
            id: item.id,
            title: t(`admin.botMenu.items.${item.id}.title`),
            visible: item.visible,
            hint: t(`admin.botMenu.items.${item.id}.hint`),
            badge: wide.has(item.id) ? t('admin.botMenu.wide') : undefined,
            locked: locked.has(item.id),
            lockedNote: t('admin.botMenu.locked'),
            warning:
              !item.visible && CRITICAL_ITEMS.has(item.id)
                ? t(`admin.botMenu.criticalHidden.${item.id}`)
                : undefined,
          }))}
          onMove={move}
          onToggle={toggleVisible}
          disabled={saveMutation.isPending}
          labels={{
            moveUp: t('admin.botMenu.moveUp'),
            moveDown: t('admin.botMenu.moveDown'),
            visible: t('admin.botMenu.visible'),
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
            {t('admin.botMenu.resetOrder')}
          </button>
        </div>
      </div>

      <BotMenuPreviewPanel draft={draft} language={i18n.language} />
    </div>
  );
}

function BotMenuPreviewPanel({ draft, language }: { draft: BotMenuItem[]; language: string }) {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState<BotMenuScenario>('new');
  const [asAdmin, setAsAdmin] = useState(false);
  // Предпросмотр строит бот; не дёргаем его на каждый клик по стрелке.
  const debouncedDraft = useDebouncedValue(draft, 300);
  const draftKey = useMemo(
    () => debouncedDraft.map((item) => `${item.id}:${item.visible ? 1 : 0}`).join(','),
    [debouncedDraft],
  );

  const previewQuery = useQuery({
    queryKey: ['admin-bot-menu-preview', scenario, asAdmin, language, draftKey],
    queryFn: () =>
      botMenuApi.preview({ scenario, is_admin: asAdmin, language, items: debouncedDraft }),
    enabled: debouncedDraft.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
      <h3 className="text-sm font-semibold text-dark-200">{t('admin.botMenu.preview.title')}</h3>
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label={t('admin.botMenu.preview.title')}
      >
        {SCENARIOS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={scenario === id}
            onClick={() => setScenario(id)}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
              scenario === id
                ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                : 'border-dark-600 bg-dark-700/50 text-dark-300 hover:border-dark-500',
            )}
          >
            {t(`admin.botMenu.preview.scenarios.${id}`)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-dark-300">
        <input
          type="checkbox"
          checked={asAdmin}
          onChange={(e) => setAsAdmin(e.target.checked)}
          className="h-4 w-4 accent-[rgb(var(--color-accent-500))]"
        />
        {t('admin.botMenu.preview.asAdmin')}
      </label>

      <div
        className={cn(
          'space-y-1 rounded-2xl bg-[#17212b] p-2 transition-opacity',
          previewQuery.isFetching && 'opacity-70',
        )}
        aria-live="polite"
      >
        {previewQuery.isError && (
          <p className="p-2 text-xs text-error-400">{t('admin.botMenu.preview.error')}</p>
        )}
        {previewQuery.data?.rows.length === 0 && (
          <p className="p-2 text-xs text-dark-400">{t('admin.botMenu.preview.empty')}</p>
        )}
        {previewQuery.data?.rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((button, buttonIndex) => (
              <PreviewButton key={buttonIndex} button={button} />
            ))}
          </div>
        ))}
        {!previewQuery.data && !previewQuery.isError && <Skeleton className="h-24 w-full" />}
      </div>
      <p className="text-[11px] text-dark-500">{t('admin.botMenu.preview.note')}</p>
    </aside>
  );
}

function PreviewButton({ button }: { button: BotMenuPreviewButton }) {
  return (
    <div className="relative flex min-h-[36px] flex-1 items-center justify-center rounded-lg bg-[#2b5278]/60 px-2 py-1.5 text-center text-[12px] leading-tight text-white">
      <span className="line-clamp-2 break-words">{button.text}</span>
      {button.kind !== 'callback' && (
        <span className="absolute right-1 top-0.5 text-[9px] text-white/70" aria-hidden="true">
          ↗
        </span>
      )}
    </div>
  );
}
