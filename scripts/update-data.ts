import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  availableMetrics,
  defaultMetricOrder,
  formatMetricValue,
  getMetricDefinition,
  metricValue,
} from "../src/lib/metrics";
import { buildLeaderboards } from "../src/lib/leaderboards";
import { normalizeAaModels } from "../src/lib/normalize";
import type { DataMetadata, LeaderboardMetric, Leaderboards, ModelRecord } from "../src/lib/types";

const endpoint = "https://artificialanalysis.ai/api/v2/data/llms/models";
const sourceUrl = "https://artificialanalysis.ai/leaderboards/models";
const outputDir = path.join(process.cwd(), "public", "data");

loadLocalEnv();

const apiKey = process.env.AA_API_KEY;
if (!apiKey) {
  throw new Error("AA_API_KEY is required. Put it in .env locally or GitHub Actions secrets.");
}

const startedAt = new Date().toISOString();
const response = await fetch(endpoint, {
  headers: {
    "x-api-key": apiKey,
    accept: "application/json",
  },
});

if (!response.ok) {
  throw new Error(`Artificial Analysis request failed with HTTP ${response.status}.`);
}

const payload = await response.json();
const rawModels = Array.isArray(payload.data) ? payload.data : [];
if (!rawModels.length) {
  throw new Error("Artificial Analysis response did not include any model records.");
}

const models = normalizeAaModels(rawModels, startedAt);
if (models.length < rawModels.length * 0.75) {
  throw new Error(`Only normalized ${models.length} of ${rawModels.length} model records.`);
}

await mkdir(outputDir, { recursive: true });

const previousModels = await readJson<ModelRecord[]>("models.json", []);
const previousLeaderboards = await readJson<Leaderboards>("leaderboards.json", {});
const previousMetadata = await readJson<DataMetadata | undefined>("metadata.json", undefined);
if (previousModels.length > 0 && models.length < previousModels.length * 0.75) {
  throw new Error(
    `Model count dropped from ${previousModels.length} to ${models.length}; refusing to overwrite generated data.`,
  );
}

const leaderboards = buildLeaderboards(models);
const changeSummary = buildChangeSummary({
  currentLeaderboards: leaderboards,
  currentModels: models,
  generatedAt: startedAt,
  previousGeneratedAt: previousMetadata?.generatedAt,
  previousLeaderboards,
  previousModels,
});
const metadata: DataMetadata = {
  generatedAt: startedAt,
  source: "Artificial Analysis",
  sourceUrl,
  modelCount: models.length,
  availableMetrics: availableMetrics(models),
  rawDataPath: "/data/raw.json",
  promptOptions:
    payload.prompt_options && typeof payload.prompt_options === "object"
      ? payload.prompt_options
      : undefined,
};

await writeJson("models.json", models);
await writeJson("raw.json", payload);
await writeJson("leaderboards.json", leaderboards);
await writeJson("metadata.json", metadata);
await writeJson("data-change.json", changeSummary);
await writeJson("graph.json", {
  generatedAt: startedAt,
  source: "Artificial Analysis",
  edgesByMetric: {},
  note: "Edges are computed in the browser from normalized model data.",
});

console.log(
  `Updated ${models.length} models across ${metadata.availableMetrics?.length ?? 0} metrics from Artificial Analysis.`,
);

