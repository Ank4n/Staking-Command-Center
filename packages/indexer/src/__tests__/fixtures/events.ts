/**
 * Mock blockchain event fixtures
 * Simulates real polkadot-js event structures
 */

/**
 * Creates a mock polkadot-js event for SessionReportReceived
 */
export function createMockSessionReportReceivedEvent(params: {
  endIndex: number;
  validatorPointsCounts: number;
  activationTimestamp?: { timestamp: number; eraId: number } | null;
  leftover?: boolean;
}) {
  return {
    section: 'stakingRcClient',
    method: 'SessionReportReceived',
    data: {
      endIndex: createMockCodec(params.endIndex),
      validatorPointsCounts: createMockCodec(params.validatorPointsCounts),
      activationTimestamp: params.activationTimestamp
        ? createMockOption([
            createMockCodec(params.activationTimestamp.timestamp),
            createMockCodec(params.activationTimestamp.eraId),
          ])
        : createMockOption(null),
      leftover: params.leftover ?? false,
    },
    toHuman: () => ({
      method: 'SessionReportReceived',
      section: 'stakingRcClient',
      index: '0x5400',
      data: {
        endIndex: params.endIndex.toLocaleString(),
        validatorPointsCounts: params.validatorPointsCounts.toString(),
        activationTimestamp: params.activationTimestamp
          ? [params.activationTimestamp.timestamp.toLocaleString(), params.activationTimestamp.eraId.toString()]
          : null,
        leftover: params.leftover ?? false,
      },
    }),
    toJSON: () => ({
      endIndex: params.endIndex,
      validatorPointsCounts: params.validatorPointsCounts,
      activationTimestamp: params.activationTimestamp,
      leftover: params.leftover ?? false,
    }),
  };
}

/**
 * Creates a mock polkadot-js event for EraPaid
 */
export function createMockEraPaidEvent(params: {
  eraIndex: number;
  validatorPayout: string;
  remainder: string;
}) {
  return {
    section: 'staking',
    method: 'EraPaid',
    data: {
      eraIndex: createMockCodec(params.eraIndex),
      validatorPayout: createMockCodec(params.validatorPayout),
      remainder: createMockCodec(params.remainder),
    },
    toHuman: () => ({
      method: 'EraPaid',
      section: 'staking',
      index: '0x1900',
      data: {
        eraIndex: params.eraIndex.toString(),
        validatorPayout: params.validatorPayout,
        remainder: params.remainder,
      },
    }),
    toJSON: () => ({
      eraIndex: params.eraIndex,
      validatorPayout: params.validatorPayout,
      remainder: params.remainder,
    }),
  };
}

/**
 * Creates a mock polkadot-js event for PhaseTransitioned
 */
export function createMockPhaseTransitionedEvent(params: {
  from: string;
  to: string;
}) {
  return {
    section: 'multiBlockElection',
    method: 'PhaseTransitioned',
    data: {
      from: createMockPhase(params.from),
      to: createMockPhase(params.to),
    },
    toHuman: () => ({
      method: 'PhaseTransitioned',
      section: 'multiBlockElection',
      index: '0x5200',
      data: {
        from: params.from,
        to: params.to,
      },
    }),
    toJSON: () => ({
      from: params.from,
      to: params.to,
    }),
  };
}

/**
 * Helper to create mock codec (number/string wrapper with conversion methods)
 */
function createMockCodec(value: number | string) {
  return {
    toNumber: () => (typeof value === 'number' ? value : parseInt(value)),
    toString: () => String(value),
    toJSON: () => value,
    toHuman: () => String(value),
  };
}

/**
 * Helper to create mock Option type
 */
function createMockOption(value: any) {
  if (value === null || value === undefined) {
    return {
      isSome: false,
      isNone: true,
      isEmpty: true,
      unwrap: () => {
        throw new Error('Cannot unwrap None');
      },
    };
  }

  return {
    isSome: true,
    isNone: false,
    isEmpty: false,
    unwrap: () => value,
  };
}

/**
 * Helper to create mock phase enum
 */
function createMockPhase(phase: string) {
  return {
    type: phase,
    toString: () => phase,
    toJSON: () => phase,
  };
}

/**
 * Creates a mock polkadot-js event for MultiBlockElectionSigned events
 * Supports: Registered, Rewarded, Slashed, Ejected, Discarded, Bailed
 */
