import type { Session, Warning, BlockchainEvent } from '@staking-cc/shared';

export interface ElectionPhase {
  started: boolean;
  completed: boolean;
  timestamp: number | null;
}

export interface EraDetails {
  eraId: number;
  sessionStart: number;
  sessionEnd: number | null;
  startTime: number;
  endTime: number | null;
  sessions: Session[];
  prevSession?: Session | null; // Previous session (from previous era) for calculating first session's start block
  warnings: Warning[];
  events: BlockchainEvent[];
  isActive: boolean;
  duration: string;
  sessionCount: number;
  electionStartSessionIndex: number; // Array index of session where election starts
  electionPhases: {
    snapshot: ElectionPhase;
    signed: ElectionPhase;
    unsigned: ElectionPhase;
    export: ElectionPhase;
  };
  electionPhasesRaw?: any[]; // Raw election phase data from database
  // For completed eras only
  inflation?: {
    totalMinted: string; // DOTs minted
    validatorRewards: string; // Paid to validators
    treasury: string; // Sent to treasury
  };
  validatorCount?: number; // Total validators elected
}

// Legacy name for backward compatibility
export type MockEraDetails = EraDetails;

/**
 * Generate deterministic mock data for an era
 * Same eraId will always generate the same data
 */
export function generateMockEraData(eraId: number, currentEraId?: number): EraDetails {
  // Seeded random number generator for deterministic results
  const seed = eraId;
  let randomSeed = seed;
  const seededRandom = () => {
    randomSeed = (randomSeed * 9301 + 49297) % 233280;
    return randomSeed / 233280;
  };

  const isActive = currentEraId ? eraId === currentEraId : false;

  // Session range (6 sessions per era typically)
  const sessionStart = eraId * 6;
  const sessionEnd = isActive ? null : sessionStart + 5;
  const sessionCount = isActive ? Math.floor(seededRandom() * 3) + 4 : 6; // 4-6 sessions if active, 6 if ended

  // Timestamps (each era ~1 day, each session ~4 hours)
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const fourHours = 4 * 60 * 60 * 1000;
  const startTime = now - (currentEraId ? (currentEraId - eraId) * oneDay : eraId * oneDay);
  const endTime = isActive ? null : startTime + (sessionCount * fourHours);

  // Calculate duration
  const durationMs = (isActive ? now : endTime!) - startTime;
  const hours = durationMs / (1000 * 60 * 60);
  const duration = hours < 24
    ? `${hours.toFixed(1)} hrs`
    : `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;

  // Generate sessions
  const sessions: Session[] = [];
  for (let i = 0; i < sessionCount; i++) {
    const sessionId = sessionStart + i;
    const blockNumber = 11500000 + (sessionId * 100); // Approximate AH block numbers
    const activationTimestamp = startTime + (i * fourHours);
    const activeEraId = eraId;
    const plannedEraId = i === sessionCount - 1 && !isActive ? eraId + 1 : eraId;
    const validatorPointsTotal = Math.floor(seededRandom() * 200) + 600; // 600-800 points

    sessions.push({
      sessionId,
      blockNumber,
      activationTimestamp,
      activeEraId,
      plannedEraId,
      validatorPointsTotal,
    });
  }

  // Generate events
  const events: BlockchainEvent[] = [];

  for (let i = 0; i < sessionCount; i++) {
    const sessionId = sessionStart + i;
    const blockNumber = 11500000 + (sessionId * 100);

    // SessionReportReceived for each session
    events.push({
      id: blockNumber * 1000 + 10,
      blockNumber,
      eventId: `${blockNumber}-10`,
      eventType: 'StakingRcClient.SessionReportReceived',
      data: JSON.stringify({
        endIndex: sessionId,
        validatorPointsTotal: sessions[i].validatorPointsTotal,
        activationTimestamp: i === 0 ? startTime : null,
      }),
    });

    // NewSession event
    events.push({
      id: blockNumber * 1000 + 5,
      blockNumber,
      eventId: `${blockNumber}-5`,
      eventType: 'Session.NewSession',
      data: JSON.stringify({
        sessionIndex: sessionId,
      }),
    });

    // Occasional EraPaid (first session)
    if (i === 0 && eraId > 0) {
      events.push({
        id: blockNumber * 1000 + 15,
        blockNumber,
        eventId: `${blockNumber}-15`,
        eventType: 'Staking.EraPaid',
        data: JSON.stringify({
          eraIndex: eraId - 1,
          validatorPayout: '1234567890123456789',
          remainder: '987654321098765432',
        }),
      });
    }

    // Election events (last session of previous era)
    if (i === sessionCount - 1 && seededRandom() > 0.3) {
      events.push({
        id: (blockNumber + 50) * 1000 + 20,
        blockNumber: blockNumber + 50,
        eventId: `${blockNumber + 50}-20`,
        eventType: 'MultiBlockElection.SignedPhaseStarted',
        data: JSON.stringify({
          round: 1,
        }),
      });
    }
  }

  // Sort events by block number
  events.sort((a, b) => b.blockNumber - a.blockNumber);

  // No mock warnings - warnings come from real blockchain analysis only
  const warnings: Warning[] = [];

  // Election data - election starts in last session (or second-to-last for active eras)
  const electionStartSessionIndex = isActive && sessionCount > 1 ? sessionCount - 2 : sessionCount - 1;
  const electionSession = sessions[electionStartSessionIndex];
  const electionStartTime = electionSession.activationTimestamp || startTime + (electionStartSessionIndex * fourHours);

  // Generate election phase progression
  // For completed eras: all phases complete
  // For active eras: phases progress based on current time
  const electionPhases = {
    snapshot: {
      started: !isActive || electionStartSessionIndex < sessionCount - 1,
      completed: !isActive,
      timestamp: !isActive ? electionStartTime : null,
    },
    signed: {
      started: !isActive,
      completed: !isActive,
      timestamp: !isActive ? electionStartTime + (30 * 60 * 1000) : null, // 30 min after snapshot
    },
    unsigned: {
      started: !isActive,
      completed: !isActive,
      timestamp: !isActive ? electionStartTime + (60 * 60 * 1000) : null, // 1 hour after snapshot
    },
    export: {
      started: !isActive,
      completed: !isActive,
      timestamp: !isActive ? electionStartTime + (90 * 60 * 1000) : null, // 1.5 hours after snapshot
    },
  };

  // Inflation and validator data (only for completed eras)
  let inflation = undefined;
  let validatorCount = undefined;

  if (!isActive) {
    // Generate realistic inflation numbers in Planck units (1 KSM = 10^12 Planck)
    // For Kusama: typically 800-900 KSM per era
    const baseKSM = 800 + Math.floor(seededRandom() * 100); // 800-900 KSM
    const basePlanck = BigInt(baseKSM) * BigInt(10 ** 12);

    const validatorRewardsPct = 0.6 + seededRandom() * 0.1; // 60-70% to validators
    const validatorRewardsPlanck = (basePlanck * BigInt(Math.floor(validatorRewardsPct * 100))) / BigInt(100);
    const treasuryPlanck = basePlanck - validatorRewardsPlanck;

    inflation = {
      totalMinted: basePlanck.toString(),
      validatorRewards: validatorRewardsPlanck.toString(),
      treasury: treasuryPlanck.toString(),
    };

    // Validator count (typically ~1000 on Kusama, ~300 on Polkadot)
    // For Kusama: around 950-1050 validators
    validatorCount = 950 + Math.floor(seededRandom() * 100); // 950-1050
  }

  return {
    eraId,
    sessionStart,
    sessionEnd,
    startTime,
    endTime,
    sessions,
    warnings,
    events,
    isActive,
    duration,
    sessionCount,
    electionStartSessionIndex,
    electionPhases,
    inflation,
    validatorCount,
  };
}
