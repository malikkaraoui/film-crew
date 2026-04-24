import { BaseAgent, type AgentSpeakOptions } from './base-agent'
import { AGENT_PROFILES, MEETING_ORDER } from './profiles'
import { createAgentTrace } from '@/lib/db/queries/traces'
import { updateRunCost } from '@/lib/db/queries/runs'
import { executeWithFailover } from '@/lib/providers/failover'
import type { LLMProvider } from '@/lib/providers/types'
import { logger } from '@/lib/logger'
import type { AgentMessage, AgentRole, MeetingBrief, MeetingSceneOutlineItem } from '@/types/agent'
import type { MeetingLlmMode, OutputConfig, ReferenceImageConfig } from '@/types/run'
import type { StyleTemplate } from '@/lib/templates/loader'
import { resolveLlmTarget } from '@/lib/llm/target'

const MEETING_TRANSCRIPT_MAX_CHARS = 2000
const MEETING_LLM_TIMEOUT_MS = 180_000
const SCENE_OUTLINE_TRANSCRIPT_MAX_CHARS = 3500

function compactTranscriptForPrompt(transcript: string, maxChars = MEETING_TRANSCRIPT_MAX_CHARS): string {
  if (transcript.length <= maxChars) return transcript

  const headChars = Math.floor(maxChars * 0.4)
  const tailChars = maxChars - headChars
  const head = transcript.slice(0, headChars)
  const tail = transcript.slice(-tailChars)

  return `${head}\n\n[... transcript tronqué pour rester lisible et local-first ...]\n\n${tail}`
}

function extractJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced?.[1]?.trim() || trimmed
  const firstBrace = source.indexOf('{')
  const lastBrace = source.lastIndexOf('}')

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('Aucun objet JSON exploitable trouvé dans la synthèse scène par scène')
  }

  return JSON.parse(source.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && normalizeWhitespace(value) ? normalizeWhitespace(value) : fallback
}

function toDuration(value: unknown, fallback = 5): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeSceneOutline(value: unknown): MeetingSceneOutlineItem[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry, index) => {
      const raw = asRecord(entry)
      const sceneIndex = toDuration(raw.index, index + 1)
      return {
        index: sceneIndex,
        title: toText(raw.title, `Scène ${sceneIndex}`),
        description: toText(raw.description, toText(raw.title, `Scène ${sceneIndex}`)),
        dialogue: toText(raw.dialogue, ''),
        camera: toText(raw.camera, 'plan simple'),
        lighting: toText(raw.lighting, 'lumière naturelle'),
        duration_s: toDuration(raw.duration_s, 5),
        foreground: toText(raw.foreground) || undefined,
        midground: toText(raw.midground) || undefined,
        background: toText(raw.background) || undefined,
        emotion: toText(raw.emotion) || undefined,
        narrativeRole: toText(raw.narrativeRole) || undefined,
      }
    })
    .filter((scene) => scene.description.length > 0)
    .sort((a, b) => a.index - b.index)
}

function buildOutputLockContext(outputConfig: OutputConfig | null | undefined): string {
  if (!outputConfig) return ''

  return [
    'Cadre de production verrouillé pour ce run :',
    `- vidéos prévues en sortie : ${outputConfig.videoCount}`,
    `- vidéo entière à préparer ici : ${outputConfig.fullVideoDurationS}s`,
    `- durée par scène : ${outputConfig.sceneDurationS}s`,
    `- sceneOutline obligatoire : exactement ${outputConfig.sceneCount} scènes`,
    `- storyboard attendu : ${outputConfig.sceneCount} vignettes`,
    `- prompts attendus : ${outputConfig.sceneCount} prompts vidéo`,
    'Ne réduis pas ce cadrage. Ne fusionne pas les scènes. Ne change pas le nombre de scènes.',
  ].join('\n')
}

