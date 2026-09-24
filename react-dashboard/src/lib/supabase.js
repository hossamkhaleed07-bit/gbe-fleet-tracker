import { createClient } from "@supabase/supabase-js";

// Reads from Vercel/CI env vars when set; falls back to the same values as
// before so local dev and the GitHub Pages build (which don't set these)
// keep working unchanged. The anon key is safe to expose — it's meant to be
// public and is restricted by Supabase RLS policies, not a secret.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://icgzjqzjmzvhnezpignp.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ3pqcXpqbXp2aG5lenBpZ25wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NjMzNjMsImV4cCI6MjEwMzEzOTM2M30.S2A-lXgBKTJog2xobvUxJYz1gAjCnGkuz7aqsOfkpks";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
