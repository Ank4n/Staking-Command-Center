/**
 * Helper to format large numbers with scientific notation (e.g., 1.2e6)
 * Converts from Planck units to tokens and applies scientific notation
 *
 * @param planckStr - The Planck value as string (may contain commas)
 * @param decimals - Number of decimal places (default 10 for DOT/Asset Hub)
 * @returns Formatted string with scientific notation
 */
export function formatLargeNumber(planckStr: string, decimals: number = 10): string {
  const planck = BigInt(planckStr.replace(/,/g, ''));
  const tokens = Number(planck) / Math.pow(10, decimals);

  // Handle zero case to prevent -Infinity from Math.log10(0)
  if (tokens === 0) return '0';

  // Use scientific notation for cleaner display
  const exp = Math.floor(Math.log10(tokens));
  const mantissa = tokens / Math.pow(10, exp);

  // For very small numbers or simple cases, just show the number
  if (tokens < 1000) return tokens.toFixed(1);

  // Otherwise show in eX format (e.g., 1.2e6)
  return `${mantissa.toFixed(1)}e${exp}`;
}

/**
 * Format blockchain event data based on event type
 * Extracts meaningful information from event data and presents it in human-readable format
 *
 * @param eventType - Full event type (e.g., "stakingRcClient.SessionReportReceived")
 * @param eventData - Event data as JSON string
 * @returns Formatted event data string
 */
