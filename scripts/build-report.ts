import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  availableMetrics,
  evidenceMetricsForCategory,
  formatMetricValue,
  getMetricDefinition,
  metricMargin,
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
const changeSummary = await readOptionalJson(path.join(dataDir, "data-change.json"));
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

const weakToStrongTriples = buildWeakToStrongTriples();
const benchmarkReversalScores = buildBenchmarkReversalScores(weakToStrongTriples);
const compositeBenchmarkCandidates = buildCompositeBenchmarkCandidates(benchmarkReversalScores);
const shortestPathAnalysis = buildShortestPathAnalysis(pathLengthCounts, reachablePairs);
const modelAbilityFingerprints = buildModelAbilityFingerprints(
  weakToStrongTriples,
  bridgeCounts,
  sourceMisses,
  targetMisses,
);

const report = {
  generatedAt: new Date().toISOString(),
  title: "LLM Win Report",
  changeSummary,
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
    directWeakToStrongTriples: weakToStrongTriples.length,
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
  shortestPathAnalysis,
  topWeakToStrongTriples: weakToStrongTriples.slice(0, 30),
  benchmarkReversalScores,
  compositeBenchmarkCandidates,
  modelAbilityFingerprints,
  topBridgeModels: modelCountRows(bridgeCounts, "model", 20),
  worstSources: modelCountRows(sourceMisses, "model", 20),
  hardestTargets: modelCountRows(targetMisses, "model", 20),
  directUpsetExamples,
  unreachableExamples,
  interpretation: [
    "Weak models usually beat stronger models by being specialists: they may have a lower AA Intelligence Index but still score higher on one concrete benchmark.",
    "Benchmarks with lower correlation to the Intelligence Index create more surprising wins, because they measure skills that do not move perfectly with the aggregate score.",
    "High-reversal benchmarks are not automatically better or worse. They are useful when they have good coverage and stable margins, because they add information that the aggregate score does not already contain.",
    "Shortest paths are counted from reconstructed shortest paths for each reachable weak-to-strong pair; raw reachability is not treated as a path-length statistic.",
    "Missing benchmark coverage matters. A model with few concrete benchmark values can become hard to connect, even if it has an Intelligence Index.",
    "A practical optimization strategy is to identify benchmarks where a model is below nearby peers, then improve those narrow skills. This can unlock many new direct edges and transitive chains.",
  ],
};

