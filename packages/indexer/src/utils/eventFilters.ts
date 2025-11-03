/**
 * Event filtering based on CLAUDE.md Events Tracking section
 * Only track specified events and ignore all others
 */

// RC (Relay Chain) tracked events
const RC_TRACKED_EVENTS = [
  { pallet: 'staking', events: ['EraPaid', 'SlashReported', 'Slashed', 'StakersElected', 'StakingElectionFailed'] },
  { pallet: 'session', events: ['NewQueued', 'NewSession'] },
  { pallet: 'stakingAhClient', events: '*' }, // All events from this pallet
];

// AH (Asset Hub) tracked events
const AH_TRACKED_EVENTS = [
  { pallet: 'staking', events: ['EraPaid', 'EraPruned', 'ForceEra', 'PagedElectionProceeded', 'StakersElected', 'StakingElectionFailed', 'Unexpected'] },
  { pallet: 'stakingRcClient', events: '*' }, // All events from this pallet
  { pallet: 'multiBlockElection', events: '*' }, // All events from this pallet
  { pallet: 'multiBlockElectionSigned', events: '*' }, // All events from this pallet
  { pallet: 'multiBlockElectionVerifier', events: '*' }, // All events from this pallet
];

// Wildcard patterns for staking::Offence* and staking::Slash*
const AH_STAKING_WILDCARDS = ['Offence', 'Slash'];

/**
 * Check if an event should be tracked on Relay Chain
 */
export function shouldTrackEventRC(eventType: string): boolean {
  const { pallet, eventName } = splitEventType(eventType);
  const normalizedPallet = pallet.toLowerCase();

  for (const config of RC_TRACKED_EVENTS) {
    const configPallet = config.pallet.toLowerCase();

    if (normalizedPallet === configPallet) {
      // Check if all events from this pallet should be tracked
      if (config.events === '*') {
        return true;
      }

      // Check if specific event is in the list
      if (Array.isArray(config.events)) {
        return config.events.includes(eventName);
      }
    }
  }

  return false;
}

/**
 * Check if an event should be tracked on Asset Hub
 */
export function shouldTrackEventAH(eventType: string): boolean {
  const { pallet, eventName } = splitEventType(eventType);
  const normalizedPallet = pallet.toLowerCase();

  for (const config of AH_TRACKED_EVENTS) {
    const configPallet = config.pallet.toLowerCase();

    if (normalizedPallet === configPallet) {
      // Check if all events from this pallet should be tracked
      if (config.events === '*') {
        return true;
      }

      // Check if specific event is in the list
      if (Array.isArray(config.events)) {
        return config.events.includes(eventName);
      }
    }
  }

  // Check wildcard patterns for staking pallet
  if (normalizedPallet === 'staking') {
    for (const wildcard of AH_STAKING_WILDCARDS) {
      if (eventName.startsWith(wildcard)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Split event type string into pallet and event name
 * Example: "stakingRelaychainClient.SessionReportReceived" -> { pallet: "stakingRelaychainClient", eventName: "SessionReportReceived" }
 */
export function splitEventType(eventType: string): { pallet: string; eventName: string } {
  const parts = eventType.split('.');
  if (parts.length !== 2) {
    throw new Error(`Invalid event type format: ${eventType}`);
  }
  return {
    pallet: parts[0],
    eventName: parts[1],
  };
}
