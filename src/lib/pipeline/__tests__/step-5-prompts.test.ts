import { describe, expect, it } from 'vitest'
import { extractPromptEntriesFromLlmResponse } from '../steps/step-5-prompts'

describe('step-5-prompts — parsing robuste réponse LLM', () => {
  it('accepte le format { prompts: [...] }', () => {
    const result = extractPromptEntriesFromLlmResponse(JSON.stringify({
      prompts: [
        { sceneIndex: 1, subject: 'robot', action: 'walks' },
        { sceneIndex: 2, subject: 'soldier', action: 'looks' },
      ],
    }))

    expect(result).toHaveLength(2)
    expect(result[0].sceneIndex).toBe(1)
    expect(result[1].sceneIndex).toBe(2)
  })

  it('accepte un tableau JSON brut', () => {
    const result = extractPromptEntriesFromLlmResponse(JSON.stringify([
      { sceneIndex: '1', subject: 'robot' },
      { sceneIndex: 2, subject: 'soldier' },
    ]))

    expect(result).toHaveLength(2)
    expect(result[0].sceneIndex).toBe(1)
    expect(result[1].sceneIndex).toBe(2)
  })

  it('accepte un bloc markdown json', () => {
    const result = extractPromptEntriesFromLlmResponse("```json\n{\n  \"prompts\": [{ \"sceneIndex\": 6, \"subject\": \"tank\" }]\n}\n```")

    expect(result).toHaveLength(1)
    expect(result[0].sceneIndex).toBe(6)
  })

  it('ignore les entrées sans sceneIndex exploitable', () => {
    const result = extractPromptEntriesFromLlmResponse(JSON.stringify({
      prompts: [
        { subject: 'robot' },
        { sceneIndex: 3, subject: 'soldier' },
      ],
    }))

    expect(result).toHaveLength(1)
    expect(result[0].sceneIndex).toBe(3)
  })
})
