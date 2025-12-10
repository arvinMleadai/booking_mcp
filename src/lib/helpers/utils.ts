import { createClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";

/**
 * Search for a customer by name using fuzzy search in the customer database
 * Used for booking appointments when customer name is provided
 */
export const getCustomerWithFuzzySearch = async (
  name: string,
  clientId: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // TODO: replace created_by with client_id
  const { data: customers } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select("id, full_name, phone_number, email, pipeline_stage_id, company")
    .eq("created_by", clientId);

  const fuse = new Fuse(customers || [], {
    keys: ["full_name"], // fields to search
    threshold: 0.5, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  return fuse.search(name);
};

/**
 * Search for a contact by name using fuzzy search in the contacts table
 * Used for booking appointments when contact is not in customer database
 */
export const getContactWithFuzzySearch = async (
  name: string,
  clientId: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, name, first_name, middle_name, last_name, phone_number, email, company")
    .eq("client_id", clientId)
    .is("deleted_at", null);

  if (error) {
    console.error("Error fetching contacts:", error);
    return [];
  }

  const fuse = new Fuse(contacts || [], {
    keys: [
      "name", // Main name field
      "first_name",
      "last_name",
    ],
    threshold: 0.4, // Slightly stricter than customer search (0 = exact, 1 = very fuzzy)
  });
  
  return fuse.search(name);
};

/**
 * Get agent assigned to a calendar connection
 */
export const getAgentByCalendarConnection = async (
  calendarConnectionId: string,
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: assignment, error } = await supabase
    .schema("public")
    .from("agent_calendar_assignments")
    .select(
      `
      agent_id,
      calendar_id,
      agents!agent_id (
        uuid,
        name,
        profile_id,
        client_id,
        profiles (
          id,
          name,
          office_hours,
          timezone
        )
      )
    `
    )
    .eq("calendar_id", calendarConnectionId)
    .is("deleted_at", null)
    .single();

  if (error) {
    // PGRST116 = no rows found - expected when calendar isn't assigned to an agent yet
    if (error.code !== 'PGRST116') {
      console.error("Error getting agent by calendar connection:", error);
    }
    return null;
  }

  return assignment;
};

/**
 * Check if a time slot is within office hours
 */
export const isWithinOfficeHours = (
  dateTime: string,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string = "Australia/Melbourne"
): { isWithin: boolean; reason?: string } => {
  if (!officeHours) {
    return { isWithin: true }; // No office hours restriction
  }

  try {
    const date = new Date(dateTime);
    const dayOfWeek = date
      .toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: timezone,
      })
      .toLowerCase();

    const timeString = date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });

    // Convert office hours format - assuming it's like:
    // { "monday": { "start": "09:00", "end": "17:00", "enabled": true }, ... }
    const daySchedule = officeHours[dayOfWeek];

    if (!daySchedule || !daySchedule.enabled) {
      return {
        isWithin: false,
        reason: `Agent is not available on ${dayOfWeek}s`,
      };
    }

    const startTime = daySchedule.start;
    const endTime = daySchedule.end;

    if (timeString < startTime || timeString > endTime) {
      return {
        isWithin: false,
        reason: `Time ${timeString} is outside office hours (${startTime} - ${endTime}) on ${dayOfWeek}s`,
      };
    }

    return { isWithin: true };
  } catch (error) {
    console.error("Error checking office hours:", error);
    return { isWithin: true }; // Default to allowing if there's an error
  }
};

/**
 * Get agent by UUID with calendar assignment and connection details
 * Used for booking operations where we need full agent + calendar info
 */