function buildReferenceImagesContext(referenceImages: ReferenceImageConfig | null | undefined): string {
  if (!referenceImages?.urls?.length) return ''

  return [
    'Références visuelles projet :',
    ...referenceImages.urls.map((url, index) => `- image ${index + 1} : ${url}`),
    'Présente-les et traite-les comme des sources d’inspiration visuelle partagées entre agents.',
    'Utilise-les comme ancrage visuel pour la cohérence de personnage, décor, matière, palette, lumière, texture ou cadrage.',
    'Référence-les explicitement quand elles influencent une proposition importante.',
    'Ce sont des inspirations fortes, pas des copies littérales ni des contraintes rigides.',
  ].join('\n')
}

function buildReferenceImagesDirective(referenceImages: ReferenceImageConfig | null | undefined): string {
  const context = buildReferenceImagesContext(referenceImages)
  if (!context) return ''

  return [
    context,
    '',
    'Consigne réunion :',
    '- considère ces images/URLs dès maintenant dans ton analyse',
    '- cite les inspirations utiles si elles orientent le ton, le look, le décor, le personnage ou le cadrage',
    '- propose des idées compatibles avec ces références sans les recopier plan par plan',
  ].join('\n')
}

function buildVisualSafetyDirective(): string {
  return [
    'Consigne visuelle non négociable :',
    '- aucune scène ne doit ressembler à un sujet isolé sur fond studio, fond blanc, fond gris, fond noir ou fond seamless',
    '- chaque scène doit décrire un vrai décor avec profondeur lisible',
    '- précise toujours ce qu on voit au premier plan, au plan intermédiaire et à l arrière-plan',
    '- compose chaque scène pour un rendu vertical TikTok 9:16 : sujet lisible, composition verticale stable, aucun cadrage pensé paysage',
    '- si une image de référence montre un objet isolé, réinterprète-la dans un décor réel cohérent au lieu de reprendre son fond neutre',
  ].join('\n')
}

function validateSceneOutlineLock(sceneOutline: MeetingSceneOutlineItem[], outputConfig: OutputConfig | null | undefined): void {
  if (!outputConfig) return

  if (sceneOutline.length !== outputConfig.sceneCount) {
    throw new Error(`sceneOutline verrouillé invalide: ${sceneOutline.length} scène(s) générée(s), ${outputConfig.sceneCount} attendue(s)`)
  }

  const invalidScene = sceneOutline.find((scene) => scene.duration_s !== outputConfig.sceneDurationS)
  if (invalidScene) {
    throw new Error(`sceneOutline verrouillé invalide: scène ${invalidScene.index} à ${invalidScene.duration_s}s, ${outputConfig.sceneDurationS}s attendues`)
  }

  const totalDuration = sceneOutline.reduce((sum, scene) => sum + scene.duration_s, 0)
  if (totalDuration !== outputConfig.fullVideoDurationS) {
    throw new Error(`sceneOutline verrouillé invalide: ${totalDuration}s cumulées, ${outputConfig.fullVideoDurationS}s attendues`)
  }
}

/**
 * Coordonne une réunion de production entre les 6 agents.
 *
 * Flow :
 * 1. Mia ouvre la réunion et présente le brief
 * 2. Tour de table : chaque agent donne son avis
 * 3. Discussion libre (2 rounds)
 * 4. Emilie vérifie la cohérence Brand Kit
 * 5. Chaque agent rédige sa section du brief
 * 6. Mia conclut avec le résumé exécutif
 */
export class MeetingCoordinator {
  private agents: Map<AgentRole, BaseAgent> = new Map()
  private messages: AgentMessage[] = []
  private runId: string
  private idea: string
  private brandKit: string | null
  private template: StyleTemplate | null
  private outputConfig: OutputConfig | null
  private referenceImages: ReferenceImageConfig | null
  private meetingLlmMode: MeetingLlmMode
  private meetingLlmModel: string | null
  private llmHost?: string
  private llmHeaders?: Record<string, string>
  private onMessage?: (message: AgentMessage) => void

