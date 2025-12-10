// Database helper functions for Microsoft Graph calendar connections
import type {
  GraphCalendarConnection,
} from '@/types'
import { createClient } from '@/lib/helpers/server'

/**
 * Validate if token is from Microsoft (not Google)
 * Microsoft tokens don't start with 'ya29.' (Google's prefix)
 */
function isMicrosoftToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false
  }
  
  // Google tokens typically start with 'ya29.' or '1//'
  // Microsoft tokens have different formats
  const googleTokenPrefixes = ['ya29.', '1//']
  const isGoogleToken = googleTokenPrefixes.some(prefix => token.startsWith(prefix))
  
  return !isGoogleToken
}

/**
 * Get calendar connection for a specific agent
 * Uses agent_calendar_assignments to get the correct calendar
 */
export async function getCalendarConnectionByAgentId(
  agentId: string,
  clientId: number,
  requiredProvider?: 'microsoft' | 'google'
): Promise<GraphCalendarConnection | null> {
  try {
    console.log(`Getting calendar connection for agent ${agentId} (client ${clientId})`)
    
    const supabase = createClient()
    
    // Step 1: Get agent's calendar assignment
    const { data: assignment, error: assignmentError } = await supabase
      .schema('public')
      .from('agent_calendar_assignments')
      .select('calendar_id')
      .eq('agent_id', agentId)
      .is('deleted_at', null)
      .single()
    
    if (assignmentError || !assignment) {
      console.error(`No calendar assignment found for agent ${agentId}`)
      return null
    }
    
    // Step 2: Get the calendar connection using the assignment's calendar_id
    const { data: connection, error: connectionError } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .select('*')
      .eq('id', assignment.calendar_id)
      .eq('client_id', clientId)
      .eq('is_connected', true)
      .single()
    
    if (connectionError || !connection) {
      console.error(`Calendar connection not found for agent ${agentId}`)
      return null
    }
    
    const calendarConnection = connection as GraphCalendarConnection
    
    // Step 3: Validate provider if required
    if (requiredProvider) {
      if (calendarConnection.provider_name !== requiredProvider) {
        console.error(`❌ Provider mismatch: Expected ${requiredProvider}, got ${calendarConnection.provider_name}`)
        console.error(`Agent ${agentId} has a ${calendarConnection.provider_name} calendar, but ${requiredProvider} is required.`)
        return null
      }
    }
    
    // Step 4: Validate token provider matches calendar provider
    // Note: Google tokens are NOT JWT format (they're just strings like "ya29.xxx")
    // Only Microsoft tokens are JWT format (3 parts separated by dots)
    if (calendarConnection.access_token) {
      if (calendarConnection.provider_name === 'microsoft') {
        // Microsoft tokens must be JWT format (3 parts)
        const tokenParts = calendarConnection.access_token.split('.')
        if (tokenParts.length !== 3) {
          console.error(`❌ TOKEN PROVIDER MISMATCH: Calendar is Microsoft but token is not JWT format`)
          console.error(`Token has ${tokenParts.length} parts (expected 3 for JWT). Token preview: ${calendarConnection.access_token.substring(0, 30)}...`)
          return null
        }
        
        // Check if it's actually a Google token (wrong provider)
        const isGoogleToken = calendarConnection.access_token.startsWith('ya29.') || calendarConnection.access_token.startsWith('1//')
        if (isGoogleToken) {
          console.error(`❌ TOKEN PROVIDER MISMATCH: Calendar is Microsoft but token is Google format (ya29. or 1//)`)
          console.error(`Token preview: ${calendarConnection.access_token.substring(0, 50)}...`)
          return null
        }
      } else if (calendarConnection.provider_name === 'google') {
        // Google tokens are NOT JWT - they're just strings
        // Check if it's actually a Microsoft JWT token (wrong provider)
        const tokenParts = calendarConnection.access_token.split('.')
        const isMicrosoftJWT = tokenParts.length === 3 && !calendarConnection.access_token.startsWith('ya29.') && !calendarConnection.access_token.startsWith('1//')
        if (isMicrosoftJWT) {
          console.error(`❌ TOKEN PROVIDER MISMATCH: Calendar is Google but token appears to be Microsoft JWT format`)
          return null
        }
      }
    }
    
    console.log(`✅ Found ${calendarConnection.provider_name} calendar connection for agent ${agentId}`)
    return calendarConnection
  } catch (error) {
    console.error('Error getting calendar connection by agent ID:', error)
    return null
  }
}