export const getAgentWithCalendarByUUID = async (
  agentUUID: string,
  clientId: number
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  try {
    // Get agent with profile and calendar assignment
    // Use explicit foreign key relationship: profiles!profile_id
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select(
        `
        uuid,
        client_id,
        name,
        description,
        title,
        is_dedicated,
        profile_id,
        assigned_email_id,
        profiles!profile_id (
          id,
          name,
          office_hours,
          timezone
        )
      `
      )
      .eq("uuid", agentUUID)
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .single();

    if (agentError || !agent) {
      console.error("Agent not found:", agentError);
      return null;
    }

    // Debug: Log profile data to see what we're getting
    console.log(`🔍 Agent ${agent.name} profile_id: ${agent.profile_id}`);
    console.log(`🔍 Agent profiles data:`, JSON.stringify(agent.profiles, null, 2));
    
    // If profile relationship didn't load, fetch it separately
    // Note: Supabase can return profiles as array or single object depending on relationship
    const hasProfile = Array.isArray(agent.profiles) 
      ? agent.profiles.length > 0 
      : agent.profiles !== null && agent.profiles !== undefined;
    
    if (!hasProfile && agent.profile_id) {
      console.log(`⚠️ Profile relationship not loaded, fetching separately for profile_id: ${agent.profile_id}`);
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, name, office_hours, timezone")
        .eq("id", agent.profile_id)
        .single();
      
      if (!profileError && profile) {
        // Assign as single object (Supabase relationship can be array or object)
        (agent as any).profiles = profile;
        console.log(`✅ Fetched profile separately:`, JSON.stringify(profile, null, 2));
      } else {
        console.error(`❌ Error fetching profile separately:`, profileError);
      }
    }

    // Get calendar assignment for this agent
    const { data: assignment, error: assignmentError } = await supabase
      .from("agent_calendar_assignments")
      .select("id, agent_id, calendar_id")
      .eq("agent_id", agentUUID)
      .is("deleted_at", null)
      .single();

    if (assignmentError) {
      console.warn("No calendar assignment found for agent:", agentUUID);
      return {
        ...agent,
        calendar_assignment: null,
      };
    }

    // Get calendar connection from lead_dialer schema with full token details
    const { data: calendarConnection, error: calendarError } = await supabase
      .schema("lead_dialer")
      .from("calendar_connections")
      .select("id, client_id, provider_id, provider_name, email, display_name, is_connected, access_token, refresh_token, expires_at")
      .eq("id", assignment.calendar_id)
      .single();

    if (calendarError) {
      console.warn("Calendar connection not found:", calendarError);
      return {
        ...agent,
        calendar_assignment: {
          ...assignment,
          calendar_connections: null,
        },
      };
    }

    // Validate token provider matches calendar provider
    if (calendarConnection.access_token) {
      const tokenParts = calendarConnection.access_token.split('.');
      const isGoogleToken = calendarConnection.access_token.startsWith('ya29.') || calendarConnection.access_token.startsWith('1//');
      
      if (calendarConnection.provider_name === 'microsoft' && isGoogleToken) {
        console.error(`❌ TOKEN PROVIDER MISMATCH for agent ${agentUUID}: Calendar is Microsoft but token is Google`);
        console.error(`Token preview: ${calendarConnection.access_token.substring(0, 50)}...`);
        return {
          ...agent,
          calendar_assignment: {
            ...assignment,
            calendar_connections: null,
          },
        };
      }
      
      if (calendarConnection.provider_name === 'google' && !isGoogleToken) {
        console.error(`❌ TOKEN PROVIDER MISMATCH for agent ${agentUUID}: Calendar is Google but token is Microsoft`);
        return {
          ...agent,
          calendar_assignment: {
            ...assignment,
            calendar_connections: null,
          },
        };
      }
    }

    return {
      ...agent,
      calendar_assignment: {
        ...assignment,
        calendar_connections: calendarConnection,
      },
    };
  } catch (error) {
    console.error("Error fetching agent with calendar:", error);
    return null;
  }
};

/**
 * Get all agents for a client with optional filters
 */
