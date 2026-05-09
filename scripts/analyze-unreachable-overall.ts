import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  availableMetrics,
  evidenceMetricsForCategory,
  metricValue,
} from "../src/lib/metrics";
import { buildCategoryEdges } from "../src/lib/graph";
import type { LeaderboardMetric, ModelRecord, WinEdge } from "../src/lib/types";

const dataDir = path.join(process.cwd(), "public", "data");
const modelsPath = path.join(dataDir, "models.json");
const outputPath = path.join(dataDir, "unreachable-overall-pairs.json");

const models = JSON.parse(await readFile(modelsPath, "utf8")) as ModelRecord[];
const metrics = availableMetrics(models);
const evidenceMetrics = evidenceMetricsForCategory(metrics, "Overall");
const edges = buildCategoryEdges(models, evidenceMetrics);
const adjacency = buildAdjacency(edges);
const modelsWithIntelligence = models.filter(
  (model) => metricValue(model, "intelligence") !== undefined,
);

const unreachablePairs = [];
const targetMisses = new Map<string, number>();
const sourceMisses = new Map<string, number>();

for (const source of modelsWithIntelligence) {
  const reachable = reachableWithin(source.id, adjacency, 9);
  const sourceIntelligence = metricValue(source, "intelligence") ?? 0;

  for (const target of modelsWithIntelligence) {
    if (source.id === target.id) continue;
    const targetIntelligence = metricValue(target, "intelligence") ?? 0;
    if (sourceIntelligence >= targetIntelligence) continue;
    if (reachable.has(target.id)) continue;

    sourceMisses.set(source.id, (sourceMisses.get(source.id) ?? 0) + 1);
    targetMisses.set(target.id, (targetMisses.get(target.id) ?? 0) + 1);
    unreachablePairs.push({
      source: modelSnapshot(source, evidenceMetrics),
      target: modelSnapshot(target, evidenceMetrics),
      intelligenceGap: roundMetric(targetIntelligence - sourceIntelligence),
    });
  }
}

const generatedAt = new Date().toISOString();
const checkedPairs = modelsWithIntelligence.reduce((count, source) => {
  const sourceIntelligence = metricValue(source, "intelligence") ?? 0;
  return (
    count +
    modelsWithIntelligence.filter(
      (target) =>
        target.id !== source.id &&
        sourceIntelligence < (metricValue(target, "intelligence") ?? 0),
    ).length
  );
}, 0);

const report = {
  generatedAt,
  category: "Overall",
  pathMaxHops: 9,
  comparisonRule:
    "Only source models with lower AA Intelligence Index than the target are checked. A pair is unreachable when no Overall benchmark chain from source to target exists within max hops.",
  modelCount: models.length,
  modelsWithIntelligence: modelsWithIntelligence.length,
  evidenceMetrics,
  checkedWeakerToStrongerPairs: checkedPairs,
  unreachablePairCount: unreachablePairs.length,
  unreachablePairRate:
    checkedPairs > 0 ? roundMetric(unreachablePairs.length / checkedPairs) : 0,
  worstSources: summarizeMisses(sourceMisses, "source", 20),
  hardestTargets: summarizeMisses(targetMisses, "target", 20),
  pairs: unreachablePairs,
};

await mkdir(dataDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `Wrote ${unreachablePairs.length} unreachable weaker-to-stronger Overall pairs to ${outputPath}.`,
);

function buildAdjacency(edges: WinEdge[]) {
  const adjacency = new Map<string, WinEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromModelId) ?? [];
    list.push(edge);
    adjacency.set(edge.fromModelId, list);
  }
  return adjacency;
}

function reachableWithin(
  sourceModelId: string,
  adjacency: Map<string, WinEdge[]>,
  maxHops: number,
) {
  const seen = new Map<string, number>([[sourceModelId, 0]]);
  const queue = [sourceModelId];

  while (queue.length) {
    const modelId = queue.shift();
    if (!modelId) continue;
    const depth = seen.get(modelId) ?? 0;
    if (depth >= maxHops) continue;

    for (const edge of adjacency.get(modelId) ?? []) {
      if (seen.has(edge.toModelId)) continue;
      seen.set(edge.toModelId, depth + 1);
      queue.push(edge.toModelId);
    }
  }

  return seen;
}

function modelSnapshot(model: ModelRecord, evidenceMetrics: LeaderboardMetric[]) {
  const benchmarks = Object.fromEntries(
    evidenceMetrics.map((metric) => [metric, normalizedMetric(model, metric)]),
  );
  return {
    id: model.id,
    slug: model.slug,
    name: model.name,
    provider: model.provider,
    intelligence: normalizedMetric(model, "intelligence"),
    benchmarks,
  };
}

function normalizedMetric(model: ModelRecord, metric: LeaderboardMetric) {
  const value = metricValue(model, metric);
  return value === undefined ? null : roundMetric(value);
}

function summarizeMisses(
  misses: Map<string, number>,
  key: "source" | "target",
  limit: number,
) {
  return [...misses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([modelId, count]) => {
      const model = models.find((item) => item.id === modelId);
      return {
        [key]: model
          ? {
              id: model.id,
              slug: model.slug,
              name: model.name,
              provider: model.provider,
              intelligence: normalizedMetric(model, "intelligence"),
            }
          : { id: modelId },
        unreachablePairs: count,
      };
    });
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}
