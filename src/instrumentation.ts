export async function register() {
  // Bootstrap uniquement en Node.js — pas dans l'Edge Runtime
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { bootstrapProviders } = await import('@/lib/providers/bootstrap')
    bootstrapProviders()
  }
}
