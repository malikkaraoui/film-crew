import type { MeetingBrief, MeetingSceneOutlineItem } from '@/types/agent'
import type { DialogueLine, DialogueScene } from '@/types/audio'

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function cleanSceneDialogue(value: string): string {
  return normalizeWhitespace(value.replace(/\([^)]*\)/g, ' '))
}

function extractQuotedDialogue(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"/g)]
    .map((match) => cleanSceneDialogue(match[1] ?? ''))
    .filter(Boolean)
}

function splitBriefIntoSceneBlocks(content: string): Array<{ sceneIndex: number; body: string }> {
  const blocks = [...content.matchAll(/(?:^|\n)\s*\*{0,2}SC[ÈE]NE\s+(\d+)[^:\n]*:\*{0,2}\s*([\s\S]*?)(?=(?:\n\s*\*{0,2}SC[ÈE]NE\s+\d+[^:\n]*:\*{0,2})|$)/giu)]

  return blocks.map((match) => ({
    sceneIndex: Number.parseInt(match[1] ?? '0', 10),
    body: match[2] ?? '',
  })).filter((block) => Number.isFinite(block.sceneIndex) && block.sceneIndex > 0)
}

export function extractBriefSceneDialogues(brief: MeetingBrief | Pick<MeetingBrief, 'sections' | 'sceneOutline'> | null | undefined): Map<number, string> {
  const dialogueByScene = new Map<number, string>()

  const samiSection = brief?.sections?.find((section) => section.agent === 'sami')
  if (samiSection?.content) {
    for (const block of splitBriefIntoSceneBlocks(samiSection.content)) {
      const quotedLines = extractQuotedDialogue(block.body)
      const dialogue = normalizeWhitespace(quotedLines.join(' '))
      if (dialogue) {
        dialogueByScene.set(block.sceneIndex, dialogue)
      }
    }
  }

  for (const scene of brief?.sceneOutline ?? []) {
    const dialogue = normalizeWhitespace(scene.dialogue ?? '')
    if (dialogue && !dialogueByScene.has(scene.index)) {
      dialogueByScene.set(scene.index, dialogue)
    }
  }

  return dialogueByScene
}

export function backfillSceneOutlineDialogue(
  sceneOutline: MeetingSceneOutlineItem[],
  dialogueByScene: Map<number, string>,
): MeetingSceneOutlineItem[] {
  return sceneOutline.map((scene) => {
    const fallbackDialogue = dialogueByScene.get(scene.index)
    if (normalizeWhitespace(scene.dialogue ?? '') || !fallbackDialogue) {
      return scene
    }

    return {
      ...scene,
      dialogue: fallbackDialogue,
    }
  })
}

function estimateDuration(text: string): number {
  const words = normalizeWhitespace(text).split(' ').filter(Boolean).length
  return Number(Math.max(1, words / 3).toFixed(1))
}

function buildFallbackDialogueLines(text: string): DialogueLine[] {
  const segments = (text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [text])
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean)

  return segments.map((segment, index) => ({
    lineIndex: index,
    speaker: 'narrateur',
    text: segment,
    tone: 'mystérieux',
    pace: 'normal',
    emphasis: segment.split(' ').filter(Boolean).slice(0, 2),
    estimatedDurationS: estimateDuration(segment),
  }))
}

export function normalizeDialogueScenesWithFallback(args: {
  scenes: DialogueScene[]
  structuredScenes: Array<Record<string, unknown>>
  dialogueByScene: Map<number, string>
}): DialogueScene[] {
  const { scenes, structuredScenes, dialogueByScene } = args

  return structuredScenes.map((structuredScene, index) => {
    const sceneIndex = typeof structuredScene.index === 'number' ? structuredScene.index : index + 1
    const existingScene = scenes.find((scene) => scene.sceneIndex === sceneIndex)
    const structuredDialogue = typeof structuredScene.dialogue === 'string' ? normalizeWhitespace(structuredScene.dialogue) : ''
    const fallbackDialogue = dialogueByScene.get(sceneIndex) ?? structuredDialogue
    const existingLines = existingScene?.lines?.filter((line) => normalizeWhitespace(line.text).length > 0) ?? []
    const finalLines = existingLines.length > 0
      ? existingLines.map((line, lineIndex) => ({
          ...line,
          lineIndex,
          text: normalizeWhitespace(line.text),
          emphasis: Array.isArray(line.emphasis) ? line.emphasis.filter(Boolean).slice(0, 3) : [],
          estimatedDurationS: typeof line.estimatedDurationS === 'number' && line.estimatedDurationS > 0
            ? line.estimatedDurationS
            : estimateDuration(line.text),
        }))
      : fallbackDialogue
        ? buildFallbackDialogueLines(fallbackDialogue)
        : []

    return {
      sceneIndex,
      title: typeof existingScene?.title === 'string' && normalizeWhitespace(existingScene.title)
        ? normalizeWhitespace(existingScene.title)
        : typeof structuredScene.description === 'string' && normalizeWhitespace(structuredScene.description)
          ? normalizeWhitespace(structuredScene.description).slice(0, 80)
          : `Scène ${sceneIndex}`,
      durationTargetS: typeof existingScene?.durationTargetS === 'number' && existingScene.durationTargetS > 0
        ? existingScene.durationTargetS
        : typeof structuredScene.duration_s === 'number' && structuredScene.duration_s > 0
          ? structuredScene.duration_s
          : 5,
      lines: finalLines,
      silences: existingScene?.silences ?? [],
      stageDirections: existingScene?.stageDirections ?? '',
    }
  })
}

export function findScenesMissingDialogue(args: {
  scenes: DialogueScene[]
  structuredScenes: Array<Record<string, unknown>>
  dialogueByScene: Map<number, string>
}): number[] {
  const { scenes, structuredScenes, dialogueByScene } = args

  return structuredScenes
    .map((structuredScene, index) => ({
      sceneIndex: typeof structuredScene.index === 'number' ? structuredScene.index : index + 1,
      structuredDialogue: typeof structuredScene.dialogue === 'string' ? normalizeWhitespace(structuredScene.dialogue) : '',
    }))
    .filter(({ sceneIndex, structuredDialogue }) => {
      const expectsDialogue = Boolean(structuredDialogue || dialogueByScene.get(sceneIndex))
      if (!expectsDialogue) return false
      const scene = scenes.find((entry) => entry.sceneIndex === sceneIndex)
      return !scene || scene.lines.filter((line) => normalizeWhitespace(line.text).length > 0).length === 0
    })
    .map(({ sceneIndex }) => sceneIndex)
}