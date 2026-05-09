import { availableMetrics, metricValue, sortModelsByMetric } from "./metrics";
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  Leaderboards,
  ModelRecord,
} from "./types";

export function buildLeaderboards(models: ModelRecord[]) {
  const leaderboards: Leaderboards = {};
  for (const metric of availableMetrics(models)) {
    const entries = buildLeaderboard(models, metric);
    if (entries.length) leaderboards[metric] = entries;
  }
  return leaderboards;
}

export function buildLeaderboard(
  models: ModelRecord[],
  metric: LeaderboardMetric,
): LeaderboardEntry[] {
  return sortModelsByMetric(models, metric).map((model, index) => ({
    rank: index + 1,
    modelId: model.id,
    name: model.name,
    provider: model.provider,
    value: metricValue(model, metric) ?? 0,
  }));
}
