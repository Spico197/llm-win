import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  availableMetrics,
  evidenceMetricsForCategory,
  getMetricDefinition,
  metricValue,
} from "../src/lib/metrics";
import { buildCategoryEdges } from "../src/lib/graph";
import type { LeaderboardMetric, ModelRecord, WinEdge } from "../src/lib/types";

type Reachability = {
  seen: Map<string, number>;
  parent: Map<string, WinEdge>;
};

const dataDir = path.join(process.cwd(), "public", "data");
const models = JSON.parse(
  await readFile(path.join(dataDir, "models.json"), "utf8"),
) as ModelRecord[];
const metrics = availableMetrics(models);
const evidenceMetrics = evidenceMetricsForCategory(metrics, "Overall");
const edges = buildCategoryEdges(models, evidenceMetrics);
const adjacency = buildAdjacency(edges);
const modelById = new Map(models.map((model) => [model.id, model]));
const modelsWithIntelligence = models.filter(
  (model) => metricValue(model, "intelligence") !== undefined,
);

const pathLengthCounts = new Map<number, number>();
const pathMetricCounts = new Map<string, number>();
const directUpsetCounts = new Map<string, number>();
const bridgeCounts = new Map<string, number>();
const sourceMisses = new Map<string, number>();
const targetMisses = new Map<string, number>();
const directUpsetExamples: Array<Record<string, unknown>> = [];
const unreachableExamples: Array<Record<string, unknown>> = [];

let checkedWeakerToStrongerPairs = 0;
let reachablePairs = 0;
let unreachablePairs = 0;

for (const edge of edges) {
  const source = modelById.get(edge.fromModelId);
  const target = modelById.get(edge.toModelId);
  const metric = edge.evidenceMetric ?? edge.metric;
  if (!source || !target || !metric || metric === "multi_metric" || metric === "pareto") {
    continue;
  }
  const sourceIntelligence = metricValue(source, "intelligence");
  const targetIntelligence = metricValue(target, "intelligence");
  if (
    sourceIntelligence !== undefined &&
    targetIntelligence !== undefined &&
    sourceIntelligence < targetIntelligence
  ) {
    directUpsetCounts.set(metric, (directUpsetCounts.get(metric) ?? 0) + 1);
    if (directUpsetExamples.length < 30) {
      directUpsetExamples.push({
        metric,
        metricLabel: getMetricDefinition(metric).label,
        source: modelSummary(source),
        target: modelSummary(target),
        sourceValue: roundMetric(edge.fromValue ?? 0),
        targetValue: roundMetric(edge.toValue ?? 0),
        intelligenceGap: roundMetric(targetIntelligence - sourceIntelligence),
      });
    }
  }
}

for (const source of modelsWithIntelligence) {
  const reachability = reachableWithin(source.id, adjacency, 9);
  const sourceIntelligence = metricValue(source, "intelligence") ?? 0;
  let sourceMissCount = 0;

  for (const target of modelsWithIntelligence) {
    if (source.id === target.id) continue;
    const targetIntelligence = metricValue(target, "intelligence") ?? 0;
    if (sourceIntelligence >= targetIntelligence) continue;

    checkedWeakerToStrongerPairs += 1;
    const depth = reachability.seen.get(target.id);
    if (depth === undefined) {
      unreachablePairs += 1;
      sourceMissCount += 1;
      targetMisses.set(target.id, (targetMisses.get(target.id) ?? 0) + 1);
      if (unreachableExamples.length < 30) {
        unreachableExamples.push({
          source: modelSummary(source),
          target: modelSummary(target),
          intelligenceGap: roundMetric(targetIntelligence - sourceIntelligence),
        });
      }
      continue;
    }

    reachablePairs += 1;
    pathLengthCounts.set(depth, (pathLengthCounts.get(depth) ?? 0) + 1);
    for (const pathEdge of reconstructPath(source.id, target.id, reachability.parent)) {
      const metric = pathEdge.evidenceMetric ?? pathEdge.metric;
      if (metric && metric !== "multi_metric" && metric !== "pareto") {
        pathMetricCounts.set(metric, (pathMetricCounts.get(metric) ?? 0) + 1);
      }
      if (pathEdge.toModelId !== target.id && pathEdge.toModelId !== source.id) {
        bridgeCounts.set(pathEdge.toModelId, (bridgeCounts.get(pathEdge.toModelId) ?? 0) + 1);
      }
    }
  }

  if (sourceMissCount) sourceMisses.set(source.id, sourceMissCount);
}

