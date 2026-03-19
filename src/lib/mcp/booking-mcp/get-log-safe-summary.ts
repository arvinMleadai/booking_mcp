export function getLogSafeSummary (value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length }
  }
  const record = value as Record<string, unknown>
  const success = typeof record.success === 'boolean' ? record.success : undefined
  const code = typeof record.code === 'string' ? record.code : undefined
  const conflict = typeof record.conflict === 'boolean' ? record.conflict : undefined
  const message = typeof record.message === 'string' ? record.message : undefined
  const error = typeof record.error === 'string' ? record.error : undefined
  return { success, code, conflict, message, error }
}

