import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFeasibility,
  calculateImpact,
  classifyPriorityBand,
  scoreOpportunity,
} from "../packages/scoring-engine/src/opportunity-score.ts";
import {
  calculateRoiScenario,
  DEFAULT_ROI_SCENARIOS,
} from "../packages/scoring-engine/src/roi.ts";

test("weighted component scores are deterministic", () => {
  assert.equal(
    calculateImpact({
      laborValue: 90,
      volume: 80,
      errorCost: 70,
      customerImpact: 60,
      revenueImpact: 50,
    }),
    73.5,
  );
  assert.equal(
    calculateFeasibility({
      ruleClarity: 90,
      digitalInput: 80,
      integrationReadiness: 70,
      dataQuality: 60,
      processStability: 50,
      ownerReadiness: 40,
    }),
    70.5,
  );
});

test("scores are versioned and classified as a quick win", () => {
  const result = scoreOpportunity({
    impact: {
      laborValue: 100,
      volume: 100,
      errorCost: 90,
      customerImpact: 90,
      revenueImpact: 90,
    },
    feasibility: {
      ruleClarity: 90,
      digitalInput: 90,
      integrationReadiness: 90,
      dataQuality: 80,
      processStability: 80,
      ownerReadiness: 80,
    },
    risk: 20,
    confidence: 90,
  });

  assert.equal(result.scoringVersion, "iwaf-1.0.0");
  assert.equal(result.priorityBand, "quick_win");
  assert.equal(result.priorityScore, 87.45);
});

test("band boundaries and inappropriate automation are explicit", () => {
  assert.equal(classifyPriorityBand(80, 64, 30, 70), "strategic_bet");
  assert.equal(classifyPriorityBand(70, 64, 30, 60), "foundation_first");
  assert.equal(classifyPriorityBand(100, 100, 0, 100, true), "defer");
});

test("invalid normalized scores fail closed", () => {
  assert.throws(
    () =>
      calculateImpact({
        laborValue: 101,
        volume: 80,
        errorCost: 70,
        customerImpact: 60,
        revenueImpact: 50,
      }),
    RangeError,
  );
});

test("ROI matches the versioned formula and excludes unspecified revenue uplift", () => {
  const result = calculateRoiScenario(
    {
      monthlyVolume: 100,
      minutesPerRun: 30,
      loadedHourlyRate: 50,
      currentErrorRate: 0.1,
      costPerError: 100,
      implementationCost: 10_000,
      annualSoftwareCost: 2_000,
    },
    DEFAULT_ROI_SCENARIOS.expected,
  );

  assert.equal(result.annualHoursRecovered, 312);
  assert.equal(result.annualLaborValue, 15_600);
  assert.equal(result.annualErrorReductionValue, 6_000);
  assert.equal(result.annualRevenueUplift, 0);
  assert.equal(result.annualNetBenefit, 19_600);
  assert.equal(result.firstYearRoiPercent, 96);
  assert.equal(result.paybackMonths, 6.12);
});

test("zero or missing implementation cost returns null ROI and payback", () => {
  const base = {
    monthlyVolume: 10,
    minutesPerRun: 10,
    loadedHourlyRate: 50,
    currentErrorRate: 0,
    costPerError: 0,
    annualSoftwareCost: 0,
  };

  for (const implementationCost of [0, null]) {
    const result = calculateRoiScenario(
      { ...base, implementationCost },
      DEFAULT_ROI_SCENARIOS.low,
    );
    assert.equal(result.firstYearRoiPercent, null);
    assert.equal(result.paybackMonths, null);
  }
});

test("negative annual benefit never produces a negative payback period", () => {
  const result = calculateRoiScenario(
    {
      monthlyVolume: 1,
      minutesPerRun: 1,
      loadedHourlyRate: 10,
      currentErrorRate: 0,
      costPerError: 0,
      implementationCost: 1_000,
      annualSoftwareCost: 5_000,
    },
    DEFAULT_ROI_SCENARIOS.low,
  );

  assert.ok(result.annualNetBenefit < 0);
  assert.ok(result.firstYearRoiPercent! < 0);
  assert.equal(result.paybackMonths, null);
});
