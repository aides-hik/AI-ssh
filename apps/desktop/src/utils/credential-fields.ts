const secretFields = new Set([
  'password', 'privatekey', 'passphrase', 'apikey', 'token', 'accesstoken',
  'refreshtoken', 'secret', 'secretkey', 'clientsecret', 'secretaccesskey',
  'awssecretaccesskey', 'accesskeyid', 'authorization', 'proxyauthorization',
  'cookie', 'setcookie'
])

export function isCredentialField(key: string): boolean {
  return secretFields.has(key.replace(/[-_\s]/g, '').toLowerCase())
}

export function isCredentialHeaderContainer(key: string): boolean {
  return /headers$/i.test(key)
}

/** Portable configuration exports contain settings, never saved credentials. */
export function stripCredentials<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripCredentials) as T
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (isCredentialField(key)) return []
    // Custom header names are arbitrary, so their values cannot safely be
    // classified by name alone. Restore them explicitly after an import.
    if (isCredentialHeaderContainer(key)) return [[key, {}]]
    return [[key, stripCredentials(item)]]
  })) as T
}