  constructor(opts: {
    runId: string
    idea: string
    brandKit?: string | null
    template?: StyleTemplate | null
    outputConfig?: OutputConfig | null
    referenceImages?: ReferenceImageConfig | null
    meetingLlmMode?: MeetingLlmMode
    meetingLlmModel?: string | null
    onMessage?: (message: AgentMessage) => void
  }) {
    this.runId = opts.runId
    this.idea = opts.idea
    this.brandKit = opts.brandKit ?? null
    this.template = opts.template ?? null
    this.outputConfig = opts.outputConfig ?? null
    this.referenceImages = opts.referenceImages ?? null
    this.meetingLlmMode = opts.meetingLlmMode ?? 'local'
    this.meetingLlmModel = opts.meetingLlmModel?.trim() || null
    this.onMessage = opts.onMessage

    const llmTarget = resolveLlmTarget(this.meetingLlmMode, this.meetingLlmModel)
    this.meetingLlmModel = llmTarget.model
    this.llmHost = llmTarget.host
    this.llmHeaders = llmTarget.headers

    // Initialiser tous les agents
    for (const [role, profile] of Object.entries(AGENT_PROFILES)) {
      this.agents.set(role as AgentRole, new BaseAgent(profile))
    }
  }

  getMessages(): AgentMessage[] {
    return [...this.messages]
  }