await mkdir(dataDir, { recursive: true });
await writeFile(path.join(dataDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `Wrote report.json with ${checkedWeakerToStrongerPairs} weak-to-strong pairs and ${edges.length} graph edges.`,
);

async function readOptionalJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

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
    .map((model) => reportMetricValue(model, metric))
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
      intelligence: reportMetricValue(model, "intelligence"),
      benchmark: reportMetricValue(model, metric),
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

function buildWeakToStrongTriples() {
  const triples = [];
  for (const metric of evidenceMetrics) {
    const definition = getMetricDefinition(metric);
    const candidates = modelsWithIntelligence.filter(
      (model) => reportMetricValue(model, metric) !== undefined,
    );
    for (const source of candidates) {
      const sourceIntelligence = reportMetricValue(source, "intelligence");
      const sourceValue = reportMetricValue(source, metric);
      if (sourceIntelligence === undefined || sourceValue === undefined) continue;
      for (const target of candidates) {
        if (source.id === target.id) continue;
        const targetIntelligence = reportMetricValue(target, "intelligence");
        const targetValue = reportMetricValue(target, metric);
        if (targetIntelligence === undefined || targetValue === undefined) continue;
        if (sourceIntelligence >= targetIntelligence) continue;
        const benchmarkMargin = metricMargin(sourceValue, targetValue, metric);
        if (benchmarkMargin < definition.minimumMargin) continue;
        const intelligenceGap = targetIntelligence - sourceIntelligence;
        const normalizedBenchmarkMargin = normalizeMargin(benchmarkMargin, metric);
        const surpriseScore = intelligenceGap * normalizedBenchmarkMargin;
        triples.push({
          source: modelSummary(source),
          target: modelSummary(target),
          metric,
          metricLabel: definition.label,
          category: definition.category,
          sourceIntelligence: roundMetric(sourceIntelligence),
          targetIntelligence: roundMetric(targetIntelligence),
          intelligenceGap: roundMetric(intelligenceGap),
          sourceValue: roundMetric(sourceValue),
          targetValue: roundMetric(targetValue),
          sourceFormatted: formatMetricValue(sourceValue, metric),
          targetFormatted: formatMetricValue(targetValue, metric),
          benchmarkMargin: roundMetric(benchmarkMargin),
          benchmarkMarginFormatted: formatBenchmarkMargin(benchmarkMargin, metric),
          surpriseScore: roundMetric(surpriseScore),
        });
      }
    }
  }
  return triples.sort((a, b) => b.surpriseScore - a.surpriseScore);
}

function buildBenchmarkReversalScores(
  triples: ReturnType<typeof buildWeakToStrongTriples>,
) {
  const triplesByMetric = new Map<string, typeof triples>();
  for (const triple of triples) {
    triplesByMetric.set(triple.metric, [...(triplesByMetric.get(triple.metric) ?? []), triple]);
  }

  return evidenceMetrics
    .map((metric) => {
      const definition = getMetricDefinition(metric);
      const candidates = modelsWithIntelligence.filter(
        (model) => reportMetricValue(model, metric) !== undefined,
      );
      let comparableWeakStrongPairs = 0;
      for (const source of candidates) {
        const sourceIntelligence = reportMetricValue(source, "intelligence");
        if (sourceIntelligence === undefined) continue;
        for (const target of candidates) {
          if (source.id === target.id) continue;
          const targetIntelligence = reportMetricValue(target, "intelligence");
          if (targetIntelligence === undefined || sourceIntelligence >= targetIntelligence) {
            continue;
          }
          comparableWeakStrongPairs += 1;
        }
      }
      const metricTriples = triplesByMetric.get(metric) ?? [];
      const correlation = benchmarkCorrelation(metric).correlation;
      const coverage = benchmarkCoverage(metric).coverageRate;
      const averageIntelligenceGap = average(metricTriples.map((item) => item.intelligenceGap));
      const averageBenchmarkMargin = average(
        metricTriples.map((item) => normalizeMargin(item.benchmarkMargin, metric)),
      );
      const averageSurprise = average(metricTriples.map((item) => item.surpriseScore));
      const reversalRate = rate(metricTriples.length, comparableWeakStrongPairs);
      const independenceScore = Math.max(0, 1 - Math.max(0, correlation));
      const usefulReversalScore = reversalRate * coverage * (0.35 + independenceScore);
      return {
        metric,
        label: definition.label,
        category: definition.category,
        coverageRate: coverage,
        correlation,
        comparableWeakStrongPairs,
        reversalTriples: metricTriples.length,
        reversalRate,
        averageIntelligenceGap: roundMetric(averageIntelligenceGap),
        averageBenchmarkMargin: roundMetric(averageBenchmarkMargin),
        averageSurprise: roundMetric(averageSurprise),
        usefulReversalScore: roundMetric(usefulReversalScore),
        interpretation: benchmarkReversalInterpretation(reversalRate, coverage, correlation),
      };
    })
    .sort((a, b) => b.usefulReversalScore - a.usefulReversalScore);
}

function buildCompositeBenchmarkCandidates(
  benchmarkScores: ReturnType<typeof buildBenchmarkReversalScores>,
) {
  return benchmarkScores
    .map((row) => ({
      ...row,
      compositeUsefulness: roundMetric(
        row.coverageRate *
          (0.45 * row.reversalRate + 0.35 * Math.max(0, 1 - row.correlation) + 0.2),
      ),
      rationale:
        row.reversalRate > 0.1 && row.coverageRate > 0.75
          ? "Good candidate: frequent reversals with broad coverage."
          : row.reversalRate > 0.1
            ? "Interesting but coverage should be checked before using it in a composite score."
            : "More useful as a stabilizer than as an extreme-skill detector.",
    }))
    .sort((a, b) => b.compositeUsefulness - a.compositeUsefulness)
    .slice(0, 12);
}

function buildShortestPathAnalysis(pathCounts: Map<number, number>, totalReachable: number) {
  const distribution = [...pathCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hops, count]) => ({
      hops,
      count,
      share: rate(count, totalReachable),
    }));
  const expanded = distribution.flatMap((row) => Array.from({ length: row.count }, () => row.hops));
  return {
    note:
      "Shortest-path metrics are computed from reconstructed shortest paths for each reachable weak-to-strong pair, not by treating reachability alone as a path statistic.",
    distribution,
    meanHops: roundMetric(average(expanded)),
    medianHops: percentile(expanded, 0.5),
    p90Hops: percentile(expanded, 0.9),
    oneHopShare: distribution.find((row) => row.hops === 1)?.share ?? 0,
    twoOrThreeHopShare: roundMetric(
      (distribution.find((row) => row.hops === 2)?.share ?? 0) +
        (distribution.find((row) => row.hops === 3)?.share ?? 0),
    ),
    interpretation:
      "Many 2-3 hop paths imply a small-world ability graph: models are not linearly ordered, and bridge models connect different benchmark skill islands.",
  };
}

