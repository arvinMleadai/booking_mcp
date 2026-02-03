// Type definitions for the clients table
export interface Client {
  id: number;
  name: string;
  code: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
  timezone?: string;
  phone_number?: string;
  is_onboarding_done?: boolean;
  subscribed_package?: string;
}