  /**
   * Lance la réunion complète et retourne le brief final.
   */
  async runMeeting(): Promise<MeetingBrief> {
    logger.info({
      event: 'meeting_start',
      runId: this.runId,
      idea: this.idea,
      outputConfig: this.outputConfig,
      llmMode: this.meetingLlmMode,
      llmModel: this.meetingLlmModel,
    })

    let totalCost = 0

    // Contexte template injecté dans toute la réunion (10D)
    const templateContext = this.template
      ? `\n\nTemplate de style : ${this.template.name} — ${this.template.description}\nRythme : ${this.template.rhythm}\nTransitions : ${this.template.transitions.join(', ')}`
      : ''
    const outputLockContext = this.outputConfig ? `\n\n${buildOutputLockContext(this.outputConfig)}` : ''
    const referenceImagesContext = this.referenceImages ? `\n\n${buildReferenceImagesContext(this.referenceImages)}` : ''
    const referenceImagesDirective = buildReferenceImagesDirective(this.referenceImages)
    const visualSafetyDirective = buildVisualSafetyDirective()

    // Phase 1 : Mia ouvre la réunion
    const openingContext = `Nouvelle réunion de production. L'idée du client est : "${this.idea}".${this.brandKit ? `\n\nBrand Kit de la chaîne :\n${this.brandKit}` : ''}${templateContext}${outputLockContext}${referenceImagesContext}\n\n${visualSafetyDirective}\n\nPrésente le brief à l'équipe et lance la discussion. Sois directe et motivante.`

    const opening = await this.agentSpeak('mia', openingContext)
    totalCost += opening.metadata?.costEur ?? 0

    // Phase 2 : Tour de table narratif — lenny, nael
    for (const role of ['lenny', 'nael'] as AgentRole[]) {
      const transcript = this.getPromptTranscript()
      const agentTone = this.template?.agentTones?.[role]
      const toneContext = agentTone ? `\n[Ton attendu dans ce style ${this.template!.name} : ${agentTone}]` : ''
      const context = `Voici la discussion jusqu'ici :\n\n${transcript}\n\nC'est ton tour de parler. Donne ton avis de ${AGENT_PROFILES[role].title} sur cette idée. Sois concis (3-5 phrases). Challenge les idées des autres si nécessaire.${toneContext}`

      const msg = await this.agentSpeak(role, context, {
        resetHistory: true,
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
        contextualPrelude: [referenceImagesDirective, visualSafetyDirective].filter(Boolean).join('\n\n') || undefined,
      })
      totalCost += msg.metadata?.costEur ?? 0
    }

    // Phase 3 : Tour de table audio — sami, jade, remi
    for (const role of ['sami', 'jade', 'remi'] as AgentRole[]) {
      const transcript = this.getPromptTranscript()
      const context = `Voici la discussion narrative jusqu'ici :\n\n${transcript}\n\nC'est ton tour. En tant que ${AGENT_PROFILES[role].title}, propose tes intentions audio pour cette idée. Sois concis (3-5 phrases). Pense à ce qu'on entendra si on ferme les yeux.`

      const msg = await this.agentSpeak(role, context, {
        resetHistory: true,
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
      })
      totalCost += msg.metadata?.costEur ?? 0
    }

    // Phase 4 : Discussion croisée image/son — 2 rounds × laura, nico, jade, remi
    for (let round = 0; round < 2; round++) {
      for (const role of ['laura', 'nico', 'jade', 'remi'] as AgentRole[]) {
        const transcript = this.getPromptTranscript()
        const context = `Discussion croisée image/son (round ${round + 1}) :\n\n${transcript}\n\nRéagis aux propositions visuelles ET sonores. Comment ton domaine (${AGENT_PROFILES[role].title}) s'articule avec les autres ? Affine ou challenge. 2-3 phrases max.`

        const msg = await this.agentSpeak(role, context, {
          resetHistory: true,
          timeoutMs: MEETING_LLM_TIMEOUT_MS,
          contextualPrelude: [referenceImagesDirective, visualSafetyDirective].filter(Boolean).join('\n\n') || undefined,
        })
        totalCost += msg.metadata?.costEur ?? 0
      }
    }

    // Phase 5 : Arbitrage rythme — theo propose, lenny et nael réagissent
    {
      const transcript = this.getPromptTranscript()
      const theoContext = `Voici toutes les propositions narratives, visuelles et sonores :\n\n${transcript}\n\nEn tant qu'éditeur rythme, propose un timing global : durée par scène, placement des pauses, rythme de montage. Arbitre ce qui va trop vite ou trop lent. Sois concret (durées en secondes).`

      const theoMsg = await this.agentSpeak('theo', theoContext, {
        resetHistory: true,
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
      })
      totalCost += theoMsg.metadata?.costEur ?? 0

      for (const role of ['lenny', 'nael'] as AgentRole[]) {
        const updatedTranscript = this.getPromptTranscript()
        const reactContext = `Théo vient de proposer un timing :\n\n${updatedTranscript}\n\nRéagis à sa proposition de rythme. Le timing sert-il l'histoire et l'émotion ? 2-3 phrases max.`

        const msg = await this.agentSpeak(role, reactContext, {
          resetHistory: true,
          timeoutMs: MEETING_LLM_TIMEOUT_MS,
        })
        totalCost += msg.metadata?.costEur ?? 0
      }
    }

    // Phase 6 : Emilie vérifie la cohérence Brand Kit (visuel + sonore)
    const brandCheckContext = `Voici toute la discussion :\n\n${this.getPromptTranscript()}\n\n${this.brandKit ? `Brand Kit :\n${this.brandKit}\n\n` : ''}Vérifie la cohérence de toutes les propositions — visuelles ET sonores — avec le Brand Kit et l'identité de la chaîne. Valide ce qui est conforme, rejette ce qui ne l'est pas en expliquant pourquoi et en proposant une correction. Inclus les choix de ton vocal, d'ambiance et de musique dans ta validation.`

    const brandCheck = await this.agentSpeak('emilie', brandCheckContext, {
      resetHistory: true,
      timeoutMs: MEETING_LLM_TIMEOUT_MS,
      contextualPrelude: [referenceImagesDirective, visualSafetyDirective].filter(Boolean).join('\n\n') || undefined,
    })
    brandCheck.messageType = 'validation'
    totalCost += brandCheck.metadata?.costEur ?? 0

    // Phase 7 : Chaque agent rédige sa section du brief
    const fullTranscript = this.formatTranscript()
    const transcript = compactTranscriptForPrompt(fullTranscript)
    logger.info({ event: 'meeting_transcript', runId: this.runId, fullLength: fullTranscript.length, truncatedLength: transcript.length })
    const briefSections: MeetingBrief['sections'] = []

    for (const role of ['lenny', 'laura', 'nael', 'emilie', 'nico', 'sami', 'jade', 'remi', 'theo'] as AgentRole[]) {
      const agent = this.agents.get(role)!
      const section = await agent.writeBriefSection(transcript, this.runId, {
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
        model: this.meetingLlmModel ?? undefined,
        host: this.llmHost,
        headers: this.llmHeaders,
        contextualPrelude: [referenceImagesDirective, visualSafetyDirective].filter(Boolean).join('\n\n') || undefined,
      })
      await this.recordMessage(section)
      totalCost += section.metadata?.costEur ?? 0

      briefSections.push({
        agent: role,
        title: AGENT_PROFILES[role].briefSection,
        content: section.content,
      })
    }

    // Phase 8 : Mia conclut — utiliser le transcript tronqué
    const closingContext = `Voici la réunion et les sections du brief :\n\n${transcript}\n\nConclus la réunion. Produis :\n1. Un résumé exécutif (5-7 lignes)\n2. Une estimation budget (en postes de coûts)\n3. Ta validation finale\n\nRappelle explicitement que :\n- chaque scène doit imposer premier plan, plan intermédiaire, arrière-plan\n- interdire les fonds studio/neutres\n- rester pensée pour un rendu TikTok vertical 9:16\n- l'audio (dialogues, ambiances, musique) doit être validé AVANT la génération vidéo\n\nSois directe et structurée.`

    const closing = await this.agentSpeak('mia', closingContext, {
      resetHistory: true,
      timeoutMs: MEETING_LLM_TIMEOUT_MS,
    })
    totalCost += closing.metadata?.costEur ?? 0

    let sceneOutline: MeetingSceneOutlineItem[] = []
    try {
      sceneOutline = await this.buildSceneOutline(fullTranscript, briefSections)
    } catch (error) {
      if (this.outputConfig) {
        throw error
      }
      logger.warn({
        event: 'meeting_scene_outline_missing',
        runId: this.runId,
        error: (error as Error).message,
      })
    }

    // Mettre à jour le coût du run
    await updateRunCost(this.runId, totalCost).catch(() => {})

    logger.info({
      event: 'meeting_complete',
      runId: this.runId,
      messageCount: this.messages.length,
      totalCost,
    })

    return {
      runId: this.runId,
      idea: this.idea,
      sections: briefSections,
      summary: closing.content,
      sceneOutline,
      estimatedBudget: `~${totalCost.toFixed(2)} € (réunion)`,
      validatedBy: 'mia',
      createdAt: new Date().toISOString(),
    }
  }

