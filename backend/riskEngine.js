/**
 * Risk Scoring Engine — SIH26024 differentiator module.
 * JS equivalent of app/risk_engine.py — identical weights, caps, and logic.
 *
 * Pure function: plain JS values in, plain object out. No DB, no Express
 * imports here — testable completely standalone with `node riskEngine.js`.
 *
 * Signals used (weights sum to 1.0):
 *   1. Unresolved violation count       (25%)
 *   2. Severity-weighted violation load (30%)
 *   3. Days since last inspection       (20%)
 *   4. Violation recurrence rate        (15%)
 *   5. Average resolution delay         (10%)
 */

const WEIGHTS = {
  unresolvedCount: 0.25,
  severityLoad: 0.30,
  inspectionStaleness: 0.20,
  recurrenceRate: 0.15,
  resolutionDelay: 0.10,
};

const CAPS = {
  unresolvedCountCap: 10,
  severityLoadCap: 40,
  inspectionStalenessDaysCap: 90,
  recurrencePerMonthCap: 5,
  resolutionDelayDaysCap: 30,
};

const RISK_BANDS = [
  [80, "CRITICAL"],
  [60, "HIGH"],
  [35, "MEDIUM"],
  [0, "LOW"],
];

function normalize(value, cap) {
  if (cap <= 0) return 0.0;
  return Math.min(100, Math.max(0, (value / cap) * 100));
}

function bandForScore(score) {
  for (const [threshold, band] of RISK_BANDS) {
    if (score >= threshold) return band;
  }
  return "LOW";
}

/**
 * Core scoring function.
 * @param {number} unresolvedCount
 * @param {number} severitySumUnresolved
 * @param {number|null} daysSinceLastInspection - null if never inspected
 * @param {number} violationsLast90Days
 * @param {number|null} avgResolutionDelayDays - null if nothing resolved yet
 * @returns {{score: number, band: string, explanation: string, breakdown: object}}
 */
function computeRiskScore({
  unresolvedCount,
  severitySumUnresolved,
  daysSinceLastInspection,
  violationsLast90Days,
  avgResolutionDelayDays,
}) {
  const stalenessDays =
    daysSinceLastInspection == null
      ? CAPS.inspectionStalenessDaysCap
      : daysSinceLastInspection;
  const recurrencePerMonth = violationsLast90Days / 3.0;
  const resolutionDelay = avgResolutionDelayDays ?? 0.0;

  const subScores = {
    unresolvedCount: normalize(unresolvedCount, CAPS.unresolvedCountCap),
    severityLoad: normalize(severitySumUnresolved, CAPS.severityLoadCap),
    inspectionStaleness: normalize(stalenessDays, CAPS.inspectionStalenessDaysCap),
    recurrenceRate: normalize(recurrencePerMonth, CAPS.recurrencePerMonthCap),
    resolutionDelay: normalize(resolutionDelay, CAPS.resolutionDelayDaysCap),
  };

  let finalScore = 0;
  for (const key of Object.keys(WEIGHTS)) {
    finalScore += subScores[key] * WEIGHTS[key];
  }
  finalScore = Math.round(finalScore * 10) / 10;
  const band = bandForScore(finalScore);

  const explanation = buildExplanation(
    finalScore, band, subScores, unresolvedCount,
    severitySumUnresolved, stalenessDays, violationsLast90Days,
  );

  const breakdown = {};
  for (const key of Object.keys(subScores)) {
    breakdown[key] = Math.round(subScores[key] * 10) / 10;
  }

  return { score: finalScore, band, explanation, breakdown };
}

function buildExplanation(
  score, band, subScores, unresolvedCount,
  severitySum, stalenessDays, recentViolations,
) {
  const weighted = {};
  for (const key of Object.keys(WEIGHTS)) {
    weighted[key] = subScores[key] * WEIGHTS[key];
  }
  const topFactor = Object.keys(weighted).reduce((a, b) =>
    weighted[a] > weighted[b] ? a : b
  );

  const reasons = {
    unresolvedCount: `${unresolvedCount} unresolved violation(s)`,
    severityLoad: `severity load of ${severitySum} across open issues`,
    inspectionStaleness: `${Math.floor(stalenessDays)} days since last inspection`,
    recurrenceRate: `${recentViolations} violations in the last 90 days`,
    resolutionDelay: "slow historical resolution times",
  };

  return `Risk is ${band} (${score}/100), driven mainly by ${reasons[topFactor]}.`;
}

module.exports = { computeRiskScore };

// ---------------------------------------------------------------------------
// Quick manual test — run `node riskEngine.js` to sanity-check the logic
// without needing the DB or Express server running at all.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const examples = [
    { unresolvedCount: 0, severitySumUnresolved: 0, daysSinceLastInspection: 10,
      violationsLast90Days: 0, avgResolutionDelayDays: 5 },
    { unresolvedCount: 4, severitySumUnresolved: 14, daysSinceLastInspection: 45,
      violationsLast90Days: 3, avgResolutionDelayDays: 12 },
    { unresolvedCount: 8, severitySumUnresolved: 32, daysSinceLastInspection: 95,
      violationsLast90Days: 6, avgResolutionDelayDays: 28 },
  ];
  for (const ex of examples) {
    console.log(computeRiskScore(ex));
  }
}
