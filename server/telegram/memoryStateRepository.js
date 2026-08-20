function cloneValue(value) {
  if (value === undefined) return undefined
  return structuredClone(value)
}

function normalizedEntries(initialEntries) {
  if (initialEntries instanceof Map) return initialEntries.entries()
  if (Array.isArray(initialEntries)) return initialEntries
  if (initialEntries && typeof initialEntries === 'object') return Object.entries(initialEntries)
  throw new TypeError('Memory state repository entries must be a Map, array, or object.')
}

export function createMemoryStateRepository(initialEntries = []) {
  const records = new Map()
  for (const [key, value] of normalizedEntries(initialEntries)) {
    records.set(String(key), cloneValue(value))
  }

  return {
    async get(key) {
      return records.has(key) ? cloneValue(records.get(key)) : null
    },

    async set(key, value) {
      records.set(key, cloneValue(value))
    },

    async delete(key) {
      return records.delete(key)
    },

    async setIfAbsent(key, value) {
      if (records.has(key)) return false
      records.set(key, cloneValue(value))
      return true
    },
  }
}
