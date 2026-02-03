export const BASE_SUPABASE_FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL + "functions/v1";

export const BASE_NESTJS_API_URL =
  (process.env.NESTJS_API_URL?.replace(/\/$/, "") || "") + "/api/v1";
