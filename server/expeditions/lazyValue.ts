export type LazyValue<T> = {
  peek(): T | undefined
  initCount(): number
  ensure(): Promise<T>
}

export function createLazyValue<T>(factory: () => T | Promise<T>): LazyValue<T> {
  let value: T | undefined
  let resolved = false
  let inflight: Promise<T> | undefined
  let count = 0

  return {
    peek() {
      return resolved ? value : undefined
    },
    initCount() {
      return count
    },
    ensure() {
      if (inflight) return inflight
      inflight = Promise.resolve()
        .then(() => {
          count += 1
          return factory()
        })
        .then(result => {
          value = result
          resolved = true
          return result
        })
        .catch(error => {
          inflight = undefined
          throw error
        })
      return inflight
    },
  }
}