function buildModelAbilityFingerprints(
  triples: ReturnType<typeof buildWeakToStrongTriples>,
  bridgeCountMap: Map<string, number>,
  sourceMissMap: Map<string, number>,
  targetMissMap: Map<string, number>,
) {
  const sourceUpsets = new Map<string, { count: number; surprise: number }>();
  const targetVulnerability = new Map<string, { count: number; surprise: number }>();
  for (const triple of triples) {
    const sourceId = triple.source?.id;
    const targetId = triple.target?.id;
    if (sourceId) {
      const current = sourceUpsets.get(sourceId) ?? { count: 0, surprise: 0 };
      current.count += 1;
      current.surprise += triple.surpriseScore;
      sourceUpsets.set(sourceId, current);
    }
    if (targetId) {
      const current = targetVulnerability.get(targetId) ?? { count: 0, surprise: 0 };
      current.count += 1;
      current.surprise += triple.surpriseScore;
      targetVulnerability.set(targetId, current);
    }
  }

  const residualsByModel = buildResidualsByModel();
  return modelsWithIntelligence
    .map((model) => {
      const upset = sourceUpsets.get(model.id) ?? { count: 0, surprise: 0 };
      const vulnerability = targetVulnerability.get(model.id) ?? { count: 0, surprise: 0 };
      const bridgeCount = bridgeCountMap.get(model.id) ?? 0;
      const missesAsSource = sourceMissMap.get(model.id) ?? 0;
      const missesAsTarget = targetMissMap.get(model.id) ?? 0;
      const residuals = residualsByModel.get(model.id) ?? [];
      const strongResiduals = residuals
        .filter((item) => item.residual > 0)
        .sort((a, b) => b.residual - a.residual)
        .slice(0, 3);
      const weakResiduals = residuals
        .filter((item) => item.residual < 0)
        .sort((a, b) => a.residual - b.residual)
        .slice(0, 3);
      const roleScore = upset.count + vulnerability.count + bridgeCount;
      return {
        model: modelSummary(model),
        role: classifyModelRole(upset.count, vulnerability.count, bridgeCount, residuals.length),
        upsetPower: {
          count: upset.count,
          surprise: roundMetric(upset.surprise),
        },
        vulnerability: {
          count: vulnerability.count,
          surprise: roundMetric(vulnerability.surprise),
        },
        bridgeCount,
        missesAsSource,
        missesAsTarget,
        benchmarkCoverage: residuals.length,
        strongResiduals,
        weakResiduals,
        roleScore,
      };
    })
    .sort((a, b) => b.roleScore - a.roleScore)
    .slice(0, 30);
}

