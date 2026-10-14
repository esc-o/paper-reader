const listeners = new Set<() => void>()
let mute = 0
let followUp = false

/** Local data changed and should be merged to the cloud if someone is signed in. */
export function notifyLocalChange() {
  if (mute > 0) {
    followUp = true
    return
  }
  for (const listener of listeners) listener()
}

/** A change arrived while a merge was running. One more sync should follow. */
export function consumeFollowUp(): boolean {
  const pending = followUp
  followUp = false
  return pending
}

export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Writes made while applying a cloud merge should not start another sync. */
export async function runSilently<T>(fn: () => Promise<T>): Promise<T> {
  mute++
  try {
    return await fn()
  } finally {
    mute--
  }
}

export const LIBRARY_EVENT = 'paper-reader-library'

export function notifyLibrary() {
  window.dispatchEvent(new Event(LIBRARY_EVENT))
}