const report = {
  generatedAt: new Date().toISOString(),
  title: "LLM Win Report",
  analysisIdeas: [
    {
      title: "Weak-to-strong reachability",
      question:
        "When a source model has lower AA Intelligence Index than a target, can it still reach the target through benchmark wins?",
      implemented: true,
    },
    {
      title: "Benchmark specialization",
      question:
        "Which benchmarks most often let a lower-intelligence model beat a higher-intelligence model?",
      implemented: true,
    },
    {
      title: "Benchmark coverage",
      question:
        "Are some missing chains caused by missing benchmark data rather than poor performance?",
      implemented: true,
    },
    {
      title: "Benchmark correlation",
      question:
        "Which benchmarks track the overall Intelligence Index closely, and which create surprising ranking reversals?",
      implemented: true,
    },
    {
      title: "Bridge models",
      question:
        "Which models most often act as intermediate steps in weak-to-strong chains?",
      implemented: true,
    },
    {
      title: "Provider patterns",
      question:
        "Do some providers produce more specialist models or more bridge models?",
      implemented: false,
    },
    {
      title: "Historical movement",
      question:
        "Do models become better bridges or specialists as benchmarks and model versions change over time?",
      implemented: false,
    },
    {
      title: "Optimization opportunities",
      question:
        "Which benchmark weaknesses should a model improve first to unlock the most new transitive wins?",
      implemented: false,
    },
  ],
  summary: {
    modelCount: models.length,
    modelsWithIntelligence: modelsWithIntelligence.length,
    evidenceMetrics,
    graphEdgeCount: edges.length,
    checkedWeakerToStrongerPairs,
    reachablePairs,
    unreachablePairs,
    reachableRate: rate(reachablePairs, checkedWeakerToStrongerPairs),
    unreachableRate: rate(unreachablePairs, checkedWeakerToStrongerPairs),
    directUpsetEdgeCount: sumMap(directUpsetCounts),
  },
  benchmarkCoverage: evidenceMetrics.map((metric) => benchmarkCoverage(metric)),
  benchmarkCorrelations: evidenceMetrics
    .map((metric) => benchmarkCorrelation(metric))
    .sort((a, b) => a.correlation - b.correlation),
  directUpsetsByBenchmark: metricCountRows(directUpsetCounts),
  pathLengths: [...pathLengthCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hops, count]) => ({ hops, count })),
  pathBenchmarkUsage: metricCountRows(pathMetricCounts),
  topBridgeModels: modelCountRows(bridgeCounts, "model", 20),
  worstSources: modelCountRows(sourceMisses, "model", 20),
  hardestTargets: modelCountRows(targetMisses, "model", 20),
  directUpsetExamples,
  unreachableExamples,
  interpretation: [
    "Weak models usually beat stronger models by being specialists: they may have a lower AA Intelligence Index but still score higher on one concrete benchmark.",
    "Benchmarks with lower correlation to the Intelligence Index create more surprising wins, because they measure skills that do not move perfectly with the aggregate score.",
    "Missing benchmark coverage matters. A model with few concrete benchmark values can become hard to connect, even if it has an Intelligence Index.",
    "A practical optimization strategy is to identify benchmarks where a model is below nearby peers, then improve those narrow skills. This can unlock many new direct edges and transitive chains.",
  ],
};

