import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Default base is "/" for Vercel (served from the domain root). The GitHub
// Pages deploy (served from a subpath) overrides this at build time with
// `vite build --base=/gbe-fleet-tracker/dashboard-react/` instead of baking
// the subpath in here, so one codebase serves both targets correctly.
export default defineConfig({
  plugins: [react()],
  base: '/',
})