export function formatEventData(eventType: string, eventData: string): string {
  try {
    const parsedEvent = JSON.parse(eventData);
    // event.toHuman() returns {method, section, index, data}, so extract the actual data
    const data = parsedEvent.data || parsedEvent;

    // SessionReportReceived - show ended session primarily
    if (eventType.includes('SessionReportReceived')) {
      const parts: string[] = [];
      if (data.endIndex) parts.push(`Ended Session: ${data.endIndex}`);
      if (data.activationTimestamp && Array.isArray(data.activationTimestamp)) {
        parts.push(`New Era: ${data.activationTimestamp[1]}`);
      }
      if (data.validatorPointsCounts) parts.push(`Validators: ${data.validatorPointsCounts}`);
      return parts.join(' | ');
    }

    // EraPaid
    if (eventType.includes('EraPaid')) {
      const parts: string[] = [];
      if (data.eraIndex) parts.push(`Era: ${data.eraIndex}`);
      if (data.validatorPayout) {
        const planck = BigInt(data.validatorPayout.replace(/,/g, ''));
        const tokens = Number(planck) / 1e10;
        parts.push(`Validators: ${tokens.toLocaleString(undefined, {maximumFractionDigits: 2})} DOT`);
      }
      if (data.remainder) {
        const planck = BigInt(data.remainder.replace(/,/g, ''));
        const tokens = Number(planck) / 1e10;
        parts.push(`Treasury: ${tokens.toLocaleString(undefined, {maximumFractionDigits: 2})} DOT`);
      }
      return parts.join(' | ');
    }

    // EraPruned
    if (eventType.includes('EraPruned')) {
      if (data.index) return `Era: ${data.index}`;
    }

    // PhaseTransitioned - handle both string and object phases
    if (eventType.includes('PhaseTransitioned')) {
      const getPhase = (phaseData: any): string => {
        if (!phaseData) return '?';
        // Handle string phase like "Off"
        if (typeof phaseData === 'string') return phaseData;
        // Handle object phase like {"Snapshot": "32"}
        if (typeof phaseData === 'object' && phaseData !== null) {
          const keys = Object.keys(phaseData);
          if (keys.length > 0) return keys[0];
        }
        return '?';
      };
      const from = getPhase(data.from);
      const to = getPhase(data.to);
      return `${from} → ${to}`;
    }

    // Registered (multiBlockElectionSigned.Registered) - show election score
    if (eventType.includes('Registered')) {
      // Data is array: [round, address, score_object]
      if (Array.isArray(data) && data.length >= 3) {
        const round = data[0];
        const score = data[2];
        const parts: string[] = [];
        parts.push(`R${round}`);

        if (score) {
          if (score.minimalStake) {
            parts.push(`Min: ${formatLargeNumber(score.minimalStake)}`);
          }
          if (score.sumStake) {
            parts.push(`Sum: ${formatLargeNumber(score.sumStake)}`);
          }
          if (score.sumStakeSquared) {
            parts.push(`SumSq: ${formatLargeNumber(score.sumStakeSquared)}`);
          }
        }

        return parts.join(' | ');
      }
    }

    // Rewarded (multiBlockElectionSigned.Rewarded)
    if (eventType.includes('Rewarded')) {
      // Data is array: [round, address, amount]
      if (Array.isArray(data) && data.length >= 3) {
        const round = data[0];
        const address = data[1];
        const amountPlanck = data[2];

        // Format address: first 2 chars + .... + last 2 chars
        const first = address.substring(0, 2);
        const last = address.substring(address.length - 2);

        // Convert Planck to DOT (10 decimals for Asset Hub)
        const planck = BigInt(amountPlanck.replace(/,/g, ''));
        const tokens = Number(planck) / 1e10;
        const amount = tokens.toFixed(1);

        return `R${round} | Acc: ${first}....${last} | Amt: ${amount} DOT`;
      }
    }

    // Stored (multiBlockElectionSigned.Stored)
    if (eventType.includes('.Stored')) {
      // Data is array: [round, address, index]
      if (Array.isArray(data) && data.length >= 3) {
        const address = data[1];
        const first = address.substring(0, 2);
        const last = address.substring(address.length - 2);
        return `R${data[0]} | Acc: ${first}....${last} | Page: ${data[2]}`;
      }
    }

    // Discarded (multiBlockElectionSigned.Discarded)
    if (eventType.includes('Discarded')) {
      // Data is array: [round, address]
      if (Array.isArray(data) && data.length >= 2) {
        const address = data[1];
        const first = address.substring(0, 2);
        const last = address.substring(address.length - 2);
        return `R${data[0]} | Acc: ${first}....${last}`;
      }
    }

    // Queued (multiBlockElectionVerifier.Queued)
    if (eventType.includes('Queued')) {
      // Data is array: [score_object, null]
      if (Array.isArray(data) && data.length >= 1 && data[0]) {
        const score = data[0];
        const parts: string[] = [];

        if (score) {
          if (score.minimalStake) {
            parts.push(`Min: ${formatLargeNumber(score.minimalStake)}`);
          }
          if (score.sumStake) {
            parts.push(`Sum: ${formatLargeNumber(score.sumStake)}`);
          }
          if (score.sumStakeSquared) {
            parts.push(`SumSq: ${formatLargeNumber(score.sumStakeSquared)}`);
          }
        }

        return parts.join(' | ');
      }
    }

    // Verified (multiBlockElectionVerifier.Verified)
    if (eventType.includes('Verified')) {
      // Data is array: [page, winners]
      if (Array.isArray(data) && data.length >= 2) {
        return `Page: ${data[0]}, Winners: ${data[1]}`;
      }
    }

    // PagedElectionProceeded
    if (eventType.includes('PagedElectionProceeded')) {
      const parts: string[] = [];
      if (data.page) parts.push(`Page: ${data.page}`);
      if (data.result) {
        const resultType = Object.keys(data.result)[0];
        const resultValue = data.result[resultType];
        parts.push(`${resultType}: ${resultValue}`);
      }
      return parts.join(' | ');
    }

    // NewSession
    if (eventType.includes('NewSession')) {
      if (data.sessionIndex) return `Session: ${data.sessionIndex}`;
    }

    // ValidatorSetReceived
    if (eventType.includes('ValidatorSetReceived')) {
      const parts: string[] = [];
      if (data.id) parts.push(`Era: ${data.id}`);
      if (data.newValidatorSetCount) parts.push(`Validators: ${data.newValidatorSetCount}`);
      return parts.join(' | ');
    }

    // Default: show cleaned data (first 3 meaningful fields)
    const meaningfulEntries = Object.entries(data)
      .filter(([k, v]) => !['method', 'section', 'index'].includes(k) && v !== null && v !== undefined)
      .slice(0, 3);

    if (meaningfulEntries.length === 0) return JSON.stringify(data);

    return meaningfulEntries.map(([k, v]) => {
      const strValue = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}: ${strValue.length > 30 ? strValue.substring(0, 30) + '...' : strValue}`;
    }).join(' | ');
  } catch (error) {
    // Handle JSON parse errors gracefully
    return 'Invalid event data';
  }
}
