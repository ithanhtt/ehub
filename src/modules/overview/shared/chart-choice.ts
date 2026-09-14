import { acceptTableSort, type TableSort } from '@/components/charts/chart-card'
import { usePreference } from '@/components/ui/use-preference'

/** A trend card's choices: chart or table, the table's order, the series switched off, the comparison line. */
export type ChartChoice = { view: 'chart' | 'table'; sort: TableSort | null; hidden: string[]; compare: boolean }

const CHART_DEFAULT: ChartChoice = { view: 'chart', sort: null, hidden: [], compare: false }

function acceptChart(value: unknown): ChartChoice | null {
  if (!value || typeof value !== 'object') return null
  const { view, sort, hidden, compare } = value as Record<string, unknown>
  return {
    view: view === 'table' ? 'table' : 'chart',
    sort: acceptTableSort(sort),
    hidden: Array.isArray(hidden) ? hidden.filter((key): key is string => typeof key === 'string') : [],
    compare: compare === true,
  }
}

/** A trend card's choices, remembered under `key` (see usePreference) and shared by the card and its dialog. */
export function useChartChoice(key: string) {
  return usePreference<ChartChoice>(key, CHART_DEFAULT, acceptChart)
}
