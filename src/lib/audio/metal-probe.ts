import { execFile } from 'child_process'
import { access } from 'fs/promises'
import { platform, arch, cpus, totalmem } from 'os'

// ─── Types ───

export type ChipFamily = 'M1' | 'M2' | 'M3' | 'M4' | 'unknown'
export type ChipTier = 'base' | 'pro' | 'max' | 'ultra' | 'unknown'

export type AppleSiliconInfo = {
  isAppleSilicon: boolean
  chipFamily: ChipFamily
  chipTier: ChipTier
  chipLabel: string        // ex: "Apple M2 Pro"
  coreCount: number
  memoryGb: number
}

export type MetalSupport = {
  available: boolean
  gpuName: string | null
}

export type RuntimeCapability = {
  name: string
  available: boolean
  path: string | null       // chemin binaire ou URL
  details: string
}

export type MetalProbeResult = {
  platform: string          // 'darwin' | 'linux' | etc.
  arch: string              // 'arm64' | 'x64' | etc.
  silicon: AppleSiliconInfo
  metal: MetalSupport
  runtimes: {
    kokoro: RuntimeCapability
    whisper: RuntimeCapability
    ffmpeg: RuntimeCapability
    python: RuntimeCapability
  }
  recommendations: {
    ttsConcurrency: number
    whisperModel: string
    metalAcceleration: boolean
  }
  probedAt: string
}

// ─── Helpers ───

function execPromise(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve((stdout || stderr || '').trim())
    })
  })
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function whichBinary(name: string): Promise<string | null> {
  try {
    const result = await execPromise('/usr/bin/which', [name])
    return result || null
  } catch {
    return null
  }
}

// ─── Apple Silicon Detection ───

export function parseChipInfo(brandString: string): { family: ChipFamily; tier: ChipTier } {
  const normalized = brandString.toLowerCase()

  let family: ChipFamily = 'unknown'
  if (normalized.includes('m4')) family = 'M4'
  else if (normalized.includes('m3')) family = 'M3'
  else if (normalized.includes('m2')) family = 'M2'
  else if (normalized.includes('m1')) family = 'M1'

  let tier: ChipTier = 'unknown'
  if (normalized.includes('ultra')) tier = 'ultra'
  else if (normalized.includes('max')) tier = 'max'
  else if (normalized.includes('pro')) tier = 'pro'
  else if (family !== 'unknown') tier = 'base'

  return { family, tier }
}

async function probeAppleSilicon(): Promise<AppleSiliconInfo> {
  const os = platform()
  const architecture = arch()
  const coreCount = cpus().length
  const memoryGb = Math.round(totalmem() / (1024 ** 3))

  if (os !== 'darwin' || architecture !== 'arm64') {
    return {
      isAppleSilicon: false,
      chipFamily: 'unknown',
      chipTier: 'unknown',
      chipLabel: `${os}/${architecture}`,
      coreCount,
      memoryGb,
    }
  }

  let chipLabel = 'Apple Silicon (unknown)'
  try {
    chipLabel = await execPromise('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string'])
  } catch {
    // fallback
  }

  const { family, tier } = parseChipInfo(chipLabel)

  return {
    isAppleSilicon: true,
    chipFamily: family,
    chipTier: tier,
    chipLabel,
    coreCount,
    memoryGb,
  }
}

// ─── Metal Detection ───

async function probeMetal(): Promise<MetalSupport> {
  if (platform() !== 'darwin') {
    return { available: false, gpuName: null }
  }

  try {
    // system_profiler retourne les infos GPU sur macOS
    const output = await execPromise('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'])
    const parsed = JSON.parse(output) as {
      SPDisplaysDataType?: { sppci_model?: string; spdisplays_metal?: string }[]
    }
    const gpu = parsed.SPDisplaysDataType?.[0]
    const gpuName = gpu?.sppci_model ?? null
    const metalSupported = gpu?.spdisplays_metal?.toLowerCase().includes('supported') ?? false

    return {
      available: metalSupported || gpuName?.toLowerCase().includes('apple') === true,
      gpuName,
    }
  } catch {
    // Si system_profiler échoue, on considère Metal dispo si Apple Silicon arm64
    return {
      available: arch() === 'arm64',
      gpuName: null,
    }
  }
}

// ─── Runtime Probes ───

async function probeKokoro(): Promise<RuntimeCapability> {
  const url = process.env.KOKORO_URL || 'http://localhost:8880'
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    return {
      name: 'kokoro',
      available: res.ok,
      path: url,
      details: res.ok ? `Kokoro FastAPI opérationnel sur ${url}` : `HTTP ${res.status}`,
    }
  } catch {
    return {
      name: 'kokoro',
      available: false,
      path: url,
      details: `Kokoro non joignable sur ${url}`,
    }
  }
}