await mkdir(dataDir, { recursive: true });
await writeFile(path.join(dataDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `Wrote report.json with ${checkedWeakerToStrongerPairs} weak-to-strong pairs and ${edges.length} graph edges.`,
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
): Reachability {
  const seen = new Map<string, number>([[sourceModelId, 0]]);
  const parent = new Map<string, WinEdge>();
  const queue = [sourceModelId];

  while (queue.length) {
    const modelId = queue.shift();
    if (!modelId) continue;
    const depth = seen.get(modelId) ?? 0;
    if (depth >= maxHops) continue;
    for (const edge of adjacency.get(modelId) ?? []) {
      if (seen.has(edge.toModelId)) continue;
      seen.set(edge.toModelId, depth + 1);
      parent.set(edge.toModelId, edge);
      queue.push(edge.toModelId);
    }
  }

  return { seen, parent };
}

function reconstructPath(sourceId: string, targetId: string, parent: Map<string, WinEdge>) {
  const path: WinEdge[] = [];
  let current = targetId;
  while (current !== sourceId) {
    const edge = parent.get(current);
    if (!edge) return [];
    path.unshift(edge);
    current = edge.fromModelId;
  }
  return path;
}

function benchmarkCoverage(metric: LeaderboardMetric) {
  const values = models
    .map((model) => metricValue(model, metric))
    .filter((value): value is number => value !== undefined);
  return {
    metric,
    label: getMetricDefinition(metric).label,
    category: getMetricDefinition(metric).category,
    modelCount: values.length,
    coverageRate: rate(values.length, models.length),
    min: values.length ? roundMetric(Math.min(...values)) : null,
    max: values.length ? roundMetric(Math.max(...values)) : null,
    average: values.length ? roundMetric(values.reduce((a, b) => a + b, 0) / values.length) : null,
  };
}

function benchmarkCorrelation(metric: LeaderboardMetric) {
  const pairs = models
    .map((model) => ({
      intelligence: metricValue(model, "intelligence"),
      benchmark: metricValue(model, metric),
    }))
    .filter(
      (pair): pair is { intelligence: number; benchmark: number } =>
        pair.intelligence !== undefined && pair.benchmark !== undefined,
    );
  return {
    metric,
    label: getMetricDefinition(metric).label,
    category: getMetricDefinition(metric).category,
    sampleSize: pairs.length,
    correlation: roundMetric(pearson(pairs.map((pair) => pair.intelligence), pairs.map((pair) => pair.benchmark))),
  };
}

function pearson(xs: number[], ys: number[]) {
  if (xs.length < 2 || xs.length !== ys.length) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let numerator = 0;
  let sumXSquared = 0;
  let sumYSquared = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    numerator += dx * dy;
    sumXSquared += dx * dx;
    sumYSquared += dy * dy;
  }
  const denominator = Math.sqrt(sumXSquared * sumYSquared);
  return denominator ? numerator / denominator : 0;
}

function metricCountRows(counts: Map<string, number>) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([metric, count]) => ({
      metric,
      label: getMetricDefinition(metric).label,
      category: getMetricDefinition(metric).category,
      count,
    }));
}

function modelCountRows(counts: Map<string, number>, key: string, limit: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([modelId, count]) => ({
      [key]: modelSummary(modelById.get(modelId)),
      count,
    }));
}

function modelSummary(model: ModelRecord | undefined) {
  if (!model) return null;
  return {
    id: model.id,
    slug: model.slug,
    name: model.name,
    provider: model.provider,
    intelligence: normalizedMetric(model, "intelligence"),
  };
}

function normalizedMetric(model: ModelRecord, metric: LeaderboardMetric) {
  const value = metricValue(model, metric);
  return value === undefined ? null : roundMetric(value);
}

function sumMap(map: Map<string, number>) {
  return [...map.values()].reduce((sum, value) => sum + value, 0);
}

function rate(numerator: number, denominator: number) {
  return denominator ? roundMetric(numerator / denominator) : 0;
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}
