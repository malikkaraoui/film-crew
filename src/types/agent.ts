export type AgentRole =
  | 'mia'      // Cheffe de projet / Productrice
  | 'lenny'    // Scénariste
  | 'laura'    // Cadreuse
  | 'nael'     // Metteur en scène
  | 'emilie'   // Habillage / Brand Kit
  | 'nico'     // Lumière
  | 'sami'     // Dialoguiste
  | 'jade'     // Sound Designer
  | 'remi'     // Superviseur Musique
  | 'theo'     // Éditeur Rythme

export type AgentProfile = {
  role: AgentRole
  displayName: string
  title: string
  color: string
  systemPrompt: string
  briefSection: string // La section du brief que cet agent remplit
}

export type AgentMessage = {
  id: string
  runId: string
  agentName: string
  messageType: 'dialogue' | 'web_search' | 'validation' | 'rejection' | 'brief_section'
  content: string
  metadata?: {
    model?: string
    latencyMs?: number
    costEur?: number
    searchQuery?: string
    searchResults?: string[]
  }
  createdAt: string
}

export type MeetingSceneOutlineItem = {
  index: number
  title: string
  description: string
  dialogue: string
  camera: string
  lighting: string
  duration_s: number
  foreground?: string
  midground?: string
  background?: string
  emotion?: string
  narrativeRole?: string
}

export type MeetingBrief = {
  runId: string
  idea: string
  sections: {
    agent: AgentRole
    title: string
    content: string
  }[]
  summary: string
  sceneOutline?: MeetingSceneOutlineItem[]
  estimatedBudget: string
  validatedBy: string
  createdAt: string
}