function buildResidualsByModel() {
  const rows = new Map<string, Array<Record<string, unknown> & { residual: number }>>();
  for (const metric of evidenceMetrics) {
    const regression = linearRegressionForMetric(metric);
    if (!regression) continue;
    for (const model of modelsWithIntelligence) {
      const intelligence = reportMetricValue(model, "intelligence");
      const actual = reportMetricValue(model, metric);
      if (intelligence === undefined || actual === undefined) continue;
      const expected = regression.intercept + regression.slope * intelligence;
      const residual = normalizeMargin(actual - expected, metric);
      const list = rows.get(model.id) ?? [];
      list.push({
        metric,
        label: getMetricDefinition(metric).label,
        actual: formatMetricValue(actual, metric),
        expected: formatMetricValue(expected, metric),
        residual: roundMetric(residual),
      });
      rows.set(model.id, list);
    }
  }
  return rows;
}

function linearRegressionForMetric(metric: LeaderboardMetric) {
  const pairs = modelsWithIntelligence
    .map((model) => ({
      x: reportMetricValue(model, "intelligence"),
      y: reportMetricValue(model, metric),
    }))
    .filter((pair): pair is { x: number; y: number } => pair.x !== undefined && pair.y !== undefined);
  if (pairs.length < 2) return undefined;
  const meanX = average(pairs.map((pair) => pair.x));
  const meanY = average(pairs.map((pair) => pair.y));
  let numerator = 0;
  let denominator = 0;
  for (const pair of pairs) {
    numerator += (pair.x - meanX) * (pair.y - meanY);
    denominator += (pair.x - meanX) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  return {
    slope,
    intercept: meanY - slope * meanX,
  };
}

function classifyModelRole(
  upsetCount: number,
  vulnerabilityCount: number,
  bridgeCount: number,
  coverage: number,
) {
  if (bridgeCount >= 900) return "bridge model";
  if (upsetCount >= 700 && vulnerabilityCount < 500) return "specialist";
  if (vulnerabilityCount >= 700) return "vulnerable target";
  if (coverage >= 10 && vulnerabilityCount < 150) return "robust generalist";
  return "mixed profile";
}

function benchmarkReversalInterpretation(
  reversalRate: number,
  coverage: number,
  correlation: number,
) {
  if (reversalRate >= 0.1 && coverage >= 0.75 && correlation < 0.85) {
    return "Strong independent-skill signal";
  }
  if (reversalRate >= 0.1 && coverage < 0.75) {
    return "High reversal signal, but coverage is limited";
  }
  if (reversalRate < 0.05 && correlation >= 0.85) {
    return "Mostly tracks the aggregate ranking";
  }
  return "Mixed reversal signal";
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

function reportMetricValue(model: ModelRecord, metric: LeaderboardMetric) {
  const value = metricValue(model, metric);
  if (value === undefined) return undefined;
  const definition = getMetricDefinition(metric);
  if (definition.isBenchmark && value <= 0) return undefined;
  return value;
}

function sumMap(map: Map<string, number>) {
  return [...map.values()].reduce((sum, value) => sum + value, 0);
}

function rate(numerator: number, denominator: number) {
  return denominator ? roundMetric(numerator / denominator) : 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index];
}

function normalizeMargin(value: number, metric: LeaderboardMetric) {
  return getMetricDefinition(metric).valueKind === "percent" ? value * 100 : value;
}

function formatBenchmarkMargin(value: number, metric: LeaderboardMetric) {
  if (getMetricDefinition(metric).valueKind === "percent") {
    return `${(value * 100).toFixed(1)} pp`;
  }
  return formatMetricValue(value, metric);
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}
