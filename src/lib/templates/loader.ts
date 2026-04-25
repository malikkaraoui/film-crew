import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { parse } from 'yaml'

export type StyleTemplate = {
  id: string
  name: string
  description: string
  style: string
  rhythm: string
  transitions: string[]
  subtitleStyle: string
  agentTones: Record<string, string>
  promptPrefix: string
  // Champs additifs pour le rendu preview (n'affectent PAS transitions/subtitleStyle existants)
  previewTransition?: string
  previewTransitionDuration?: number
  previewSubtitleStyle?: {
    fontName?: string
    fontSize?: number
    primaryColor?: string   // format ASS: '&H00FFFFFF'
    outlineColor?: string
    outlineWidth?: number
    bold?: boolean
    marginBottom?: number
  }
  /** Active la génération SRT pour ce run — surcharge ENABLE_SUBTITLES si défini */
  enableSubtitles?: boolean
}

const TEMPLATES_DIR = join(process.cwd(), 'templates')

/**
 * Charge un template de style YAML.
 */
export async function loadTemplate(id: string): Promise<StyleTemplate | null> {
  try {
    const raw = await readFile(join(TEMPLATES_DIR, `${id}.yaml`), 'utf-8')
    const parsed = parse(raw) as StyleTemplate
    return { ...parsed, id }
  } catch {
    return null
  }
}

/**
 * Liste tous les templates disponibles.
 */
export async function listTemplates(): Promise<StyleTemplate[]> {
  try {
    const files = await readdir(TEMPLATES_DIR)
    const yamls = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))

    const templates: StyleTemplate[] = []
    for (const file of yamls) {
      const id = file.replace(/\.ya?ml$/, '')
      const tpl = await loadTemplate(id)
      if (tpl) templates.push(tpl)
    }

    return templates
  } catch {
    return []
  }
}
