import { BaseAgent, type AgentSpeakOptions } from './base-agent'
import { AGENT_PROFILES, MEETING_ORDER } from './profiles'
import { createAgentTrace } from '@/lib/db/queries/traces'
import { updateRunCost } from '@/lib/db/queries/runs'
import { logger } from '@/lib/logger'
import type { AgentMessage, AgentRole, MeetingBrief } from '@/types/agent'
import type { StyleTemplate } from '@/lib/templates/loader'

const MEETING_TRANSCRIPT_MAX_CHARS = 2000
const MEETING_LLM_TIMEOUT_MS = 180_000

function compactTranscriptForPrompt(transcript: string, maxChars = MEETING_TRANSCRIPT_MAX_CHARS): string {
  if (transcript.length <= maxChars) return transcript

  const headChars = Math.floor(maxChars * 0.4)
  const tailChars = maxChars - headChars
  const head = transcript.slice(0, headChars)
  const tail = transcript.slice(-tailChars)

  return `${head}\n\n[... transcript tronqué pour rester lisible et local-first ...]\n\n${tail}`
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
  private onMessage?: (message: AgentMessage) => void

  constructor(opts: {
    runId: string
    idea: string
    brandKit?: string | null
    template?: StyleTemplate | null
    onMessage?: (message: AgentMessage) => void
  }) {
    this.runId = opts.runId
    this.idea = opts.idea
    this.brandKit = opts.brandKit ?? null
    this.template = opts.template ?? null
    this.onMessage = opts.onMessage

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
    logger.info({ event: 'meeting_start', runId: this.runId, idea: this.idea })

    let totalCost = 0

    // Contexte template injecté dans toute la réunion (10D)
    const templateContext = this.template
      ? `\n\nTemplate de style : ${this.template.name} — ${this.template.description}\nRythme : ${this.template.rhythm}\nTransitions : ${this.template.transitions.join(', ')}`
      : ''

    // Phase 1 : Mia ouvre la réunion
    const openingContext = `Nouvelle réunion de production. L'idée du client est : "${this.idea}".${this.brandKit ? `\n\nBrand Kit de la chaîne :\n${this.brandKit}` : ''}${templateContext}\n\nPrésente le brief à l'équipe et lance la discussion. Sois directe et motivante.`

    const opening = await this.agentSpeak('mia', openingContext)
    totalCost += opening.metadata?.costEur ?? 0

    // Phase 2 : Tour de table — chaque agent réagit
    for (const role of MEETING_ORDER.slice(1, -1)) {
      const transcript = this.getPromptTranscript()
      // Ton spécifique à cet agent selon le template (10D)
      const agentTone = this.template?.agentTones?.[role]
      const toneContext = agentTone ? `\n[Ton attendu dans ce style ${this.template!.name} : ${agentTone}]` : ''
      const context = `Voici la discussion jusqu'ici :\n\n${transcript}\n\nC'est ton tour de parler. Donne ton avis de ${AGENT_PROFILES[role].title} sur cette idée. Sois concis (3-5 phrases). Challenge les idées des autres si nécessaire.${toneContext}`

      const msg = await this.agentSpeak(role, context, {
        resetHistory: true,
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
      })
      totalCost += msg.metadata?.costEur ?? 0
    }

    // Phase 3 : Discussion libre — 2 rounds
    for (let round = 0; round < 2; round++) {
      for (const role of ['lenny', 'laura', 'nael'] as AgentRole[]) {
        const transcript = this.getPromptTranscript()
        const context = `Discussion en cours (round ${round + 2}) :\n\n${transcript}\n\nRéagis aux dernières interventions. Affine, challenge ou complète. 2-3 phrases max.`

        const msg = await this.agentSpeak(role, context, {
          resetHistory: true,
          timeoutMs: MEETING_LLM_TIMEOUT_MS,
        })
        totalCost += msg.metadata?.costEur ?? 0
      }
    }

    // Phase 4 : Emilie vérifie la cohérence Brand Kit
    const brandCheckContext = `Voici toute la discussion :\n\n${this.getPromptTranscript()}\n\n${this.brandKit ? `Brand Kit :\n${this.brandKit}\n\n` : ''}Vérifie la cohérence de toutes les propositions avec le Brand Kit. Valide ce qui est conforme, rejette ce qui ne l'est pas en expliquant pourquoi et en proposant une correction.`

    const brandCheck = await this.agentSpeak('emilie', brandCheckContext, {
      resetHistory: true,
      timeoutMs: MEETING_LLM_TIMEOUT_MS,
    })
    brandCheck.messageType = 'validation'
    totalCost += brandCheck.metadata?.costEur ?? 0

    // Phase 5 : Chaque agent rédige sa section du brief
    const fullTranscript = this.formatTranscript()
    const transcript = compactTranscriptForPrompt(fullTranscript)
    logger.info({ event: 'meeting_transcript', runId: this.runId, fullLength: fullTranscript.length, truncatedLength: transcript.length })
    const briefSections: MeetingBrief['sections'] = []

    for (const role of ['lenny', 'laura', 'nael', 'emilie', 'nico'] as AgentRole[]) {
      const agent = this.agents.get(role)!
      const section = await agent.writeBriefSection(transcript, this.runId, {
        timeoutMs: MEETING_LLM_TIMEOUT_MS,
      })
      await this.recordMessage(section)
      totalCost += section.metadata?.costEur ?? 0

      briefSections.push({
        agent: role,
        title: AGENT_PROFILES[role].briefSection,
        content: section.content,
      })
    }

    // Phase 6 : Mia conclut — utiliser le transcript tronqué
    const closingContext = `Voici la réunion et les sections du brief :\n\n${transcript}\n\nConclus la réunion. Produis :\n1. Un résumé exécutif (5-7 lignes)\n2. Une estimation budget (en postes de coûts)\n3. Ta validation finale\n\nSois directe et structurée.`

    const closing = await this.agentSpeak('mia', closingContext, {
      resetHistory: true,
      timeoutMs: MEETING_LLM_TIMEOUT_MS,
    })
    totalCost += closing.metadata?.costEur ?? 0

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
    const message = await agent.speak(context, this.runId, opts)
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
}