async function probeWhisper(): Promise<RuntimeCapability> {
  // Vérifier le venv Python + faster-whisper
  const venvPython = '.venv/bin/python'
  const hasVenv = await fileExists(venvPython)

  if (!hasVenv) {
    return {
      name: 'whisper',
      available: false,
      path: null,
      details: 'venv Python non trouvé (.venv/bin/python)',
    }
  }

  try {
    const output = await execPromise(venvPython, ['-c', 'import faster_whisper; print(faster_whisper.__version__)'])
    return {
      name: 'whisper',
      available: true,
      path: venvPython,
      details: `faster-whisper ${output}`,
    }
  } catch {
    return {
      name: 'whisper',
      available: false,
      path: venvPython,
      details: 'faster-whisper non installé dans le venv',
    }
  }
}

async function probeFFmpeg(): Promise<RuntimeCapability> {
  const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg'
  const path = await whichBinary(ffmpegBin)

  if (!path) {
    return {
      name: 'ffmpeg',
      available: false,
      path: null,
      details: `ffmpeg introuvable (${ffmpegBin})`,
    }
  }

  try {
    const output = await execPromise(path, ['-version'])
    const version = output.split('\n')[0] ?? 'version inconnue'

    // Vérifier le support VideoToolbox (accélération hardware macOS)
    let hasVideoToolbox = false
    try {
      const encoders = await execPromise(path, ['-encoders'])
      hasVideoToolbox = encoders.includes('videotoolbox')
    } catch { /* non bloquant */ }

    return {
      name: 'ffmpeg',
      available: true,
      path,
      details: `${version}${hasVideoToolbox ? ' (VideoToolbox OK)' : ''}`,
    }
  } catch {
    return {
      name: 'ffmpeg',
      available: false,
      path,
      details: 'ffmpeg trouvé mais non exécutable',
    }
  }
}

async function probePython(): Promise<RuntimeCapability> {
  const pythonBin = await whichBinary('python3') ?? await whichBinary('python')

  if (!pythonBin) {
    return {
      name: 'python',
      available: false,
      path: null,
      details: 'python3 introuvable dans PATH',
    }
  }

  try {
    const version = await execPromise(pythonBin, ['--version'])
    return {
      name: 'python',
      available: true,
      path: pythonBin,
      details: version,
    }
  } catch {
    return {
      name: 'python',
      available: false,
      path: pythonBin,
      details: 'python trouvé mais non exécutable',
    }
  }
}

// ─── Recommendations ───

function computeRecommendations(silicon: AppleSiliconInfo, runtimes: MetalProbeResult['runtimes']): MetalProbeResult['recommendations'] {
  // Concurrence TTS basée sur les cores disponibles et la RAM
  // Kokoro FastAPI gère sa propre concurrence, mais le pipeline
  // peut rendre N lignes en parallèle.
  let ttsConcurrency = 1
  if (silicon.isAppleSilicon) {
    if (silicon.memoryGb >= 32) ttsConcurrency = 4
    else if (silicon.memoryGb >= 16) ttsConcurrency = 3
    else if (silicon.memoryGb >= 8) ttsConcurrency = 2
  }

  // Modèle Whisper recommandé selon la RAM
  let whisperModel = 'tiny'
  if (silicon.memoryGb >= 32) whisperModel = 'medium'
  else if (silicon.memoryGb >= 16) whisperModel = 'small'
  else if (silicon.memoryGb >= 8) whisperModel = 'base'

  // Accélération Metal possible si Apple Silicon + Metal dispo
  const metalAcceleration = silicon.isAppleSilicon

  return { ttsConcurrency, whisperModel, metalAcceleration }
}

// ─── Main Probe ───

export async function probeMetalCapabilities(): Promise<MetalProbeResult> {
  // Probes parallèles pour minimiser la latence
  const [silicon, metal, kokoro, whisper, ffmpeg, python] = await Promise.all([
    probeAppleSilicon(),
    probeMetal(),
    probeKokoro(),
    probeWhisper(),
    probeFFmpeg(),
    probePython(),
  ])

  const runtimes = { kokoro, whisper, ffmpeg, python }

  return {
    platform: platform(),
    arch: arch(),
    silicon,
    metal,
    runtimes,
    recommendations: computeRecommendations(silicon, runtimes),
    probedAt: new Date().toISOString(),
  }
}
