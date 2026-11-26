import { getRegionName, provinces, type UserLocation } from '../location.js'
import type { Locale, ModelSettings } from '../settings.js'
import { formatDate } from '../../utils/format.js'

/** 把「通用设置 → 位置」转成展示名；英文环境下国家显示为地区名。 */
export const locationName = (location: UserLocation | null, locale: Locale): string => {
  if (!location) {
    return ''
  }
  if (location.region === 'CN' && locale === 'zh-CN') {
    const province = provinces.find((item) => item.code === location.province)
    const city = province?.cities.find((item) => item.code === location.city)
    return city?.name ?? province?.name ?? getRegionName('CN', locale)
  }
  return getRegionName(location.region, locale)
}

/** 当前星期的本地化名称，日期与星期都使用浏览器本地时区。 */
export const weekdayName = (language: 'zh' | 'en', now = new Date()): string =>
  new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { weekday: 'long' }).format(now)

/**
 * latest_reminder 的五个字段：日期、星期、地点、客户端类型、语言。
 * 日期与星期可被用户覆盖，留空时自动取当天；地点留空时回退到通用设置里的位置。
 */
export const createLatestReminder = (
  settings: ModelSettings,
  location: UserLocation | null,
  locale: Locale,
  now = new Date()
): string => {
  const language: 'zh' | 'en' = locale === 'en-US' ? 'en' : 'zh'
  const date = settings.reminder.date?.trim() || formatDate(now, '-') || ''
  const weekday = settings.reminder.weekday?.trim() || weekdayName(language, now)
  return [date, weekday, locationName(location, locale), 'Web', language === 'en' ? 'English' : '中文'].join(',')
}
