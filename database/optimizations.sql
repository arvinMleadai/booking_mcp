-- Database optimization scripts for Calendar MCP
-- These indexes and optimizations will significantly improve query performance

-- =====================================================
-- CALENDAR CONNECTIONS OPTIMIZATIONS
-- =====================================================

-- Index for active calendar connections by client
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_connections_client_active 
ON lead_dialer.calendar_connections(client_id, is_connected) 
WHERE is_connected = true;

-- Index for calendar connection lookups by provider
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_connections_provider 
ON lead_dialer.calendar_connections(provider_name, provider_id);

-- Index for token expiration checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_connections_expires_at 
ON lead_dialer.calendar_connections(expires_at) 
WHERE expires_at IS NOT NULL;

-- Composite index for connection queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_connections_composite 
ON lead_dialer.calendar_connections(client_id, is_connected, created_at DESC);

-- =====================================================
-- CLIENTS OPTIMIZATIONS
-- =====================================================

-- Index for client timezone lookups (frequently accessed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_timezone 
ON lead_dialer.clients(id, timezone) 
WHERE timezone IS NOT NULL;

-- =====================================================
-- AGENTS OPTIMIZATIONS
-- =====================================================

-- Index for agent profile lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_profile_id 
ON lead_dialer.agents(profile_id) 
WHERE profile_id IS NOT NULL;

-- Index for active agents by client
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agents_client_active 
ON lead_dialer.agents(client_id, is_active) 
WHERE is_active = true;

-- =====================================================
-- PROFILES OPTIMIZATIONS
-- =====================================================

-- Index for profile office hours queries (JSON optimization)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_office_hours_gin 
ON lead_dialer.profiles USING GIN (office_hours) 
WHERE office_hours IS NOT NULL;

-- Index for profile timezone lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_timezone 
ON lead_dialer.profiles(timezone) 
WHERE timezone IS NOT NULL;

-- Index for primary profiles by client
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_client_primary 
ON lead_dialer.profiles(client_id, is_primary) 
WHERE is_primary = true;

-- =====================================================
-- AGENT CALENDAR ASSIGNMENTS OPTIMIZATIONS
-- =====================================================

-- Index for calendar assignment lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_calendar_assignments_connection 
ON lead_dialer.agent_calendar_assignments(calendar_connection_id, client_id);

-- Index for agent assignment lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_calendar_assignments_agent 
ON lead_dialer.agent_calendar_assignments(agent_id, client_id);

-- Composite index for assignment queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_calendar_assignments_composite 
ON lead_dialer.agent_calendar_assignments(client_id, agent_id, calendar_connection_id);

-- =====================================================
-- CUSTOMERS OPTIMIZATIONS
-- =====================================================

-- Index for active customers by client (for fuzzy search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_client_active 
ON lead_dialer.customers(client_id, is_active) 
WHERE is_active = true;

-- Full-text search index for customer names
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_name_search 
ON lead_dialer.customers USING GIN (
  to_tsvector('english', COALESCE(full_name, '') || ' ' || COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
) WHERE is_active = true;

-- Index for email lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_email_active 
ON lead_dialer.customers(email, client_id) 
WHERE is_active = true AND email IS NOT NULL;

-- =====================================================
-- QUERY OPTIMIZATION FUNCTIONS
-- =====================================================

-- Function to get client calendar data with all related info in one query
CREATE OR REPLACE FUNCTION lead_dialer.get_client_calendar_data_optimized(p_client_id BIGINT)
RETURNS TABLE (
  -- Connection data
  connection_id UUID,
  provider_name VARCHAR,
  provider_id VARCHAR,
  email VARCHAR,
  display_name VARCHAR,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_connected BOOLEAN,
  connection_created_at TIMESTAMP WITH TIME ZONE,
  connection_updated_at TIMESTAMP WITH TIME ZONE,
  
  -- Client data
  client_timezone VARCHAR,
  
  -- Agent data
  agent_id BIGINT,
  agent_name VARCHAR,
  agent_office_hours JSONB,
  agent_timezone VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    -- Connection data
    cc.id as connection_id,
    cc.provider_name,
    cc.provider_id,
    cc.email,
    cc.display_name,
    cc.access_token,
    cc.refresh_token,
    cc.expires_at,
    cc.is_connected,
    cc.created_at as connection_created_at,
    cc.updated_at as connection_updated_at,
    
    -- Client data
    c.timezone as client_timezone,
    
    -- Agent data
    a.id as agent_id,
    a.name as agent_name,
    p.office_hours as agent_office_hours,
    p.timezone as agent_timezone
  FROM lead_dialer.calendar_connections cc
  INNER JOIN lead_dialer.clients c ON cc.client_id = c.id
  LEFT JOIN lead_dialer.agent_calendar_assignments aca ON cc.id = aca.calendar_connection_id
  LEFT JOIN lead_dialer.agents a ON aca.agent_id = a.id AND a.is_active = true
  LEFT JOIN lead_dialer.profiles p ON a.profile_id = p.id
  WHERE cc.client_id = p_client_id 
    AND cc.is_connected = true
  ORDER BY cc.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function for optimized customer fuzzy search
CREATE OR REPLACE FUNCTION lead_dialer.search_customers_fuzzy_optimized(
  p_client_id BIGINT,
  p_search_term VARCHAR,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id BIGINT,
  full_name VARCHAR,
  first_name VARCHAR,
  last_name VARCHAR,
  email VARCHAR,
  phone_number VARCHAR,
  company VARCHAR,
  job_title VARCHAR,
  similarity_score REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.full_name,
    c.first_name,
    c.last_name,
    c.email,
    c.phone_number,
    c.company,
    c.job_title,
    GREATEST(
      similarity(COALESCE(c.full_name, ''), p_search_term),
      similarity(COALESCE(c.first_name || ' ' || c.last_name, ''), p_search_term),
      similarity(COALESCE(c.email, ''), p_search_term),
      similarity(COALESCE(c.company, ''), p_search_term)
    ) as similarity_score
  FROM lead_dialer.customers c
  WHERE c.client_id = p_client_id 
    AND c.is_active = true
    AND (
      c.full_name ILIKE '%' || p_search_term || '%' OR
      c.first_name ILIKE '%' || p_search_term || '%' OR
      c.last_name ILIKE '%' || p_search_term || '%' OR
      c.email ILIKE '%' || p_search_term || '%' OR
      c.company ILIKE '%' || p_search_term || '%' OR
      to_tsvector('english', COALESCE(c.full_name, '') || ' ' || COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) @@ plainto_tsquery('english', p_search_term)
    )
  ORDER BY similarity_score DESC, c.full_name
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- PERFORMANCE MONITORING VIEWS
-- =====================================================

-- View for monitoring calendar connection health
CREATE OR REPLACE VIEW lead_dialer.v_calendar_connection_health AS
SELECT 
  cc.client_id,
  COUNT(*) as total_connections,
  COUNT(*) FILTER (WHERE cc.is_connected = true) as active_connections,
  COUNT(*) FILTER (WHERE cc.provider_name = 'microsoft') as microsoft_connections,
  COUNT(*) FILTER (WHERE cc.expires_at < NOW() + INTERVAL '1 hour') as expiring_soon,
  COUNT(*) FILTER (WHERE cc.expires_at < NOW()) as expired_tokens,
  MAX(cc.updated_at) as last_activity
FROM lead_dialer.calendar_connections cc
GROUP BY cc.client_id;

-- View for monitoring agent assignments
CREATE OR REPLACE VIEW lead_dialer.v_agent_assignment_summary AS
SELECT 
  aca.client_id,
  COUNT(DISTINCT aca.agent_id) as assigned_agents,
  COUNT(DISTINCT aca.calendar_connection_id) as assigned_connections,
  COUNT(*) FILTER (WHERE a.is_active = true) as active_assignments,
  COUNT(*) FILTER (WHERE p.office_hours IS NOT NULL) as agents_with_office_hours
FROM lead_dialer.agent_calendar_assignments aca
LEFT JOIN lead_dialer.agents a ON aca.agent_id = a.id
LEFT JOIN lead_dialer.profiles p ON a.profile_id = p.id
GROUP BY aca.client_id;

-- =====================================================
-- MAINTENANCE PROCEDURES
-- =====================================================

-- Procedure to clean up expired tokens
CREATE OR REPLACE FUNCTION lead_dialer.cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  cleanup_count INTEGER;
BEGIN
  -- Mark connections with expired tokens as disconnected
  UPDATE lead_dialer.calendar_connections 
  SET is_connected = false, 
      updated_at = NOW()
  WHERE expires_at < NOW() - INTERVAL '1 day'
    AND is_connected = true;
  
  GET DIAGNOSTICS cleanup_count = ROW_COUNT;
  
  -- Log the cleanup
  INSERT INTO lead_dialer.system_logs (level, message, metadata, created_at)
  VALUES ('INFO', 'Cleaned up expired calendar tokens', 
          jsonb_build_object('cleaned_count', cleanup_count), NOW());
  
  RETURN cleanup_count;
END;
$$ LANGUAGE plpgsql;

-- Procedure to update connection statistics
CREATE OR REPLACE FUNCTION lead_dialer.update_connection_stats()
RETURNS VOID AS $$
BEGIN
  -- This could update a stats table for monitoring
  -- For now, just refresh materialized views if any exist
  
  -- Log the stats update
  INSERT INTO lead_dialer.system_logs (level, message, created_at)
  VALUES ('INFO', 'Updated calendar connection statistics', NOW());
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PERFORMANCE ANALYSIS QUERIES
-- =====================================================

-- Query to analyze slow queries (requires pg_stat_statements extension)
/*
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows,
  100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements 
WHERE query LIKE '%calendar_connections%' 
   OR query LIKE '%agents%'
   OR query LIKE '%profiles%'
ORDER BY mean_time DESC 
LIMIT 10;
*/

-- Query to check index usage
/*
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_tup_read,
  idx_tup_fetch,
  idx_scan
FROM pg_stat_user_indexes 
WHERE schemaname = 'lead_dialer'
  AND (tablename LIKE '%calendar%' OR tablename IN ('agents', 'profiles', 'customers'))
ORDER BY idx_scan DESC;
*/

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON FUNCTION lead_dialer.get_client_calendar_data_optimized(BIGINT) IS 
'Optimized function to fetch all client calendar data in a single query, reducing database round trips';

COMMENT ON FUNCTION lead_dialer.search_customers_fuzzy_optimized(BIGINT, VARCHAR, INTEGER) IS 
'Optimized fuzzy search for customers using full-text search and similarity scoring';

COMMENT ON VIEW lead_dialer.v_calendar_connection_health IS 
'Monitoring view for calendar connection health and token expiration status';

COMMENT ON VIEW lead_dialer.v_agent_assignment_summary IS 
'Summary view for agent calendar assignments and office hours configuration';

-- =====================================================
-- GRANTS (adjust as needed for your security model)
-- =====================================================

-- Grant execute permissions on functions to appropriate roles
-- GRANT EXECUTE ON FUNCTION lead_dialer.get_client_calendar_data_optimized(BIGINT) TO calendar_service_role;
-- GRANT EXECUTE ON FUNCTION lead_dialer.search_customers_fuzzy_optimized(BIGINT, VARCHAR, INTEGER) TO calendar_service_role;

-- Grant select permissions on views
-- GRANT SELECT ON lead_dialer.v_calendar_connection_health TO monitoring_role;
-- GRANT SELECT ON lead_dialer.v_agent_assignment_summary TO monitoring_role;
