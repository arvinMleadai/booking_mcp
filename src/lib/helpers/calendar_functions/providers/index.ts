// Calendar Provider exports
export * from './types'
export { MicrosoftCalendarProvider } from './microsoft-provider'
export { GoogleCalendarProvider } from './google-provider'

// Provider registry
import { MicrosoftCalendarProvider } from './microsoft-provider'
import { GoogleCalendarProvider } from './google-provider'
import type { CalendarProvider } from './types'
import type { GraphCalendarConnection } from '@/types'

const providers: CalendarProvider[] = [
  new MicrosoftCalendarProvider(),
  new GoogleCalendarProvider(),
]

/**
 * Get the appropriate provider for a calendar connection
 */
export function getProviderForConnection(connection: GraphCalendarConnection): CalendarProvider | null {
  return providers.find(p => p.canHandle(connection)) || null
}

/**
 * Get provider by name
 */
export function getProviderByName(name: string): CalendarProvider | null {
  return providers.find(p => p.name === name) || null
}