  private async agentSpeak(
    role: AgentRole,
    context: string,
    opts: AgentSpeakOptions = {},
  ): Promise<AgentMessage> {
    const agent = this.agents.get(role)!
    const message = await agent.speak(context, this.runId, {
      ...opts,
      model: opts.model ?? this.meetingLlmModel ?? undefined,
      host: opts.host ?? this.llmHost,
      headers: opts.headers ?? this.llmHeaders,
    })
    await this.recordMessage(message)
    return message
  }

  private async recordMessage(message: AgentMessage): Promise<void> {
    this.messages.push(message)

    // Notifier en temps réel
    this.onMessage?.(message)

    // Persister dans agent_trace
    await createAgentTrace({
      id: message.id,
      runId: message.runId,
      agentName: message.agentName,
      messageType: message.messageType,
      content: {
        text: message.content,
        metadata: message.metadata,
      },
    }).catch(() => {})
  }

  private formatTranscript(): string {
    return this.messages
      .filter((m) => m.messageType === 'dialogue' || m.messageType === 'validation')
      .map((m) => {
        const profile = AGENT_PROFILES[m.agentName as AgentRole]
        const label = profile ? `${profile.displayName} (${profile.title})` : m.agentName
        return `[${label}] ${m.content}`
      })
      .join('\n\n')
  }

