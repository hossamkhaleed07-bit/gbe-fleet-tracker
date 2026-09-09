import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://icgzjqzjmzvhnezpignp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ3pqcXpqbXp2aG5lenBpZ25wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NjMzNjMsImV4cCI6MjEwMzEzOTM2M30.S2A-lXgBKTJog2xobvUxJYz1gAjCnGkuz7aqsOfkpks";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
