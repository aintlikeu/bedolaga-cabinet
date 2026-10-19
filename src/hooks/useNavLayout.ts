import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ALWAYS_VISIBLE_NAV,
  NAV_ITEM_IDS,
  NAV_LAYOUT_QUERY_KEY,
  navigationApi,
  type NavItemId,
  type NavLayout,
} from '@/api/navigation';
import { safeLocal } from '@/utils/safeStorage';

// Последняя известная раскладка: без неё скрытые пункты мелькали бы на каждом
// холодном старте, пока не придёт ответ (как с флагами в useFeatureFlags).
const NAV_LAYOUT_CACHE_KEY = 'cabinet-nav-layout';

/** Позиция пункта в раскладке; пункты, которых раскладка не знает, — в конце. */
function orderIndex(layout: NavLayout | undefined, id: string): number {
  const index = layout?.items.findIndex((item) => item.id === id) ?? -1;
  return index === -1 ? NAV_ITEM_IDS.length : index;
}

/** Виден ли пункт; обязательные пункты видны всегда, пока раскладки нет — тоже. */
export function isNavItemVisible(layout: NavLayout | undefined, id: NavItemId): boolean {
  if (ALWAYS_VISIBLE_NAV.has(id)) return true;
  return layout?.items.find((item) => item.id === id)?.visible ?? true;
}

/**
 * Отфильтровать и упорядочить пункты навигации по раскладке.
 * Сортировка стабильная: при равных позициях сохраняется исходный порядок.
 */
export function applyNavLayout<T extends { navId: NavItemId }>(
  items: readonly T[],
  layout: NavLayout | undefined,
): T[] {
  return items
    .filter((item) => isNavItemVisible(layout, item.navId))
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        orderIndex(layout, a.item.navId) - orderIndex(layout, b.item.navId) || a.index - b.index,
    )
    .map(({ item }) => item);
}

export function useNavLayout(): NavLayout | undefined {
  const { data } = useQuery({
    queryKey: NAV_LAYOUT_QUERY_KEY,
    queryFn: navigationApi.getLayout,
    staleTime: 60000,
    retry: false,
  });

  useEffect(() => {
    if (data) safeLocal.setJson(NAV_LAYOUT_CACHE_KEY, data);
  }, [data]);

  if (data) return data;
  const cached = safeLocal.getJson<unknown>(NAV_LAYOUT_CACHE_KEY, undefined);
  // Кэш мог испортиться или остаться от другой версии — берём только узнаваемую форму.
  return isNavLayout(cached) ? cached : undefined;
}

function isNavLayout(value: unknown): value is NavLayout {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as NavLayout).items) &&
    (value as NavLayout).items.every(
      (item) => typeof item?.id === 'string' && typeof item?.visible === 'boolean',
    )
  );
}
