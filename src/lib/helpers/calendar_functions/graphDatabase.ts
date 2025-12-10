// Database helper functions for Microsoft Graph calendar connections
import type {
  GraphCalendarConnection,
} from '@/types'
import { createClient } from '@/lib/helpers/server'

/**
 * Get calendar connection for a client
 */
export async function getCalendarConnectionByClientId(clientId: number): Promise<GraphCalendarConnection | null> {
  try {
    console.log(`Getting calendar connection for client ${clientId}`)
    
    const supabase = createClient()
    
    const { data, error } = await supabase
      .schema('lead_dialer')
      .from('calendar_connections')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_connected', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw error
    }
    
    return data as GraphCalendarConnection
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
