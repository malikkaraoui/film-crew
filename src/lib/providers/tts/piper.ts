import { access, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import type { TTSProvider, AudioResult, ProviderHealth } from '../types'

const PIPER_BINARY = process.env.PIPER_BINARY || '/usr/local/bin/piper'
const PIPER_MODEL = process.env.PIPER_MODEL || ''

async function binaryExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function runPiper(text: string, modelPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PIPER_BINARY, [
      '--model', modelPath,
      '--output_file', outputPath,
    ])

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.stdin.write(text)
    proc.stdin.end()

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Piper exit ${code}: ${stderr.trim()}`))
    })

    proc.on('error', (err) => reject(new Error(`Piper spawn erreur: ${err.message}`)))
  })
}

export const piperProvider: TTSProvider = {
  name: 'piper-local',
  type: 'tts',

  async healthCheck(): Promise<ProviderHealth> {
    const hasBinary = await binaryExists(PIPER_BINARY)
    if (!hasBinary) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: `Binaire piper introuvable : ${PIPER_BINARY}` }
    }
    if (!PIPER_MODEL) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'PIPER_MODEL non défini' }
    }
    const hasModel = await binaryExists(PIPER_MODEL)
    if (!hasModel) {
      return { status: 'down', lastCheck: new Date().toISOString(), details: `Modèle piper introuvable : ${PIPER_MODEL}` }
    }
    return { status: 'free', lastCheck: new Date().toISOString() }
  },

  estimateCost(): number {
    // Piper local — coût infrastructure nul
    return 0
  },

  async synthesize(text: string, _voiceId: string, _lang: string, outputDir?: string): Promise<AudioResult> {
    if (!PIPER_MODEL) throw new Error('PIPER_MODEL non défini')

    const dir = outputDir ?? tmpdir()
    await mkdir(dir, { recursive: true })

    const filename = `tts-piper-${Date.now()}.wav`
    const filePath = join(dir, filename)

    await runPiper(text, PIPER_MODEL, filePath)

    // Estimation durée : ~150 mots/min
    const words = text.split(/\s+/).length
    const duration = (words / 150) * 60

    return { filePath, duration, costEur: 0 }
  },
}
