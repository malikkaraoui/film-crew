import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoProvider, VideoOpts, VideoResult, ProviderHealth } from '../types'

const execAsync = promisify(exec)

// Sketch Local — Animation crayon à papier ultra-dégradée
// PIL + FFmpeg: génère une animation simple avec 5fps et texte défilant

export const sketchLocalProvider: VideoProvider = {
  name: 'sketch-local',
  type: 'video',

  async healthCheck(): Promise<ProviderHealth> {
    try {
      // Vérifie que ffmpeg est disponible
      const { stdout } = await execAsync('ffmpeg -version', { timeout: 5000 })
      if (stdout.includes('ffmpeg')) {
        return { status: 'free', lastCheck: new Date().toISOString() }
      }
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'ffmpeg non trouvé' }
    } catch {
      return { status: 'down', lastCheck: new Date().toISOString(), details: 'ffmpeg non installé' }
    }
  },

  estimateCost(): number {
    // Gratuit — local
    return 0
  },

  async generate(prompt: string, opts: VideoOpts): Promise<VideoResult> {
    const outputDir = opts.outputDir ?? join(tmpdir(), 'sketch-local')
    await mkdir(outputDir, { recursive: true })

    const duration = opts.duration ?? 5
    const fps = 5
    const frameCount = duration * fps
    const outputPath = join(outputDir, `sketch-${Date.now()}.mp4`)

    // Créer un script Python pour générer les frames
    const pythonScript = generatePythonScript(prompt, frameCount, outputDir)
    const scriptPath = join(outputDir, 'generate_sketch.py')
    await writeFile(scriptPath, pythonScript)

    try {
      // Exécuter le script Python pour générer les frames
      await execAsync(`python3 "${scriptPath}"`, { timeout: 30000 })

      // Assembler les frames en vidéo avec FFmpeg
      const framePattern = join(outputDir, 'frame_%04d.png')
      await execAsync(
        `ffmpeg -framerate ${fps} -i "${framePattern}" -c:v libx264 -pix_fmt yuv420p -y "${outputPath}"`,
        { timeout: 30000 }
      )

      return {
        filePath: outputPath,
        duration,
        costEur: 0,
      }
    } catch (error) {
      throw new Error(`Sketch generation failed: ${(error as Error).message}`)
    }
  },

  async cancel(): Promise<void> {
    // Pas de job asynchrone à annuler localement
  },
}

function generatePythonScript(prompt: string, frameCount: number, outputDir: string): string {
  const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os

output_dir = "${outputDir}"
prompt = '${escapedPrompt}'
frame_count = ${frameCount}
width, height = 1280, 720

# Créer les frames
for i in range(frame_count):
    # Créer une image blanche
    img = Image.new('RGB', (width, height), color='white')
    draw = ImageDraw.Draw(img)

    # Ajouter le texte qui défile en bas
    text_y = height - 100
    text_x = -int((width * i) / frame_count) + width

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Monaco.dfont", 24)
    except:
        font = ImageFont.load_default()

    draw.text((text_x, text_y), prompt, fill='black', font=font)

    # Ajouter un effet sketch simple (edge detection)
    img_cv = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 100, 200)
    sketch = cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)

    # Mélanger: 50% original, 50% sketch
    result = cv2.addWeighted(img_cv, 0.5, sketch, 0.5, 0)

    # Sauvegarder le frame
    frame_path = os.path.join(output_dir, f'frame_{i:04d}.png')
    cv2.imwrite(frame_path, result)

print(f"Generated {frame_count} frames")
`
}
