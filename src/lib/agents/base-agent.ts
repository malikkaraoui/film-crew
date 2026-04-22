import type { AgentProfile, AgentMessage } from '@/types/agent'
import type { LLMProvider, LLMMessage } from '@/lib/providers/types'
import { registry } from '@/lib/providers/registry'
import { executeWithFailover } from '@/lib/providers/failover'
import { createProviderLog } from '@/lib/db/queries/logs'
import { logger } from '@/lib/logger'

export type AgentSpeakOptions = {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  resetHistory?: boolean
}

export class BaseAgent {
  profile: AgentProfile
  private conversationHistory: LLMMessage[] = []

  constructor(profile: AgentProfile) {
    this.profile = profile
    this.conversationHistory = [
      { role: 'system', content: profile.systemPrompt },
    ]
  }

  /**
   * Fait parler l'agent dans le contexte de la réunion.
   * Ajoute le contexte au fil de conversation et retourne la réponse.
   */
  async speak(
    context: string,
    runId: string,
    opts: AgentSpeakOptions = {},
  ): Promise<AgentMessage> {
    if (opts.resetHistory) {
      this.resetConversation()
    }

    this.conversationHistory.push({ role: 'user', content: context })

    const start = Date.now()

    const { result, provider } = await executeWithFailover(
      'llm',
      async (p) => {
        const llm = p as LLMProvider
        return llm.chat(this.conversationHistory, {
          temperature: opts.temperature ?? 0.8,
          maxTokens: opts.maxTokens ?? 512,
          timeoutMs: opts.timeoutMs,
        })
      },
      runId,
    )

    const latencyMs = Date.now() - start

    // Ajouter la réponse à l'historique
    this.conversationHistory.push({ role: 'assistant', content: result.content })

    // Logger dans provider_log
    await createProviderLog({
      id: crypto.randomUUID(),
      runId,
      provider: provider.name,
      endpoint: 'llm/chat',
      requestData: { agent: this.profile.role, contextLength: context.length },
      responseStatus: 200,
      latencyMs,
      costEur: result.costEur,
    }).catch(() => {})

    logger.info({
      event: 'agent_spoke',
      agent: this.profile.role,
      runId,
      provider: provider.name,
      tokens: result.tokens,
      latencyMs,
      costEur: result.costEur,
    })

    return {
      id: crypto.randomUUID(),
      runId,
      agentName: this.profile.role,
      messageType: 'dialogue',
      content: result.content,
      metadata: {
        model: result.model,
        latencyMs,
        costEur: result.costEur,
      },
      createdAt: new Date().toISOString(),
    }
  }

  /**
   * Produit la section du brief assignée à cet agent.
   */
  async writeBriefSection(
    meetingTranscript: string,
    runId: string,
    opts: Pick<AgentSpeakOptions, 'timeoutMs'> = {},
  ): Promise<AgentMessage> {
    // Réinitialiser l'historique pour rester dans la fenêtre de contexte.
    // Le transcript complet est passé directement dans le prompt.
    this.resetConversation()

    const prompt = `Voici le transcript de la réunion de production :\n\n${meetingTranscript}\n\nÉcris ta section du brief. Tu es responsable de : ${this.profile.briefSection}.\n\nRédige un texte structuré et concis (10-20 lignes), directement utilisable pour la suite du pipeline.`

    const message = await this.speak(prompt, runId, {
      resetHistory: true,
      timeoutMs: opts.timeoutMs,
    })
    message.messageType = 'brief_section'
    return message
  }

  resetConversation(): void {
    this.conversationHistory = [
      { role: 'system', content: this.profile.systemPrompt },
    ]
  }
}
