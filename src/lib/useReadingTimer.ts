import { useEffect } from 'react'
import { addReadingSeconds } from './db'

const TICK_SECONDS = 15
const IDLE_AFTER_MS = 2 * 60 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart']

/** Adds time to today's reading total while the page is visible and the reader isn't idle. */
export function useReadingTimer() {
  useEffect(() => {
    let lastActivity = Date.now()
    const markActive = () => {
      lastActivity = Date.now()
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }))

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity < IDLE_AFTER_MS) {
        addReadingSeconds(TICK_SECONDS)
      }
    }, TICK_SECONDS * 1000)

    return () => {
      window.clearInterval(timer)
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive))
    }
  }, [])
}