/**
 * Get calendar connection for a client (fallback - gets first Microsoft connection)
 * For agent-specific operations, use getCalendarConnectionByAgentId instead
 */
export async function getCalendarConnectionByClientId(
  clientId: number,
  preferredProvider?: 'microsoft' | 'google'
): Promise<GraphCalendarConnection | null> {
  try {
    console.log(`Getting calendar connection for client ${clientId}${preferredProvider ? ` (preferred: ${preferredProvider})` : ''}`)
    
    const supabase = createClient()
    
    let query = supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_connected', true)
    
    // If preferred provider specified, filter by it
    if (preferredProvider) {
      query = query.eq('provider_name', preferredProvider)
    }
    
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw error
    }
    
    if (!data) {
      return null
    }
    
    const connection = data as GraphCalendarConnection
    
    // Validate token provider matches calendar provider
    // Note: Google tokens are NOT JWT format - only Microsoft tokens are JWT
    if (connection && connection.access_token) {
      if (connection.provider_name === 'microsoft') {
        // Microsoft tokens must be JWT format (3 parts)
        const tokenParts = connection.access_token.split('.')
        if (tokenParts.length !== 3) {
          console.error(`❌ TOKEN PROVIDER MISMATCH: Calendar is Microsoft but token is not JWT format`)
          console.error(`Token has ${tokenParts.length} parts (expected 3 for JWT). Token preview: ${connection.access_token.substring(0, 30)}...`)
          return null
        }
        
        // Check if it's actually a Google token (wrong provider)
        const isGoogleToken = connection.access_token.startsWith('ya29.') || connection.access_token.startsWith('1//')
        if (isGoogleToken) {
          console.error(`❌ TOKEN PROVIDER MISMATCH: Calendar is Microsoft but token is Google format`)
          console.error(`Token preview: ${connection.access_token.substring(0, 50)}...`)
          return null
        }
      } else if (connection.provider_name === 'google') {
        // Google tokens are NOT JWT - they're just strings like "ya29.xxx"
        // Check if it's actually a Microsoft JWT token (wrong provider)
        const tokenParts = connection.access_token.split('.')
        const isMicrosoftJWT = tokenParts.length === 3 && !connection.access_token.startsWith('ya29.') && !connection.access_token.startsWith('1//')
        if (isMicrosoftJWT) {
          console.error(`❌ TOKEN PROVIDER MISMATCH: Calendar is Google but token appears to be Microsoft JWT format`)
          return null
        }
      }
    }
    
    return connection
  } catch (error) {
    console.error('Error getting calendar connection:', error)
    return null
  }
}

/**
 * Get all calendar connections for a client
 */
export async function getCalendarConnectionsByClientId(clientId: number): Promise<GraphCalendarConnection[]> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    
    if (error) {
      throw error
    }
    
    return (data || []) as GraphCalendarConnection[]
  } catch (error) {
    console.error('Error getting calendar connections:', error)
    return []
  }
}

/**
 * Create a new calendar connection
 */
export async function createCalendarConnection(connection: Omit<GraphCalendarConnection, 'id' | 'created_at' | 'updated_at'>): Promise<GraphCalendarConnection | null> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .insert({
        client_id: connection.client_id,
        user_id: connection.user_id,
        provider_id: connection.provider_id,
        provider_name: connection.provider_name,
        provider_user_id: connection.provider_user_id,
        email: connection.email,
        display_name: connection.display_name,
        access_token: connection.access_token,
        refresh_token: connection.refresh_token,
        token_type: connection.token_type,
        expires_at: connection.expires_at,
        calendars: connection.calendars,
        is_connected: connection.is_connected,
        sync_status: connection.sync_status,
        provider_metadata: connection.provider_metadata,
      })
      .select()
      .single()
    
    if (error) {
      throw error
    }
    
    return data as GraphCalendarConnection
  } catch (error) {
    console.error('Error creating calendar connection:', error)
    return null
  }
}

