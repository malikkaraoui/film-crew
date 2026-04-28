import { describe, expect, it } from 'vitest'
import { buildMeetingVerdict, buildNextAction } from './bot-run-control'
import type { Run, RunStep } from '@/types/run'

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run_test',
    chainId: null,
    type: 'standard',
    idea: 'Idée test',
    template: null,
    status: 'pending',
    currentStep: 2,
    costEur: 0,
    lastHeartbeat: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function makeStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: 'step_test',
    runId: 'run_test',
    stepNumber: 2,
    stepName: 'Brainstorm',
    status: 'completed',
    providerUsed: null,
    costEur: 0,
    inputData: null,
    outputData: null,
    startedAt: null,
    completedAt: null,
    error: null,
    ...overrides,
  }
}

describe('buildMeetingVerdict', () => {
  it('retourne pass quand le brief réunion est exploitable', () => {
    const verdict = buildMeetingVerdict({
      brief: {
        summary: 'Résumé propre',
        sections: [
          { agent: 'sami', title: 'A', content: 'ok' },
          { agent: 'jade', title: 'B', content: 'ok' },
          { agent: 'remi', title: 'C', content: 'ok' },
          { agent: 'theo', title: 'D', content: 'ok' },
          { agent: 'nora', title: 'E', content: 'ok' },
        ],
        sceneOutline: [{}, {}],
      },
      traces: [{ agentName: 'sami', messageType: 'final', content: { text: 'ok' } }],
      step2: makeStep(),
    })

    expect(verdict.status).toBe('pass')
    expect(verdict.recommendedAction).toBe('approve_and_continue')
  })

  it('retourne fail quand le brief est trop pauvre', () => {
    const verdict = buildMeetingVerdict({
      brief: {
        summary: '',
        sections: [],
        sceneOutline: [],
      },
      traces: [],
      step2: makeStep(),
    })

    expect(verdict.status).toBe('fail')
    expect(verdict.recommendedAction).toBe('rerun_meeting')
  })
})

describe('buildNextAction', () => {
  it('suggère de lancer le step courant quand le run est pending', () => {
    const action = buildNextAction({
      run: makeRun({ status: 'pending', currentStep: 3 }),
      steps: [makeStep({ stepNumber: 3, stepName: 'JSON structuré', status: 'pending' })],
    })

    expect(action.kind).toBe('launch_current_step')
    expect(action.stepNumber).toBe(3)
  })

  it('suggère validation + lancement quand le run est en pause', () => {
    const action = buildNextAction({
      run: makeRun({ status: 'paused', currentStep: 2 }),
      steps: [makeStep({ stepNumber: 2, status: 'completed' })],
    })

    expect(action.kind).toBe('approve_and_launch_next_step')
    expect(action.stepNumber).toBe(3)
  })
})
