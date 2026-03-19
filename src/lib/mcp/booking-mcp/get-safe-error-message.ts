export function getSafeErrorMessage (error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }
  return 'Unknown error'
}

