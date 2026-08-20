/**
 * Collapse legacy/adult age labels into summer-camp Group 1–4 buckets.
 * Mirrors DashboardReportHelper::mergeAgeGroupsIntoCampBuckets.
 * "0-10" is split evenly across Group 1 / 2 / 3 (remainder → Group 1, then 2).
 */

export const CAMP_AGE_GROUP_1 = 'Group 1: 4-5 years';
export const CAMP_AGE_GROUP_2 = 'Group 2: 6-7 years';
export const CAMP_AGE_GROUP_3 = 'Group 3: 8-10 years';
export const CAMP_AGE_GROUP_4 = 'Group 4: 11+ years';

export const CAMP_AGE_GROUPS = [
  CAMP_AGE_GROUP_1,
  CAMP_AGE_GROUP_2,
  CAMP_AGE_GROUP_3,
  CAMP_AGE_GROUP_4,
] as const;

export type CampAgeGroup = (typeof CAMP_AGE_GROUPS)[number];

/** Ambiguous child band — must be split at aggregate time, not per-order. */
export const AMBIGUOUS_CHILD_AGE_GROUP = '0-10';

const DIRECT_MAP: Record<string, CampAgeGroup> = {
  [CAMP_AGE_GROUP_1]: CAMP_AGE_GROUP_1,
  [CAMP_AGE_GROUP_2]: CAMP_AGE_GROUP_2,
  [CAMP_AGE_GROUP_3]: CAMP_AGE_GROUP_3,
  [CAMP_AGE_GROUP_4]: CAMP_AGE_GROUP_4,
  '4-5 years': CAMP_AGE_GROUP_1,
  '6-7 years': CAMP_AGE_GROUP_2,
  '8-10 years': CAMP_AGE_GROUP_3,
  '11+ years': CAMP_AGE_GROUP_4,
  '0-5': CAMP_AGE_GROUP_1,
  '6-10': CAMP_AGE_GROUP_3,
  '11-15': CAMP_AGE_GROUP_4,
  '11-18': CAMP_AGE_GROUP_4,
  '16-20': CAMP_AGE_GROUP_4,
  '19-25': CAMP_AGE_GROUP_4,
  '21-30': CAMP_AGE_GROUP_4,
  '25-40': CAMP_AGE_GROUP_4,
  '31-50': CAMP_AGE_GROUP_4,
  '40-50+': CAMP_AGE_GROUP_4,
  '40-50': CAMP_AGE_GROUP_4,
  '51-75': CAMP_AGE_GROUP_4,
};

/**
 * Map a raw users.age_group value for storage on orders / rollup keys.
 * Leaves "0-10" unchanged so aggregate split can run later.
 * Empty/null matches legacy COALESCE(..., "25-40") → Group 4.
 */
export function normalizeCustomerAgeGroup(
  raw: string | null | undefined,
): string {
  const label = (raw ?? '').trim() || '25-40';
  if (label === AMBIGUOUS_CHILD_AGE_GROUP) return AMBIGUOUS_CHILD_AGE_GROUP;
  return DIRECT_MAP[label] ?? CAMP_AGE_GROUP_4;
}

export type AgeGroupMetricRow = {
  label: string;
  admits: number;
  orders: number;
  revenue: number;
};

/**
 * Merge arbitrary age labels into the four camp buckets (fixed order, always 4 rows).
 */
export function mergeAgeGroupsIntoCampBuckets(
  rows: AgeGroupMetricRow[],
): AgeGroupMetricRow[] {
  const totals: Record<
    CampAgeGroup,
    { admits: number; orders: number; revenue: number }
  > = {
    [CAMP_AGE_GROUP_1]: { admits: 0, orders: 0, revenue: 0 },
    [CAMP_AGE_GROUP_2]: { admits: 0, orders: 0, revenue: 0 },
    [CAMP_AGE_GROUP_3]: { admits: 0, orders: 0, revenue: 0 },
    [CAMP_AGE_GROUP_4]: { admits: 0, orders: 0, revenue: 0 },
  };

  const add = (
    target: CampAgeGroup,
    admits: number,
    orders: number,
    revenue: number,
  ) => {
    totals[target].admits += admits;
    totals[target].orders += orders;
    totals[target].revenue += revenue;
  };

  for (const row of rows) {
    const label = (row.label ?? '').trim();
    const admits = Number(row.admits) || 0;
    const orders = Number(row.orders) || 0;
    const revenue = Number(row.revenue) || 0;
    if (admits <= 0 && orders <= 0 && revenue === 0) continue;

    if (label === AMBIGUOUS_CHILD_AGE_GROUP) {
      const shareA = Math.floor(admits / 3);
      const remA = admits % 3;
      const shareO = Math.floor(orders / 3);
      const remO = orders % 3;
      const shareR = revenue / 3;
      add(
        CAMP_AGE_GROUP_1,
        shareA + (remA > 0 ? 1 : 0),
        shareO + (remO > 0 ? 1 : 0),
        shareR,
      );
      add(
        CAMP_AGE_GROUP_2,
        shareA + (remA > 1 ? 1 : 0),
        shareO + (remO > 1 ? 1 : 0),
        shareR,
      );
      add(CAMP_AGE_GROUP_3, shareA, shareO, shareR);
      continue;
    }

    const target = DIRECT_MAP[label] ?? CAMP_AGE_GROUP_4;
    add(target, admits, orders, revenue);
  }

  return CAMP_AGE_GROUPS.map((label) => ({
    label,
    admits: totals[label].admits,
    orders: totals[label].orders,
    revenue: Math.round((totals[label].revenue + Number.EPSILON) * 1000) / 1000,
  }));
}