export const getAgentsForClient = async (
  clientId: number,
  options: {
    includeDedicated?: boolean;
    withCalendarOnly?: boolean;
  } = {}
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  try {
    let query = supabase
      .from("agents")
      .select(
        `
        uuid,
        name,
        title,
        description,
        is_dedicated,
        profile_id,
        profiles (
          id,
          name,
          timezone,
          office_hours
        )
      `
      )
      .eq("client_id", clientId)
      .is("deleted_at", null);

    // Filter by dedicated status if specified
    if (options.includeDedicated === false) {
      query = query.eq("is_dedicated", false);
    }

    const { data: agents, error: agentsError } = await query;

    if (agentsError || !agents) {
      console.error("Error fetching agents:", agentsError);
      return [];
    }

    // Get calendar assignments for all agents
    const { data: assignments, error: assignmentsError } = await supabase
      .from("agent_calendar_assignments")
      .select("agent_id, calendar_id")
      .in(
        "agent_id",
        agents.map((a) => a.uuid)
      )
      .is("deleted_at", null);

    if (assignmentsError) {
      console.warn("Error fetching calendar assignments:", assignmentsError);
    }

    // Get calendar connections separately (they're in lead_dialer schema)
    let calendarConnections: Array<{
      id: string;
      provider_name: string;
      email: string;
      is_connected: boolean;
    }> = [];

    if (assignments && assignments.length > 0) {
      const calendarIds = assignments.map((a) => a.calendar_id);
      const { data: calendars, error: calendarsError } = await supabase
        .schema("lead_dialer")
        .from("calendar_connections")
        .select("id, provider_name, email, is_connected")
        .in("id", calendarIds);

      if (calendarsError) {
        console.warn("Error fetching calendar connections:", calendarsError);
      } else {
        calendarConnections = calendars || [];
      }
    }

    // Map agents with calendar info
    const agentsWithCalendar = agents.map((agent) => {
      const assignment = assignments?.find((a) => a.agent_id === agent.uuid);
      const calendarConnection = assignment
        ? calendarConnections.find((c) => c.id === assignment.calendar_id)
        : undefined;

      return {
        uuid: agent.uuid,
        name: agent.name,
        title: agent.title,
        description: agent.description,
        isDedicated: agent.is_dedicated,
        hasCalendar: !!assignment && !!calendarConnection?.is_connected,
        calendarProvider: calendarConnection?.provider_name as
          | "microsoft"
          | "google"
          | undefined,
        calendarEmail: calendarConnection?.email,
        profileName: Array.isArray(agent.profiles)
          ? agent.profiles[0]?.name
          : (agent.profiles as { name?: string })?.name,
        timezone: Array.isArray(agent.profiles)
          ? agent.profiles[0]?.timezone
          : (agent.profiles as { timezone?: string })?.timezone,
      };
    });

    // Filter by calendar availability if specified
    if (options.withCalendarOnly) {
      return agentsWithCalendar.filter((a) => a.hasCalendar);
    }

    return agentsWithCalendar;
  } catch (error) {
    console.error("Error fetching agents for client:", error);
    return [];
  }
};

/**
 * Validate agent has a connected calendar
 */
export const validateAgentHasCalendar = async (
  agentUUID: string,
  clientId: number
): Promise<{
  isValid: boolean;
  error?: string;
  calendarId?: string;
  calendarProvider?: "microsoft" | "google";
}> => {
  const agent = await getAgentWithCalendarByUUID(agentUUID, clientId);

  if (!agent) {
    return {
      isValid: false,
      error: `Agent with UUID ${agentUUID} not found for client ${clientId}`,
    };
  }

  if (!agent.calendar_assignment) {
    return {
      isValid: false,
      error: `Agent "${agent.name}" does not have a calendar assigned. Please assign a calendar connection to this agent first.`,
    };
  }

  const calendarConnection = agent.calendar_assignment
    .calendar_connections as unknown as {
    id: string;
    provider_name: string;
    is_connected: boolean;
  };

  if (!calendarConnection || !calendarConnection.is_connected) {
    return {
      isValid: false,
      error: `Agent "${agent.name}" has a calendar assigned but it is not connected. Please reconnect the calendar.`,
    };
  }

  return {
    isValid: true,
    // Don't return calendarId - let the calendar operations use the primary calendar
    // The calendarConnection.id is our database UUID, not a Microsoft Graph calendar ID
    calendarProvider: calendarConnection.provider_name as "microsoft" | "google",
  };
};