  private getPromptTranscript(maxChars = MEETING_TRANSCRIPT_MAX_CHARS): string {
    return compactTranscriptForPrompt(this.formatTranscript(), maxChars)
  }

  private async buildSceneOutline(
    transcript: string,
    sections: MeetingBrief['sections'],
  ): Promise<MeetingSceneOutlineItem[]> {
    const compactTranscript = compactTranscriptForPrompt(transcript, SCENE_OUTLINE_TRANSCRIPT_MAX_CHARS)
    const outputLockContext = buildOutputLockContext(this.outputConfig)
    const referenceImagesContext = buildReferenceImagesContext(this.referenceImages)
    const visualSafetyDirective = buildVisualSafetyDirective()
    const compactSections = sections.map((section) => ({
      agent: section.agent,
      title: section.title,
      content: section.content.slice(0, 700),
    }))

    const { result } = await executeWithFailover(
      'llm',
      async (provider) => {
        const llm = provider as LLMProvider
        return llm.chat(
          [
            {
              role: 'system',
              content: [
                'Tu transformes une reunion de production en sceneOutline canonique.',
                'Retourne uniquement un JSON valide, sans markdown ni texte autour.',
                'Schema attendu :',
                '{',
                '  "sceneOutline": [',
                '    {',
                '      "index": 1,',
                '      "title": "titre court",',
                '      "description": "ce qui doit etre montre dans la scene",',
                '      "dialogue": "dialogue ou narration si disponible",',
                '      "camera": "intention camera principale",',
                '      "lighting": "intention lumiere",',
                '      "duration_s": 5,',
                '      "foreground": "ce qu on voit au premier plan",',
                '      "midground": "ce qu on voit au plan intermédiaire",',
                '      "background": "ce qu on voit a l arrière-plan",',
                '      "emotion": "emotion dominante",',
                '      "narrativeRole": "role de la scene dans le recit"',
                '    }',
                '  ]',
                '}',
                'Règles :',
                '- reprends le découpage scène par scène décidé par la réunion, sans fusion ni compression arbitraire',
                '- si plusieurs scènes sont évoquées, conserve-les toutes dans l ordre',
                '- chaque scène doit rester dessinable et exploitable ensuite par la prod',
                '- chaque scène doit décrire explicitement premier plan, plan intermédiaire et arrière-plan',
                '- aucun fond studio, fond vide ou fond neutre : remets toujours l action dans un décor réel',
                '- la composition doit rester pensée pour un rendu vertical TikTok 9:16',
                '- camera et lighting doivent rester courts et concrets',
                ...(outputLockContext ? [outputLockContext] : []),
                ...(referenceImagesContext ? [referenceImagesContext] : []),
                visualSafetyDirective,
              ].join('\n'),
            },
            {
              role: 'user',
              content: [
                `Idée : ${this.idea}`,
                outputLockContext ? `\n${outputLockContext}` : '',
                referenceImagesContext ? `\n${referenceImagesContext}` : '',
                '',
                'Résumé et sections du brief :',
                JSON.stringify(compactSections, null, 2),
                '',
                'Transcript compacté de la réunion :',
                compactTranscript,
              ].join('\n'),
            },
          ],
          {
            model: this.meetingLlmModel ?? undefined,
            temperature: 0.2,
            maxTokens: 2200,
            timeoutMs: MEETING_LLM_TIMEOUT_MS,
            host: this.llmHost,
            headers: this.llmHeaders,
          },
        )
      },
      this.runId,
    )

    const payload = extractJsonObject(result.content)
    const sceneOutline = normalizeSceneOutline(payload.sceneOutline)
    validateSceneOutlineLock(sceneOutline, this.outputConfig)

    if (sceneOutline.length === 0) {
      throw new Error('sceneOutline vide après synthèse réunion')
    }

    return sceneOutline
  }
}