/**
 * Update calendar connection tokens
 */
export async function updateCalendarConnectionTokens(
  connectionId: string,
  tokens: {
    access_token: string
    refresh_token?: string
    expires_at: string
  }
): Promise<boolean> {
  try {
    const supabase = createClient()
    
    const updateData: {
      access_token: string
      expires_at: string
      updated_at: string
      refresh_token?: string
    } = {
      access_token: tokens.access_token,
      expires_at: tokens.expires_at,
      updated_at: new Date().toISOString(),
    }
    
    if (tokens.refresh_token) {
      updateData.refresh_token = tokens.refresh_token
    }
    
    const { error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .update(updateData)
      .eq('id', connectionId)
    
    if (error) {
      throw error
    }
    
    return true
  } catch (error) {
    console.error('Error updating calendar connection tokens:', error)
    return false
  }
}

/**
 * Update calendar connection calendars
 */
export async function updateCalendarConnectionCalendars(
  connectionId: string,
  calendars: unknown[],
  syncStatus: 'pending' | 'syncing' | 'completed' | 'error' = 'completed'
): Promise<boolean> {
  try {
    const supabase = createClient()
    
    const { error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .update({
        calendars,
        sync_status: syncStatus,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId)
    
    if (error) {
      throw error
    }
    
    return true
  } catch (error) {
    console.error('Error updating calendar connection calendars:', error)
    return false
  }
}

/**
 * Update calendar connection sync status
 */
export async function updateCalendarConnectionSyncStatus(
  connectionId: string,
  syncStatus: 'pending' | 'syncing' | 'completed' | 'error',
  syncError?: string
): Promise<boolean> {
  try {
    const supabase = createClient()
    
    const updateData: {
      sync_status: string
      sync_error?: string | null
      last_sync_at?: string
      updated_at: string
    } = {
      sync_status: syncStatus,
      sync_error: syncError || null,
      updated_at: new Date().toISOString(),
    }
    
    if (syncStatus === 'completed') {
      updateData.last_sync_at = new Date().toISOString()
    }
    
    const { error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .update(updateData)
      .eq('id', connectionId)
    
    if (error) {
      throw error
    }
    
    return true
  } catch (error) {
    console.error('Error updating calendar connection sync status:', error)
    return false
  }
}

/**
 * Disconnect calendar connection
 */
export async function disconnectCalendarConnection(connectionId: string): Promise<boolean> {
  try {
    const supabase = createClient()
    
    const { error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .update({
        is_connected: false,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId)
    
    if (error) {
      throw error
    }
    
    return true
  } catch (error) {
    console.error('Error disconnecting calendar connection:', error)
    return false
  }
}


/**
 * Get calendar connection summary for a client
 */
export async function getCalendarConnectionSummary(clientId: number): Promise<{
  has_active_connections: boolean
  total_connections: number
  connected_connections: number
  microsoft_connections: number
  google_connections: number
  primary_connection?: {
    email: string
    provider_name: string
    display_name: string
  }
} | null> {
  try {
    const supabase = createClient()
    
    // Get all connections for the client
    const { data: connections, error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .select('provider_name, is_connected, email, display_name, created_at')
      .eq('client_id', clientId)
    
    if (error) {
      throw error
    }
    
    const allConnections = connections || []
    const totalConnections = allConnections.length
    const connectedConnections = allConnections.filter(c => c.is_connected).length
    const microsoftConnections = allConnections.filter(c => c.provider_name === 'microsoft' && c.is_connected).length
    const googleConnections = allConnections.filter(c => c.provider_name === 'google' && c.is_connected).length
    
    // Get primary connection (oldest connected one)
    const primaryConnection = allConnections
      .filter(c => c.is_connected)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
    
    return {
      has_active_connections: connectedConnections > 0,
      total_connections: totalConnections,
      connected_connections: connectedConnections,
      microsoft_connections: microsoftConnections,
      google_connections: googleConnections,
      primary_connection: primaryConnection ? {
        email: primaryConnection.email,
        provider_name: primaryConnection.provider_name,
        display_name: primaryConnection.display_name,
      } : undefined,
    }
  } catch (error) {
    console.error('Error getting calendar connection summary:', error)
    return null
  }
}
