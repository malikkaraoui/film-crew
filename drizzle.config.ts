import { defineConfig } from 'drizzle-kit'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Charger .env.local manuellement (drizzle-kit ne lit pas .env.local)
try {
  const envLocal = readFileSync(resolve(__dirname, '.env.local'), 'utf-8')
  for (const line of envLocal.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1].trim()] = match[2].trim()
  }
} catch { /* .env.local absent → pas de problème */ }

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://malik@localhost:5432/filmcrew',
  },
})
