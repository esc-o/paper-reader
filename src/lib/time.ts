import i18n from '../i18n'

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar date as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** Monday through Sunday of the current week. */
export function currentWeek(today = new Date()): Date[] {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return day
  })
}

export function formatLastRead(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  if (dayKey(date) === dayKey(now)) return i18n.t('time.today', { time })
  if (dayKey(date) === dayKey(yesterday)) return i18n.t('time.yesterday', { time })
  if (date.getFullYear() === now.getFullYear()) {
    return i18n.t('time.sameYear', { month: date.getMonth() + 1, day: date.getDate(), time })
  }
  return i18n.t('time.full', { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), time })
}
