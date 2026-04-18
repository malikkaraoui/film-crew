import { bootstrapProviders } from '@/lib/providers/bootstrap'

export async function register() {
  // Initialise le registre des providers au démarrage du serveur Next.js
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    bootstrapProviders()
  }
}
