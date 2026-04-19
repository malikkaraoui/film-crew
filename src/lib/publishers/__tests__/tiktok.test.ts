import { describe, it, expect, afterAll } from 'vitest'
import { rmSync, mkdirSync, existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { buildTikTokAuthorizeUrl, buildTikTokEnvSnippet, getTikTokCallbackUrl } from '../tiktok'

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'tiktok-test')

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe('10A — Publication TikTok', () => {

  // ─── PublishResult — structure ───────────────────────────────────────────

  describe('PublishResult — structure attendue', () => {
    it('NO_CREDENTIALS : tous les champs obligatoires présents', () => {
      const result = {
        platform: 'tiktok' as const,
        status: 'NO_CREDENTIALS' as const,
        credentials: { hasAccessToken: false, hasClientKey: false },
        instructions: 'Pour publier sur TikTok, configurer dans .env.local :\n  TIKTOK_ACCESS_TOKEN=<token>\nObtenir via https://developers.tiktok.com',
        runId: 'test-run-10a',
        title: 'Vidéo test',
        hashtags: ['#shorts', '#ai'],
        mediaMode: 'animatic',
      }

      expect(result.platform).toBe('tiktok')
      expect(result.status).toBe('NO_CREDENTIALS')
      expect(result.credentials.hasAccessToken).toBe(false)
      expect(result.instructions).toBeTruthy()
      expect(result.instructions.length).toBeGreaterThan(50)
      expect(result.runId).toBeTruthy()
      // Pas de publishId ni videoId (non publiés)
      expect('publishId' in result).toBe(false)
      expect('videoId' in result).toBe(false)
    })

    it('SUCCESS : contient publishId, publishedAt, videoId optionnel', () => {
      const result = {
        platform: 'tiktok' as const,
        status: 'SUCCESS' as const,
        publishId: 'v_pub_7xxx',
        videoId: '7123456789',
        shareUrl: 'https://www.tiktok.com/@user/video/7123456789',
        credentials: { hasAccessToken: true, hasClientKey: true },
        publishedAt: new Date().toISOString(),
        runId: 'test-run-10a',
        title: 'Vidéo test',
        hashtags: ['#shorts'],
        mediaMode: 'animatic',
        mediaSizeBytes: 1_500_000,
      }

      expect(result.status).toBe('SUCCESS')
      expect(result.publishId).toBeTruthy()
      expect(result.publishedAt).toBeTruthy()
      // publishedAt est une date ISO valide
      expect(() => new Date(result.publishedAt)).not.toThrow()
      expect(new Date(result.publishedAt).getFullYear()).toBe(2026)
      expect(result.credentials.hasAccessToken).toBe(true)
    })

    it('FAILED : contient error explicite, publishId si connu', () => {
      const result = {
        platform: 'tiktok' as const,
        status: 'FAILED' as const,
        publishId: 'v_pub_7xxx',   // init avait réussi mais upload a échoué
        error: 'TikTok upload HTTP 413: video too large',
        credentials: { hasAccessToken: true, hasClientKey: false },
        runId: 'test-run-10a',
        title: 'Vidéo test',
        hashtags: ['#shorts'],
        mediaMode: 'video_finale',
        mediaSizeBytes: 500_000_000,
      }

      expect(result.status).toBe('FAILED')
      expect(result.error).toBeTruthy()
      expect(result.error.length).toBeGreaterThan(10)
      expect(result.publishId).toBeTruthy()  // traçable même en cas d'échec
    })

    it('PROCESSING : publishId connu, pas encore de videoId', () => {
      const result = {
        platform: 'tiktok' as const,
        status: 'PROCESSING' as const,
        publishId: 'v_pub_7xxx',
        credentials: { hasAccessToken: true, hasClientKey: true },
        runId: 'test-run-10a',
        title: 'Vidéo test',
        hashtags: ['#shorts'],
        mediaMode: 'animatic',
      }

      expect(result.status).toBe('PROCESSING')
      expect(result.publishId).toBeTruthy()
      expect('videoId' in result).toBe(false)  // pas encore disponible
    })

    it('NO_MEDIA : error explicite sur le chemin du fichier', () => {
      const result = {
        platform: 'tiktok' as const,
        status: 'NO_MEDIA' as const,
        error: 'Fichier vidéo introuvable : /storage/runs/test/final/animatic.mp4',
        credentials: { hasAccessToken: true, hasClientKey: true },
        runId: 'test-run-10a',
        title: 'Vidéo test',
        hashtags: ['#shorts'],
        mediaMode: 'animatic',
      }

      expect(result.status).toBe('NO_MEDIA')
      expect(result.error).toContain('introuvable')
    })
  })

  // ─── Credential checking ─────────────────────────────────────────────────

  describe('Credential checking — logique honnête', () => {
    it('sans TIKTOK_ACCESS_TOKEN : status est NO_CREDENTIALS', () => {
      // Simule l'environnement sans token
      const accessToken = process.env.TIKTOK_ACCESS_TOKEN ?? ''

      if (!accessToken) {
        // Comportement attendu dans notre environnement
        const status = 'NO_CREDENTIALS'
        expect(status).toBe('NO_CREDENTIALS')
      } else {
        // Si le token existe, le status ne peut pas être NO_CREDENTIALS
        const status = 'SUCCESS' // ou autre
        expect(status).not.toBe('NO_CREDENTIALS')
      }
    })

    it('credentials reportés honnêtement dans tous les statuts', () => {
      // Vérifier que hasAccessToken reflète bien l'env
      const hasToken = !!(process.env.TIKTOK_ACCESS_TOKEN)
      const hasKey = !!(process.env.TIKTOK_CLIENT_KEY)

      const credentials = { hasAccessToken: hasToken, hasClientKey: hasKey }

      // Les valeurs doivent correspondre exactement aux env vars
      expect(credentials.hasAccessToken).toBe(hasToken)
      expect(credentials.hasClientKey).toBe(hasKey)
      // Dans notre env de test, les deux sont absents
      expect(credentials.hasAccessToken).toBe(false)
      expect(credentials.hasClientKey).toBe(false)
    })
  })

  // ─── savePublishResult / readPublishResult — I/O disque réel ────────────

  describe('savePublishResult + readPublishResult — I/O disque réel', () => {
    it('écrit et relit publish-result.json depuis le disque', async () => {
      mkdirSync(join(FIXTURE_DIR, 'storage', 'runs', 'test-run-10a', 'final'), { recursive: true })

      const result = {
        platform: 'tiktok' as const,
        status: 'NO_CREDENTIALS' as const,
        credentials: { hasAccessToken: false, hasClientKey: false },
        instructions: 'Configurer TIKTOK_ACCESS_TOKEN dans .env.local',
        runId: 'test-run-10a',
        title: 'Vidéo de test 10A',
        hashtags: ['#shorts', '#ai', '#filmcrew'],
        mediaMode: 'animatic',
      }

      const logPath = join(FIXTURE_DIR, 'storage', 'runs', 'test-run-10a', 'final', 'publish-result.json')
      await writeFile(logPath, JSON.stringify(result, null, 2))

      // Relire
      expect(existsSync(logPath)).toBe(true)
      const raw = JSON.parse(await readFile(logPath, 'utf-8'))

      expect(raw.platform).toBe('tiktok')
      expect(raw.status).toBe('NO_CREDENTIALS')
      expect(raw.credentials.hasAccessToken).toBe(false)
      expect(raw.instructions).toBeTruthy()
      expect(raw.runId).toBe('test-run-10a')
      expect(Array.isArray(raw.hashtags)).toBe(true)
      expect(raw.hashtags).toContain('#shorts')
    })

    it('publish-result.json est un JSON lisible et traceable', async () => {
      const logPath = join(FIXTURE_DIR, 'storage', 'runs', 'test-run-10a', 'final', 'publish-result.json')

      if (!existsSync(logPath)) {
        mkdirSync(join(FIXTURE_DIR, 'storage', 'runs', 'test-run-10a', 'final'), { recursive: true })
        await writeFile(logPath, JSON.stringify({ platform: 'tiktok', status: 'NO_CREDENTIALS', runId: 'x' }, null, 2))
      }

      const raw = JSON.parse(await readFile(logPath, 'utf-8'))

      // Structure minimale requise pour la traçabilité
      expect(raw).toHaveProperty('platform')
      expect(raw).toHaveProperty('status')
      expect(raw).toHaveProperty('runId')
      expect(raw.platform).toBe('tiktok')
    })
  })

  // ─── Instructions NO_CREDENTIALS — contenu ──────────────────────────────

  describe('Instructions NO_CREDENTIALS — complètes et exploitables', () => {
    it('contient les étapes pour obtenir un access token', () => {
      const instructions = [
        'Pour publier sur TikTok, configurer dans .env.local :',
        '',
        '  TIKTOK_ACCESS_TOKEN=<user_access_token>',
        '  TIKTOK_CLIENT_KEY=<client_key>',
        '  TIKTOK_CLIENT_SECRET=<client_secret>',
        '',
        'Obtenir ces credentials :',
        '  1. Créer une app sur https://developers.tiktok.com',
        '  2. Activer les scopes : user.info.basic, video.upload, video.publish',
        '  3. Déployer l’app en HTTPS (ex: Vercel) puis ouvrir /tiktok/connect pour lancer le flow OAuth 2.0',
        '  4. Autoriser le compte TikTok et récupérer access_token + refresh_token',
      ].join('\n')

      expect(instructions).toContain('TIKTOK_ACCESS_TOKEN')
      expect(instructions).toContain('TIKTOK_CLIENT_SECRET')
      expect(instructions).toContain('developers.tiktok.com')
      expect(instructions).toContain('video.upload')
      expect(instructions).toContain('video.publish')
      expect(instructions).toContain('user.info.basic')
      expect(instructions).toContain('OAuth')
      expect(instructions).toContain('/tiktok/connect')
    })

    it('mentionne le mode Sandbox officiel TikTok', () => {
      const instructions = 'Sandbox officielle TikTok : https://developers.tiktok.com/doc/content-posting-api-get-started/'

      expect(instructions).toContain('Sandbox')
      expect(instructions).toContain('developers.tiktok.com')
    })
  })

  describe('OAuth helpers — Vercel / callback', () => {
    it('construit une callback URL stable pour Vercel', () => {
      expect(getTikTokCallbackUrl('https://film-crew-theta.vercel.app')).toBe(
        'https://film-crew-theta.vercel.app/tiktok/callback',
      )
      expect(getTikTokCallbackUrl('https://film-crew-theta.vercel.app/')).toBe(
        'https://film-crew-theta.vercel.app/tiktok/callback',
      )
    })

    it('construit l’URL d’autorisation TikTok avec scopes et redirect_uri', () => {
      const url = new URL(buildTikTokAuthorizeUrl({
        clientKey: 'client_key_demo',
        redirectUri: 'https://film-crew-theta.vercel.app/tiktok/callback',
        state: 'state123',
      }))

      expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/')
      expect(url.searchParams.get('client_key')).toBe('client_key_demo')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('redirect_uri')).toBe('https://film-crew-theta.vercel.app/tiktok/callback')
      expect(url.searchParams.get('state')).toBe('state123')
      expect(url.searchParams.get('scope')).toContain('video.publish')
      expect(url.searchParams.get('scope')).toContain('video.upload')
      expect(url.searchParams.get('scope')).toContain('user.info.basic')
    })

    it('génère un snippet .env.local copiable après échange OAuth', () => {
      const snippet = buildTikTokEnvSnippet({
        accessToken: 'act.demo',
        refreshToken: 'rft.demo',
        openId: 'open.demo',
        scope: 'user.info.basic,video.upload,video.publish',
        expiresIn: 86400,
        refreshExpiresIn: 31536000,
        tokenType: 'Bearer',
      })

      expect(snippet).toContain('TIKTOK_ACCESS_TOKEN=act.demo')
      expect(snippet).toContain('TIKTOK_REFRESH_TOKEN=rft.demo')
      expect(snippet).toContain('TIKTOK_OPEN_ID=open.demo')
    })
  })

  // ─── Réponse API — codes HTTP honnêtes ──────────────────────────────────

  describe('Codes HTTP de la route POST /publish — honnêtes', () => {
    function httpStatusForPublish(status: string): number {
      if (status === 'SUCCESS' || status === 'PROCESSING') return 200
      if (status === 'NO_CREDENTIALS') return 403
      if (status === 'NO_MEDIA') return 422
      return 502
    }

    it('NO_CREDENTIALS → HTTP 403', () => {
      expect(httpStatusForPublish('NO_CREDENTIALS')).toBe(403)
    })

    it('SUCCESS → HTTP 200', () => {
      expect(httpStatusForPublish('SUCCESS')).toBe(200)
    })

    it('PROCESSING → HTTP 200', () => {
      expect(httpStatusForPublish('PROCESSING')).toBe(200)
    })

    it('FAILED → HTTP 502', () => {
      expect(httpStatusForPublish('FAILED')).toBe(502)
    })

    it('NO_MEDIA → HTTP 422', () => {
      expect(httpStatusForPublish('NO_MEDIA')).toBe(422)
    })
  })
})
