import { describe, expect, it } from 'vitest'
import { normalizeQuestionnaireAnswers, resolveTemplateId } from './bot-bootstrap'
import type { StyleTemplate } from '@/lib/templates/loader'

describe('resolveTemplateId', () => {
  const templates: StyleTemplate[] = [
    { id: 'cinematique', name: 'Cinématique', description: '', style: '', rhythm: '', transitions: [], subtitleStyle: '', agentTones: {}, promptPrefix: '' },
    { id: 'documentaire', name: 'Documentaire', description: '', style: '', rhythm: '', transitions: [], subtitleStyle: '', agentTones: {}, promptPrefix: '' },
  ]

  it('résout un template par id technique', () => {
    expect(resolveTemplateId('cinematique', templates)).toBe('cinematique')
  })

  it('résout un template par libellé humain accentué', () => {
    expect(resolveTemplateId('Cinématique', templates)).toBe('cinematique')
  })

  it('retourne null si aucun template ne matche', () => {
    expect(resolveTemplateId('inexistant', templates)).toBeNull()
  })
})

describe('normalizeQuestionnaireAnswers', () => {
  it('mappe des labels humains vers les valeurs canoniques', () => {
    const result = normalizeQuestionnaireAnswers({
      genre: 'Documentaire',
      duree: '30 – 60 secondes',
      audience: 'Grand public',
      ton: 'Dramatique',
      voixoff: 'Oui',
    })

    expect(result.errors).toEqual([])
    expect(result.answers).toEqual({
      genre: 'documentaire',
      duree: '30a60s',
      audience: 'grand_public',
      ton: 'dramatique',
      voixoff: 'oui',
    })
  })

  it('signale les questions et valeurs inconnues', () => {
    const result = normalizeQuestionnaireAnswers({
      inconnu: 'x',
      genre: 'Très bizarre',
    })

    expect(result.answers).toEqual({})
    expect(result.errors).toEqual([
      'Question inconnue : inconnu',
      'Valeur invalide pour genre : Très bizarre',
    ])
  })
})