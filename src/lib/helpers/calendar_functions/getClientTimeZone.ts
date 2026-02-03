import { createClient } from '@/lib/helpers/server'

/**
 * Retrieves the timezone for a specific client from the database
 * @param clientId - The ID of the client
 * @returns Promise<string | null> - The client's timezone or null if not found
 */
export async function getClientTimezone(clientId: number): Promise<string | null> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
    .schema("lead_dialer")
      .from('clients')
      .select('timezone')
      .eq('id', clientId)
      .single()
      
    console.log("getClientTimezone data", data);
    if (error) {
      console.error('Error fetching client timezone:', error)
      return null
    }

    return data?.timezone || null
  } catch (error) {
    console.error('Unexpected error in getClientTimezone:', error)
    return null
  }
}
