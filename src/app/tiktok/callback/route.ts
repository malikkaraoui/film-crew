import { NextResponse } from 'next/server'
import {
  buildTikTokEnvSnippet,
  exchangeTikTokAuthorizationCode,
  getTikTokCallbackUrl,
} from '@/lib/publishers/tiktok'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background: #0b0b0c; color: #f4f4f5; margin: 0; }
      main { max-width: 860px; margin: 48px auto; padding: 0 20px; }
      .card { background: #141418; border: 1px solid #2a2a31; border-radius: 16px; padding: 22px; }
      h1 { margin-top: 0; }
      p, li { line-height: 1.5; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      pre { white-space: pre-wrap; overflow-x: auto; background: #0f1115; border: 1px solid #262833; border-radius: 12px; padding: 14px; }
      .ok { color: #86efac; }
      .warn { color: #fcd34d; }
      .err { color: #fca5a5; }
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
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')
  const cookieState = request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('tiktok_oauth_state='))
    ?.split('=')[1]

  const redirectUri = getTikTokCallbackUrl(url.origin)

  if (error) {
    return new NextResponse(
      htmlPage(
        'TikTok OAuth — refus ou erreur',
        `<p class="err"><strong>${escapeHtml(error)}</strong></p><p>${escapeHtml(errorDescription ?? 'TikTok a renvoyé une erreur.')}</p>`,
      ),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  if (!code) {
    return new NextResponse(
      htmlPage(
        'TikTok OAuth — code manquant',
        `<p class="warn">Aucun <code>code</code> n’a été reçu.</p>
<p>Vérifie que la redirect URI TikTok est bien :</p>
<pre>${escapeHtml(redirectUri)}</pre>`,
      ),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  if (!state || !cookieState || state !== cookieState) {
    return new NextResponse(
      htmlPage(
        'TikTok OAuth — state invalide',
        '<p class="err">Le paramètre <code>state</code> ne correspond pas à celui envoyé au départ.</p><p>Relance simplement <code>/tiktok/connect</code> puis recommence l’autorisation.</p>',
      ),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  try {
    const tokens = await exchangeTikTokAuthorizationCode({
      code,
      redirectUri,
    })

    const envSnippet = buildTikTokEnvSnippet(tokens)

    return new NextResponse(
      htmlPage(
        'TikTok OAuth — token récupéré',
        `<p class="ok">Le code TikTok a bien été échangé contre un token.</p>
<p>Copie les lignes suivantes dans <code>app/.env.local</code> et aussi dans les variables d’environnement Vercel si tu veux tester depuis le domaine déployé.</p>
<pre>${escapeHtml(envSnippet)}</pre>
<p><strong>Infos utiles</strong></p>
<ul>
  <li><code>scope</code> : ${escapeHtml(tokens.scope || '(vide)')}</li>
  <li><code>open_id</code> : ${escapeHtml(tokens.openId)}</li>
  <li><code>expires_in</code> : ${tokens.expiresIn}s</li>
  <li><code>refresh_expires_in</code> : ${tokens.refreshExpiresIn}s</li>
</ul>
<p>Ensuite :</p>
<ol>
  <li>mets à jour les variables d’environnement,</li>
  <li>redéploie / redémarre,</li>
  <li>reteste la publication TikTok dans FILM CREW.</li>
</ol>`,
      ),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  } catch (e) {
    return new NextResponse(
      htmlPage(
        'TikTok OAuth — échange du code échoué',
        `<p class="err">${escapeHtml((e as Error).message)}</p>
<p>Vérifie surtout :</p>
<ul>
  <li><code>TIKTOK_CLIENT_KEY</code> et <code>TIKTOK_CLIENT_SECRET</code> bien présents sur Vercel,</li>
  <li>redirect URI TikTok exactement égale à :</li>
</ul>
<pre>${escapeHtml(redirectUri)}</pre>`,
      ),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}
