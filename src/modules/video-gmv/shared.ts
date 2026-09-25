'use client'

import { useReport } from '@/modules/analytics/context'
import type { VideoGmvData } from './types'

/** The module's answer, for its widgets. */
export const useVideoGmv = () => useReport<VideoGmvData>()
