import { access, mkdir, writeFile } from 'fs/promises'
import { constants } from 'fs'
import { spawn } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ImageProvider, ImageOpts, ImageResult, ProviderHealth } from '../types'

/**
 * Provider image local — toujours disponible, aucune clé API requise.
 * Génère une carte storyboard PNG locale avec texte, lisible et exploitable
 * comme livrable simple pour le storyboard quand les providers image réels échouent.
 */

const FONT_CANDIDATES = [
  '/Library/Fonts/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/System/Library/Fonts/Monaco.ttf',
  '/System/Library/Fonts/Supplemental/Courier New Bold.ttf',
]

export const localPlaceholderProvider: ImageProvider = {
  name: 'local-placeholder',
  type: 'image',

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: 'free',
      lastCheck: new Date().toISOString(),
      details: 'Storyboard local PNG — toujours disponible (prévisualisation texte locale)',
    }
  },

  estimateCost(): number {
    return 0
  },

  async generate(prompt: string, opts: ImageOpts): Promise<ImageResult> {
    const outputDir = opts.outputDir ?? tmpdir()
    await mkdir(outputDir, { recursive: true })
    const width = opts.width ?? 768
    const height = opts.height ?? 1344
    const stamp = Date.now()
    const filename = `storyboard-local-${stamp}.png`
    const filePath = join(outputDir, filename)
    const fontPath = await resolveFontPath()
    const sections = extractStoryboardSections(prompt)
    const scenePath = join(outputDir, `storyboard-scene-${stamp}.txt`)
    const lightingPath = join(outputDir, `storyboard-light-${stamp}.txt`)
    const cameraPath = join(outputDir, `storyboard-camera-${stamp}.txt`)

    await writeFile(scenePath, wrapText(sections.scene, 28))
    await writeFile(lightingPath, wrapText(sections.lighting, 34))
    await writeFile(cameraPath, wrapText(sections.camera, 34))

    const fontClause = fontPath
      ? `fontfile='${escapeFilterValue(fontPath)}':`
      : ''

    const outerMargin = 34
    const pageX = 54
    const pageY = 116
    const pageWidth = width - 108
    const pageHeight = height - 198
    const mainPanelX = 82
    const mainPanelY = 248
    const mainPanelWidth = width - 164
    const mainPanelHeight = 500
    const infoPanelX = 82
    const infoPanelWidth = width - 164
    const lightingPanelY = 794
    const lightingPanelHeight = 172
    const cameraPanelY = 1000
    const cameraPanelHeight = 172

    const filterGraph = [
      `drawbox=x=0:y=0:w=${width}:h=${height}:color=0xe7dfd1@1:t=fill`,
      `drawbox=x=${outerMargin}:y=${outerMargin}:w=${width - outerMargin * 2}:h=${height - outerMargin * 2}:color=0x121212@1:t=3`,
      `drawbox=x=${pageX}:y=${pageY}:w=${pageWidth}:h=${pageHeight}:color=0xfcfbf7@1:t=fill`,
      `drawbox=x=${pageX}:y=${pageY}:w=${pageWidth}:h=${pageHeight}:color=0x1c1c1c@1:t=2`,
      `drawbox=x=${pageX}:y=${pageY}:w=${pageWidth}:h=88:color=0x171717@1:t=fill`,
      `drawtext=${fontClause}text='STORYBOARD':fontcolor=0xffffff:fontsize=34:x=${pageX + 28}:y=${pageY + 24}`,
      `drawtext=${fontClause}text='LOCAL STORYBOARD PLACEHOLDER':fontcolor=0xded6ca:fontsize=18:x=${pageX + 30}:y=${pageY + 60}`,
      `drawbox=x=${mainPanelX}:y=${mainPanelY}:w=${mainPanelWidth}:h=${mainPanelHeight}:color=0xffffff@1:t=fill`,
      `drawbox=x=${mainPanelX}:y=${mainPanelY}:w=${mainPanelWidth}:h=${mainPanelHeight}:color=0x202020@1:t=2`,
      `drawtext=${fontClause}text='SCENE':fontcolor=0x6b6458:fontsize=18:x=${mainPanelX + 24}:y=${mainPanelY + 28}`,
      `drawtext=${fontClause}textfile='${escapeFilterValue(scenePath)}':reload=0:fontcolor=0x1a1a1a:fontsize=28:line_spacing=12:x=${mainPanelX + 24}:y=${mainPanelY + 96}`,
      `drawbox=x=${infoPanelX}:y=${lightingPanelY}:w=${infoPanelWidth}:h=${lightingPanelHeight}:color=0xf2ede4@1:t=fill`,
      `drawbox=x=${infoPanelX}:y=${lightingPanelY}:w=${infoPanelWidth}:h=${lightingPanelHeight}:color=0x202020@1:t=2`,
      `drawtext=${fontClause}text='LIGHTING':fontcolor=0x6b6458:fontsize=18:x=${infoPanelX + 24}:y=${lightingPanelY + 26}`,
      `drawtext=${fontClause}textfile='${escapeFilterValue(lightingPath)}':reload=0:fontcolor=0x1a1a1a:fontsize=22:line_spacing=8:x=${infoPanelX + 24}:y=${lightingPanelY + 62}`,
      `drawbox=x=${infoPanelX}:y=${cameraPanelY}:w=${infoPanelWidth}:h=${cameraPanelHeight}:color=0xf2ede4@1:t=fill`,
      `drawbox=x=${infoPanelX}:y=${cameraPanelY}:w=${infoPanelWidth}:h=${cameraPanelHeight}:color=0x202020@1:t=2`,
      `drawtext=${fontClause}text='CAMERA':fontcolor=0x6b6458:fontsize=18:x=${infoPanelX + 24}:y=${cameraPanelY + 26}`,
      `drawtext=${fontClause}textfile='${escapeFilterValue(cameraPath)}':reload=0:fontcolor=0x1a1a1a:fontsize=22:line_spacing=8:x=${infoPanelX + 24}:y=${cameraPanelY + 62}`,
      `drawtext=${fontClause}text='FILM CREW  -  simple storyboard card':fontcolor=0x6b6458:fontsize=16:x=${pageX + 28}:y=${pageY + pageHeight - 34}`,
    ].join(',')

    const result = await runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', `color=c=0xe9e2d3:s=${width}x${height}:d=1`,
      '-vf', filterGraph,
      '-frames:v', '1',
      '-y',
      filePath,
    ])

    if (result.code !== 0) {
      throw new Error(result.stderr.slice(0, 500) || result.stdout.slice(0, 500) || 'ffmpeg image render failed')
    }

    return { filePath, costEur: 0 }
  },
}

function extractStoryboardSections(prompt: string): { scene: string; lighting: string; camera: string } {
  const clean = toStoryboardAscii(prompt)
    .replace(/\s+/g, ' ')
    .trim()

  const chunks = clean
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  const scene = chunks[0] ?? clean ?? 'Scene description unavailable'
  const lighting =
    chunks.find((part) => /(light|lighting|soleil|lumiere|ombre|warm|golden|day|night)/i.test(part))
    ?? chunks[1]
    ?? 'Natural light'
  const camera =
    chunks.find((part) => /(camera|angle|zoom|plan|tracking|movement|perspective)/i.test(part))
    ?? chunks[2]
    ?? 'Static camera'

  return { scene, lighting, camera }
}

function toStoryboardAscii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function resolveFontPath(): Promise<string | undefined> {
  for (const candidate of FONT_CANDIDATES) {
    try {
      await access(candidate, constants.R_OK)
      return candidate
    } catch {
      // continuer
    }
  }

  return undefined
}

function wrapText(prompt: string, maxLineLength = 42): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Description unavailable.'

  const words = clean.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word
    if (nextLine.length > maxLineLength && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = nextLine
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines.slice(0, 9).join('\n')
}

function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 })
    })
  })
}