export function createMockElectionScoreEvent(params: {
  eventName: string;
  round: number;
  submitter: string;
  score?: {
    minimalStake: string;
    sumStake: string;
    sumStakeSquared: string;
  };
  useArrayFormat?: boolean; // If true, use array format for data (as stored in DB)
}) {
  const eventName = params.eventName.toLowerCase();

  // For Registered event, include score data
  if (eventName === 'registered') {
    if (params.useArrayFormat) {
      // Array format: [round, submitter, score]
      return {
        section: 'multiBlockElectionSigned',
        method: 'Registered',
        data: [
          createMockCodec(params.round),
          { toString: () => params.submitter },
          params.score ? {
            minimalStake: params.score.minimalStake,
            sumStake: params.score.sumStake,
            sumStakeSquared: params.score.sumStakeSquared,
          } : undefined,
        ],
        toHuman: () => ({
          method: 'Registered',
          section: 'multiBlockElectionSigned',
          data: [params.round, params.submitter, params.score],
        }),
        toJSON: () => ({
          round: params.round,
          submitter: params.submitter,
          score: params.score,
        }),
      };
    }

    // Named property format
    return {
      section: 'multiBlockElectionSigned',
      method: 'Registered',
      data: {
        round: createMockCodec(params.round),
        submission: {
          who: { toString: () => params.submitter },
          score: params.score ? {
            minimalStake: params.score.minimalStake,
            sumStake: params.score.sumStake,
            sumStakeSquared: params.score.sumStakeSquared,
          } : undefined,
        },
      },
      toHuman: () => ({
        method: 'Registered',
        section: 'multiBlockElectionSigned',
        data: {
          round: params.round,
          submission: {
            who: params.submitter,
            score: params.score,
          },
        },
      }),
      toJSON: () => ({
        round: params.round,
        submission: {
          who: params.submitter,
          score: params.score,
        },
      }),
    };
  }

  // For other events (Rewarded, Slashed, etc.), format is: (round, submitter, ...)
  if (params.useArrayFormat) {
    // Array format: [round, submitter, ...]
    return {
      section: 'multiBlockElectionSigned',
      method: params.eventName,
      data: [
        createMockCodec(params.round),
        { toString: () => params.submitter },
      ],
      toHuman: () => ({
        method: params.eventName,
        section: 'multiBlockElectionSigned',
        data: [params.round, params.submitter],
      }),
      toJSON: () => ({
        round: params.round,
        submitter: params.submitter,
      }),
    };
  }

  // Named property format
  return {
    section: 'multiBlockElectionSigned',
    method: params.eventName,
    data: {
      round: createMockCodec(params.round),
      submitter: { toString: () => params.submitter },
    },
    toHuman: () => ({
      method: params.eventName,
      section: 'multiBlockElectionSigned',
      data: {
        round: params.round,
        submitter: params.submitter,
      },
    }),
    toJSON: () => ({
      round: params.round,
      submitter: params.submitter,
    }),
  };
}

/**
 * Creates a mock API instance at a specific block
 */
export function createMockApiAt(overrides: {
  activeEra?: { index: number };
  currentEra?: number;
  validatorCount?: number;
  counterForValidators?: number;
  counterForNominators?: number;
  electableStashes?: string[];
} = {}) {
  return {
    query: {
      staking: {
        activeEra: jest.fn().mockResolvedValue(
          overrides.activeEra
            ? {
                isEmpty: false,
                toJSON: () => overrides.activeEra,
              }
            : { isEmpty: true }
        ),
        currentEra: jest.fn().mockResolvedValue(
          overrides.currentEra !== undefined
            ? {
                isEmpty: false,
                toJSON: () => overrides.currentEra,
              }
            : { isEmpty: true }
        ),
        validatorCount: jest.fn().mockResolvedValue(
          overrides.validatorCount !== undefined
            ? createMockCodec(overrides.validatorCount)
            : null
        ),
        counterForValidators: jest.fn().mockResolvedValue(
          overrides.counterForValidators !== undefined
            ? createMockCodec(overrides.counterForValidators)
            : null
        ),
        counterForNominators: jest.fn().mockResolvedValue(
          overrides.counterForNominators !== undefined
            ? createMockCodec(overrides.counterForNominators)
            : null
        ),
        electableStashes: jest.fn().mockResolvedValue(
          overrides.electableStashes
            ? {
                toJSON: () => overrides.electableStashes,
              }
            : null
        ),
      },
      multiBlockElection: {
        round: jest.fn().mockResolvedValue(createMockCodec(1)),
      },
      multiBlockElectionSigned: {
        sortedScores: jest.fn().mockResolvedValue({ toJSON: () => [] }),
      },
      multiBlockElectionVerifier: {
        minimumScore: jest.fn().mockResolvedValue({ isEmpty: true }),
        queuedSolutionScore: jest.fn().mockResolvedValue({ isEmpty: true }),
      },
      system: {
        events: jest.fn().mockResolvedValue([]),
      },
      timestamp: {
        now: jest.fn().mockResolvedValue(createMockCodec(Date.now())),
      },
    },
  };
}