async function writeJson(fileName: string, value: unknown) {
  await writeFile(path.join(outputDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path.join(outputDir, fileName), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function buildChangeSummary({
  currentLeaderboards,
  currentModels,
  generatedAt,
  previousGeneratedAt,
  previousLeaderboards,
  previousModels,
}: {
  currentLeaderboards: Leaderboards;
  currentModels: ModelRecord[];
  generatedAt: string;
  previousGeneratedAt?: string;
  previousLeaderboards: Leaderboards;
  previousModels: ModelRecord[];
}) {
  const previousById = new Map(previousModels.map((model) => [model.id, model]));
  const currentById = new Map(currentModels.map((model) => [model.id, model]));
  const addedModels = currentModels
    .filter((model) => !previousById.has(model.id))
    .map(modelSummary)
    .sort((a, b) => a.name.localeCompare(b.name));
  const removedModels = previousModels
    .filter((model) => !currentById.has(model.id))
    .map(modelSummary)
    .sort((a, b) => a.name.localeCompare(b.name));
  const metrics = availableMetrics([...previousModels, ...currentModels]);
  const metricChanges = collectMetricChanges(previousModels, currentById, metrics);
  const rankChanges = collectRankChanges(previousLeaderboards, currentLeaderboards);
  const summary = summarizeChanges({
    addedModels,
    currentModels,
    metricChanges,
    previousModels,
    rankChanges,
    removedModels,
  });

  return {
    generatedAt,
    previousGeneratedAt,
    modelCountBefore: previousModels.length,
    modelCountAfter: currentModels.length,
    modelCountDelta: currentModels.length - previousModels.length,
    addedModels: addedModels.slice(0, 20),
    removedModels: removedModels.slice(0, 20),
    metricChanges: metricChanges.slice(0, 20),
    rankChanges: rankChanges.slice(0, 20),
    summary,
  };
}

function collectMetricChanges(
  previousModels: ModelRecord[],
  currentById: Map<string, ModelRecord>,
  metrics: LeaderboardMetric[],
) {
  return previousModels.flatMap((previous) => {
    const current = currentById.get(previous.id);
    if (!current) return [];
    return metrics.flatMap((metric) => {
      const previousValue = metricValue(previous, metric);
      const currentValue = metricValue(current, metric);
      if (previousValue === undefined || currentValue === undefined) return [];
      const delta = currentValue - previousValue;
      const minimumMargin = getMetricDefinition(metric).minimumMargin;
      if (Math.abs(delta) < minimumMargin) return [];
      return [
        {
          model: modelSummary(current),
          metric,
          metricLabel: getMetricDefinition(metric).label,
          previousValue,
          currentValue,
          previousFormatted: formatMetricValue(previousValue, metric),
          currentFormatted: formatMetricValue(currentValue, metric),
          delta: roundMetric(delta),
          absoluteDelta: roundMetric(Math.abs(delta)),
          direction: delta > 0 ? "up" : "down",
          isImprovement: isImprovement(delta, metric),
        },
      ];
    });
  }).sort((a, b) => b.absoluteDelta - a.absoluteDelta);
}

function collectRankChanges(previousLeaderboards: Leaderboards, currentLeaderboards: Leaderboards) {
  const metrics = defaultMetricOrder.filter(
    (metric) => previousLeaderboards[metric]?.length && currentLeaderboards[metric]?.length,
  );
  return metrics.flatMap((metric) => {
    const currentEntries = currentLeaderboards[metric] ?? [];
    const previousRanks = new Map(
      (previousLeaderboards[metric] ?? []).map((entry) => [entry.modelId, entry.rank]),
    );
    return currentEntries.flatMap((entry) => {
      const previousRank = previousRanks.get(entry.modelId);
      if (previousRank === undefined) return [];
      const rankDelta = previousRank - entry.rank;
      if (rankDelta === 0) return [];
      return [
        {
          model: {
            id: entry.modelId,
            name: entry.name,
            provider: entry.provider,
          },
          metric,
          metricLabel: getMetricDefinition(metric).label,
          previousRank,
          currentRank: entry.rank,
          rankDelta,
          direction: rankDelta > 0 ? "up" : "down",
        },
      ];
    });
  }).sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta));
}

function summarizeChanges({
  addedModels,
  currentModels,
  metricChanges,
  previousModels,
  rankChanges,
  removedModels,
}: {
  addedModels: ReturnType<typeof modelSummary>[];
  currentModels: ModelRecord[];
  metricChanges: ReturnType<typeof collectMetricChanges>;
  previousModels: ModelRecord[];
  rankChanges: ReturnType<typeof collectRankChanges>;
  removedModels: ReturnType<typeof modelSummary>[];
}) {
  if (!previousModels.length) {
    return [`Initial data snapshot contains ${currentModels.length.toLocaleString()} models.`];
  }

  const lines = [
    `This refresh has ${currentModels.length.toLocaleString()} models, ${formatCountDelta(
      currentModels.length - previousModels.length,
    )} compared with the previous snapshot.`,
  ];
  if (addedModels.length) {
    lines.push(`New models include ${joinNames(addedModels.slice(0, 5))}.`);
  }
  if (removedModels.length) {
    lines.push(`Removed models include ${joinNames(removedModels.slice(0, 5))}.`);
  }
  const largestMetricChange = metricChanges[0];
  if (largestMetricChange) {
    lines.push(
      `Largest metric move: ${largestMetricChange.model.name} on ${largestMetricChange.metricLabel}, from ${largestMetricChange.previousFormatted} to ${largestMetricChange.currentFormatted}.`,
    );
  }
  const largestRankChange = rankChanges[0];
  if (largestRankChange) {
    lines.push(
      `Largest rank move: ${largestRankChange.model.name} ${formatRankMovement(
        largestRankChange.rankDelta,
      )} on ${largestRankChange.metricLabel}.`,
    );
  }
  if (!addedModels.length && !removedModels.length && !metricChanges.length && !rankChanges.length) {
    lines.push("No material model, metric, or rank changes were detected.");
  }
  return lines;
}

function isImprovement(delta: number, metric: LeaderboardMetric) {
  const direction = getMetricDefinition(metric).direction;
  return direction === "higher_is_better" ? delta > 0 : delta < 0;
}

function modelSummary(model: ModelRecord) {
  return {
    id: model.id,
    slug: model.slug,
    name: model.name,
    provider: model.provider,
  };
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

function formatCountDelta(value: number) {
  if (value === 0) return "no count change";
  return formatSignedNumber(value);
}

function formatRankMovement(value: number) {
  const places = Math.abs(value).toLocaleString();
  if (value > 0) return `climbed ${places} places`;
  return `dropped ${places} places`;
}

function joinNames(models: Array<{ name: string }>) {
  return models.map((model) => model.name).join(", ");
}

function roundMetric(value: number) {
  return Number(value.toFixed(6));
}

function loadLocalEnv() {
  if (process.env.AA_API_KEY) return;
  try {
    const text = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional in CI because GitHub Actions provides secrets through env.
  }
}
