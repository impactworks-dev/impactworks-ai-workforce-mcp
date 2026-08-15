export const ROI_VERSION = "iwaf-roi-1.0.0";

export interface RoiInputs {
  monthlyVolume: number;
  minutesPerRun: number;
  loadedHourlyRate: number;
  currentErrorRate: number;
  costPerError: number;
  implementationCost: number | null;
  annualSoftwareCost: number;
  annualRevenueUplift?: number;
}

export interface ScenarioAssumptions {
  automationCoverage: number;
  adoptionRate: number;
  expectedErrorReduction: number;
}

export interface RoiScenarioResult {
  roiVersion: typeof ROI_VERSION;
  annualHoursRecovered: number;
  annualLaborValue: number;
  annualErrorReductionValue: number;
  annualRevenueUplift: number;
  annualNetBenefit: number;
  firstYearRoiPercent: number | null;
  paybackMonths: number | null;
}

export const DEFAULT_ROI_SCENARIOS = {
  low: { automationCoverage: 0.45, adoptionRate: 0.7, expectedErrorReduction: 0.3 },
  expected: { automationCoverage: 0.65, adoptionRate: 0.8, expectedErrorReduction: 0.5 },
  high: { automationCoverage: 0.8, adoptionRate: 0.9, expectedErrorReduction: 0.7 },
} as const satisfies Record<string, ScenarioAssumptions>;

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

function assertRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateRoiScenario(
  inputs: RoiInputs,
  assumptions: ScenarioAssumptions,
): RoiScenarioResult {
  for (const [name, value] of Object.entries(inputs)) {
    if (name !== "implementationCost" && value !== undefined) {
      assertNonNegative(name, value);
    }
  }
  if (inputs.implementationCost !== null) {
    assertNonNegative("implementationCost", inputs.implementationCost);
  }
  assertRate("currentErrorRate", inputs.currentErrorRate);
  assertRate("automationCoverage", assumptions.automationCoverage);
  assertRate("adoptionRate", assumptions.adoptionRate);
  assertRate("expectedErrorReduction", assumptions.expectedErrorReduction);

  const annualHoursRecovered =
    (inputs.monthlyVolume * inputs.minutesPerRun * 12) / 60 *
    assumptions.automationCoverage *
    assumptions.adoptionRate;
  const annualLaborValue = annualHoursRecovered * inputs.loadedHourlyRate;
  const annualErrorReductionValue =
    inputs.monthlyVolume *
    12 *
    inputs.currentErrorRate *
    assumptions.expectedErrorReduction *
    inputs.costPerError;
  const annualRevenueUplift = inputs.annualRevenueUplift ?? 0;
  const annualNetBenefit =
    annualLaborValue +
    annualErrorReductionValue +
    annualRevenueUplift -
    inputs.annualSoftwareCost;
  const hasImplementationCost =
    inputs.implementationCost !== null && inputs.implementationCost > 0;

  return {
    roiVersion: ROI_VERSION,
    annualHoursRecovered: money(annualHoursRecovered),
    annualLaborValue: money(annualLaborValue),
    annualErrorReductionValue: money(annualErrorReductionValue),
    annualRevenueUplift: money(annualRevenueUplift),
    annualNetBenefit: money(annualNetBenefit),
    firstYearRoiPercent: hasImplementationCost
      ? money(((annualNetBenefit - inputs.implementationCost!) / inputs.implementationCost!) * 100)
      : null,
    paybackMonths:
      hasImplementationCost && annualNetBenefit > 0
        ? money(inputs.implementationCost! / (annualNetBenefit / 12))
        : null,
  };
}
