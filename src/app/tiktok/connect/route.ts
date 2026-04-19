import { NextResponse } from 'next/server'
import { buildTikTokAuthorizeUrl, getTikTokCallbackUrl } from '@/lib/publishers/tiktok'

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background: #0b0b0c; color: #f4f4f5; margin: 0; }
      main { max-width: 760px; margin: 48px auto; padding: 0 20px; }
      .card { background: #141418; border: 1px solid #2a2a31; border-radius: 16px; padding: 20px; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      a { color: #8ab4ff; }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>${title}</h1>
        ${body}
      </div>
    </main>
  </body>
</html>`
}

export async function GET(request: Request) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY || ''

  if (!clientKey) {
    return new NextResponse(
      htmlPage(
        'TikTok OAuth indisponible',
        '<p><strong>TIKTOK_CLIENT_KEY</strong> est absent côté serveur.</p><p>Ajoute la variable d’environnement dans Vercel puis relance cette URL.</p>',
      ),
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    )
  }

  const origin = new URL(request.url).origin
  const redirectUri = getTikTokCallbackUrl(origin)
  const state = crypto.randomUUID()
  const authorizeUrl = buildTikTokAuthorizeUrl({
    clientKey,
    redirectUri,
    state,
  })

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set('tiktok_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/tiktok',
    maxAge: 60 * 10,
  })

  return response
}
