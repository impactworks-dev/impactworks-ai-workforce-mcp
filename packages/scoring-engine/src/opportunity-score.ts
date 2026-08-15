export const SCORING_VERSION = "iwaf-1.0.0";

export type Score = number;

export interface ImpactInputs {
  laborValue: Score;
  volume: Score;
  errorCost: Score;
  customerImpact: Score;
  revenueImpact: Score;
}

export interface FeasibilityInputs {
  ruleClarity: Score;
  digitalInput: Score;
  integrationReadiness: Score;
  dataQuality: Score;
  processStability: Score;
  ownerReadiness: Score;
}

export type PriorityBand =
  | "quick_win"
  | "strategic_bet"
  | "foundation_first"
  | "defer";

export interface OpportunityScoreInput {
  impact: ImpactInputs;
  feasibility: FeasibilityInputs;
  risk: Score;
  confidence: Score;
  automationInappropriate?: boolean;
}

export interface OpportunityScoreResult {
  scoringVersion: typeof SCORING_VERSION;
  impactScore: Score;
  feasibilityScore: Score;
  riskScore: Score;
  confidenceScore: Score;
  priorityScore: Score;
  priorityBand: PriorityBand;
}

function assertScore(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be a finite number between 0 and 100`);
  }
}

function roundScore(value: number): Score {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function validateRecord(prefix: string, values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values)) {
    assertScore(`${prefix}.${name}`, value);
  }
}

export function calculateImpact(inputs: ImpactInputs): Score {
  validateRecord("impact", inputs as unknown as Record<string, number>);
  return roundScore(
    0.3 * inputs.laborValue +
      0.2 * inputs.volume +
      0.2 * inputs.errorCost +
      0.15 * inputs.customerImpact +
      0.15 * inputs.revenueImpact,
  );
}

export function calculateFeasibility(inputs: FeasibilityInputs): Score {
  validateRecord("feasibility", inputs as unknown as Record<string, number>);
  return roundScore(
    0.25 * inputs.ruleClarity +
      0.2 * inputs.digitalInput +
      0.2 * inputs.integrationReadiness +
      0.15 * inputs.dataQuality +
      0.1 * inputs.processStability +
      0.1 * inputs.ownerReadiness,
  );
}

export function classifyPriorityBand(
  impact: Score,
  feasibility: Score,
  risk: Score,
  priority: Score,
  automationInappropriate = false,
): PriorityBand {
  if (automationInappropriate || priority < 45) return "defer";
  if (priority >= 70 && feasibility >= 65 && risk < 60) return "quick_win";
  if (impact >= 75 && (feasibility < 65 || risk >= 60)) return "strategic_bet";
  return "foundation_first";
}

export function scoreOpportunity(input: OpportunityScoreInput): OpportunityScoreResult {
  assertScore("risk", input.risk);
  assertScore("confidence", input.confidence);

  const impactScore = calculateImpact(input.impact);
  const feasibilityScore = calculateFeasibility(input.feasibility);
  const priorityScore = roundScore(
    0.5 * impactScore +
      0.3 * feasibilityScore +
      0.2 * input.confidence -
      0.2 * input.risk,
  );

  return {
    scoringVersion: SCORING_VERSION,
    impactScore,
    feasibilityScore,
    riskScore: input.risk,
    confidenceScore: input.confidence,
    priorityScore,
    priorityBand: classifyPriorityBand(
      impactScore,
      feasibilityScore,
      input.risk,
      priorityScore,
      input.automationInappropriate,
    ),
  };
}
