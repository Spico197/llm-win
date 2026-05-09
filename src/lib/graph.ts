import {
  beatsByMetric,
  formatMetricValue,
  getMetricDefinition,
  metricMargin,
  metricValue,
  sortModelsByMetric,
} from "./metrics";
import type {
  ChainMode,
  ChainResult,
  LeaderboardMetric,
  ModelRecord,
  WinEdge,
} from "./types";

const jumpOffsets = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

export function buildMetricEdges(
  models: ModelRecord[],
  metric: LeaderboardMetric,
  minimumMargin = getMetricDefinition(metric).minimumMargin,
) {
  const ranked = sortModelsByMetric(models, metric);
  const edges: WinEdge[] = [];
  for (let index = 0; index < ranked.length; index += 1) {
    for (const offset of jumpOffsets) {
      const target = ranked[index + offset];
      if (!target) continue;
      const edge = makeMetricEdge(ranked[index], target, metric, minimumMargin);
      if (edge) edges.push(edge);
    }
  }
  return edges;
}

export function buildMultiMetricEdges(
  models: ModelRecord[],
  metrics: LeaderboardMetric[],
  minimumMarginByMetric = new Map<LeaderboardMetric, number>(),
) {
  const edges: WinEdge[] = [];
  for (const from of models) {
    for (const to of models) {
      if (from.id === to.id) continue;
      const bestMetric = metrics.find((metric) =>
        beatsByMetric(
          from,
          to,
          metric,
          minimumMarginByMetric.get(metric) ?? getMetricDefinition(metric).minimumMargin,
        ),
      );
      if (!bestMetric) continue;
      const edge = makeMetricEdge(
        from,
        to,
        bestMetric,
        minimumMarginByMetric.get(bestMetric) ??
          getMetricDefinition(bestMetric).minimumMargin,
      );
      if (edge) edges.push({ ...edge, metric: "multi_metric", evidenceMetric: bestMetric });
    }
  }
  return edges;
}

export function buildCategoryEdges(
  models: ModelRecord[],
  metrics: LeaderboardMetric[],
) {
  const edges: WinEdge[] = [];
  const seen = new Set<string>();
  for (const metric of metrics) {
    for (const edge of buildMetricEdges(models, metric)) {
      const key = `${edge.fromModelId}:${edge.toModelId}:${metric}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ ...edge, evidenceMetric: metric });
    }
  }
  return edges;
}

export function buildParetoEdges(
  models: ModelRecord[],
  metrics: LeaderboardMetric[],
  minimumMarginByMetric = new Map<LeaderboardMetric, number>(),
) {
  const edges: WinEdge[] = [];
  for (const from of models) {
    for (const to of models) {
      if (from.id === to.id) continue;
      const comparable = metrics.every(
        (metric) => metricValue(from, metric) !== undefined && metricValue(to, metric) !== undefined,
      );
      if (!comparable) continue;

      const neverWorse = metrics.every((metric) => {
        const fromValue = metricValue(from, metric) ?? 0;
        const toValue = metricValue(to, metric) ?? 0;
        return getMetricDefinition(metric).direction === "higher_is_better"
          ? fromValue >= toValue
          : fromValue <= toValue;
      });
      const strictlyBetterMetric = metrics.find((metric) =>
        beatsByMetric(
          from,
          to,
          metric,
          minimumMarginByMetric.get(metric) ?? getMetricDefinition(metric).minimumMargin,
        ),
      );
      if (!neverWorse || !strictlyBetterMetric) continue;

      const fromValue = metricValue(from, strictlyBetterMetric);
      const toValue = metricValue(to, strictlyBetterMetric);
      edges.push({
        fromModelId: from.id,
        toModelId: to.id,
        metric: "pareto",
        evidenceMetric: strictlyBetterMetric,
        fromValue,
        toValue,
        margin:
          fromValue !== undefined && toValue !== undefined
            ? metricMargin(fromValue, toValue, strictlyBetterMetric)
            : undefined,
        explanation: `${from.name} dominates ${to.name}; strongest visible edge is ${getMetricDefinition(strictlyBetterMetric).label}: ${formatMetricValue(fromValue, strictlyBetterMetric)} vs ${formatMetricValue(toValue, strictlyBetterMetric)}.`,
      });
    }
  }
  return edges;
}

export function makeMetricEdge(
  from: ModelRecord,
  to: ModelRecord,
  metric: LeaderboardMetric,
  minimumMargin = getMetricDefinition(metric).minimumMargin,
): WinEdge | undefined {
  const fromValue = metricValue(from, metric);
  const toValue = metricValue(to, metric);
  if (fromValue === undefined || toValue === undefined) return undefined;
  const margin = metricMargin(fromValue, toValue, metric);
  if (margin < minimumMargin) return undefined;

  const definition = getMetricDefinition(metric);
  return {
    fromModelId: from.id,
    toModelId: to.id,
    metric,
    fromValue,
    toValue,
    margin,
    explanation: `${from.name} beats ${to.name} on ${definition.label}: ${formatMetricValue(fromValue, metric)} vs ${formatMetricValue(toValue, metric)}.`,
  };
}

export function findShortestPath(
  edges: WinEdge[],
  sourceModelId: string,
  targetModelId: string,
  maximumHops = 6,
): ChainResult {
  if (!sourceModelId || !targetModelId || sourceModelId === targetModelId) {
    return { found: false, edges: [] };
  }

  const adjacency = new Map<string, WinEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromModelId) ?? [];
    list.push(edge);
    adjacency.set(edge.fromModelId, list);
  }

  const queue: Array<{ modelId: string; path: WinEdge[] }> = [
    { modelId: sourceModelId, path: [] },
  ];
  const visited = new Set<string>([sourceModelId]);

  while (queue.length) {
    const current = queue.shift();
    if (!current || current.path.length >= maximumHops) continue;
    for (const edge of adjacency.get(current.modelId) ?? []) {
      const nextPath = [...current.path, edge];
      if (edge.toModelId === targetModelId) {
        return { found: true, edges: nextPath };
      }
      if (!visited.has(edge.toModelId)) {
        visited.add(edge.toModelId);
        queue.push({ modelId: edge.toModelId, path: nextPath });
      }
    }
  }

  return { found: false, edges: [] };
}

export function buildEdgesForMode(
  models: ModelRecord[],
  mode: ChainMode,
  metric: LeaderboardMetric,
  metrics: LeaderboardMetric[],
) {
  if (mode === "metric") return buildMetricEdges(models, metric);
  if (mode === "pareto") return buildParetoEdges(models, metrics);
  return buildMultiMetricEdges(models, metrics);
}
