import { describe, expect, it } from "vitest";
import { buildMetricEdges, buildMultiMetricEdges, buildParetoEdges, findShortestPath } from "./graph";
import { buildLeaderboard } from "./leaderboards";
import { evidenceMetricsForCategory } from "./metrics";
import { normalizeAaModels } from "./normalize";
import type { ModelRecord } from "./types";

const models: ModelRecord[] = [
  {
    id: "a",
    name: "A",
    sourceUrl: "https://example.com",
    updatedAt: "2026-05-09T00:00:00.000Z",
    metrics: {
      intelligence: 90,
      outputSpeedTokensPerSecond: 20,
      latencySeconds: 2,
    },
  },
  {
    id: "b",
    name: "B",
    sourceUrl: "https://example.com",
    updatedAt: "2026-05-09T00:00:00.000Z",
    metrics: {
      intelligence: 80,
      outputSpeedTokensPerSecond: 40,
      latencySeconds: 1,
    },
  },
  {
    id: "c",
    name: "C",
    sourceUrl: "https://example.com",
    updatedAt: "2026-05-09T00:00:00.000Z",
    metrics: {
      intelligence: 70,
      outputSpeedTokensPerSecond: 10,
      latencySeconds: 3,
    },
  },
];

describe("leaderboards", () => {
  it("sorts higher-is-better metrics descending", () => {
    expect(buildLeaderboard(models, "intelligence").map((entry) => entry.modelId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts lower-is-better metrics ascending", () => {
    expect(buildLeaderboard(models, "latencySeconds").map((entry) => entry.modelId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("graph search", () => {
  it("finds a metric path", () => {
    const edges = buildMetricEdges(models, "intelligence");
    const path = findShortestPath(edges, "a", "c", 4);
    expect(path.found).toBe(true);
    expect(path.edges.at(-1)?.toModelId).toBe("c");
  });

  it("uses any winning metric in multi mode", () => {
    const edges = buildMultiMetricEdges(models, ["intelligence", "outputSpeedTokensPerSecond"]);
    const path = findShortestPath(edges, "b", "a", 2);
    expect(path.found).toBe(true);
    expect(path.edges[0].explanation).toContain("Output speed");
  });

  it("requires no-worse comparisons in pareto mode", () => {
    const edges = buildParetoEdges(models, ["intelligence", "latencySeconds"]);
    const path = findShortestPath(edges, "a", "b", 2);
    expect(path.found).toBe(false);
  });
});

describe("normalization", () => {
  it("does not convert null benchmark values into zeroes", () => {
    const [model] = normalizeAaModels(
      [
        {
          id: "deepseek",
          name: "DeepSeek",
          slug: "deepseek",
          evaluations: {
            mmlu_pro: null,
            gpqa: 0.905,
          },
        },
      ],
      "2026-05-09T00:00:00.000Z",
    );

    expect(model.metrics.mmlu_pro).toBeUndefined();
    expect(model.metrics.gpqa).toBe(0.905);
  });

  it("uses all benchmark metrics for Overall", () => {
    expect(evidenceMetricsForCategory(["gpqa", "livecodebench", "latencySeconds"], "Overall")).toEqual([
      "gpqa",
      "livecodebench",
    ]);
  });
});
