# Tracking Requirements

This document outlines all the blockchain events and storage items that need to be monitored for the Staking Command Center.

## Events to Monitor

### Relay Chain Events
- `session.NewSession` - New session started
- `staking.EraPaid` - Era rewards distributed
- `staking.Rewarded` - Individual reward events
- `staking.Slashed` - Slashing events
- `staking.StakingElectionFailed` - Election failures
- `staking.StakersElected` - New validator set elected
- `staking.Bonded` / `staking.Unbonded` - Staking changes
- `electionProviderMultiPhase.PhaseTransitioned` - Election phase changes
- `electionProviderMultiPhase.SolutionStored` - Solution submitted
- `electionProviderMultiPhase.ElectionFinalized` - Election complete

### Asset Hub Events
- `ahClient.SessionChanged` - Session change reported to AH
- `ahClient.ValidatorPointsUpdated` - Validator points received
- All events from `event.section.event.method` format for general tracking

## Storage Items to Query

### Relay Chain (RC)

#### Session Module
- `session.currentIndex` - Current session index
- `session.queuedKeys` - Queued validators for next session

#### Staking Module
- `staking.activeEra` - Current active era info (index, start time)
- `staking.currentEra` - Current era index
- `staking.erasStartSessionIndex` - Session index when era started
- `staking.forceEra` - Forcing mode (ForceNone, ForceNew, ForceAlways)
- `staking.validatorCount` - Desired number of validators
- `staking.validatorSlashInEra` - Slash records per era
- `staking.nominatorSlashInEra` - Nominator slash records
- `staking.erasRewardPoints` - Validator points per era
- `staking.erasValidatorReward` - Total reward for era
- `staking.claimedRewards` - Claimed reward pages per validator per era

#### Election Provider Multi Phase
- `electionProviderMultiPhase.currentPhase` - Current election phase (Off, Signed, Unsigned, Emergency)
- `electionProviderMultiPhase.round` - Current election round number
- `electionProviderMultiPhase.signedSubmissionIndices` - List of signed submissions
- `electionProviderMultiPhase.queuedSolution` - Queued solution score

#### Bags List (for nominators)
- `bagsList.listNodes` - All nodes in the bags list
- `bagsList.counterForListNodes` - Total count of nodes

### Asset Hub (AH)

#### Staking Module (on AH)
- `staking.currentEra` - Current era on AH
- `staking.activeEra` - Active era info on AH
- `staking.erasStartSessionIndex` - Era start session
- `staking.bondedEras` - Historical range of bonded eras
- `staking.unprunedEras` - Count of eras not yet pruned
- `staking.forceEra` - Forcing status on AH
- `staking.validatorCount` - Validator count
- `staking.counterForValidators` - Total validators
- `staking.counterForNominators` - Total nominators
- `staking.minNominatorBond` - Minimum bond for nominators
- `staking.minValidatorBond` - Minimum bond for validators
- `staking.minActiveStake` - Minimum active stake

#### RC Client Module (Relay Chain Client on AH)
- `ahClient.lastSessionReportEndIndex` - Last reported session end
- `ahClient.lastSessionIndex` - Last session index received
- `ahClient.eraDepthInSessions` - How many sessions per era
- `ahClient.stakingMode` - Mode (Passive, Buffered, Active)
- `ahClient.nextActiveValidatorId` - Next validator ID
- `ahClient.validatorPoints` - Points for queued validator set
- `ahClient.queuedValidatorSetId` - ID of queued validator set
- `ahClient.queuedValidatorsCount` - Count of queued validators

#### Election/Multiblock Module
- `electionProviderMultiPhase.currentPhase` - Current phase on AH
- `electionProviderMultiPhase.round` - Election round
- `electionProviderMultiPhase.signedSubmissionIndices` - Signed submissions
- `electionProviderMultiPhase.queuedSolution` - Queued solution
- `electionProviderMultiPhase.snapshot` - Snapshot metadata
- `electionProviderMultiPhase.snapshotMetadata` - Snapshot page info

#### Bags List
- `bagsList.counterForListNodes` - Count of all nodes
- `bagsList.locked` - Lock status

### General Chain Data (both RC and AH)
- Current finalized block number
- Block timestamps
- Chain metadata

## Derived Metrics to Calculate

### Era Metrics
- Era duration (actual vs expected)
- Session progress within era
- Time until next era
- Eras requiring reward claiming

### Election Metrics
- Time in current phase
- Blocks remaining in signed phase
- Number of submissions
- Validator set changes

### Reward Metrics
- Total unclaimed rewards by era
- Unclaimed pages per validator
- Nominators with unclaimed rewards
- Total inflation per era

### Warning Conditions
- Era duration anomalies (too short/long)
- Missing session changes
- Election phase stuck
- Unexpected events
- Validator set not sent to RC
- Migration issues (storage counts)
