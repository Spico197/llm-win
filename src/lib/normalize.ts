import { metricDefinitions } from "./metrics";
import type { ModelMetrics, ModelRecord } from "./types";

type AaModel = Record<string, unknown>;

const sourceUrl = "https://artificialanalysis.ai/leaderboards/models";

export function normalizeAaModels(records: AaModel[], updatedAt: string) {
  return records
    .map((record) => normalizeAaModel(record, updatedAt))
    .filter((model): model is ModelRecord => Boolean(model));
}

function normalizeAaModel(record: AaModel, updatedAt: string): ModelRecord | undefined {
  const name = stringValue(record.name);
  if (!name) return undefined;

  const slug = stringValue(record.slug);
  const id = stringValue(record.id) || slug || slugify(name);
  const creator = objectValue(record.model_creator);
  const evaluations = objectValue(record.evaluations);
  const pricing = objectValue(record.pricing);

  const metrics: ModelMetrics = {
    intelligence: numberValue(evaluations.artificial_analysis_intelligence_index),
    coding: numberValue(evaluations.artificial_analysis_coding_index),
    math: numberValue(evaluations.artificial_analysis_math_index),
    outputSpeedTokensPerSecond: numberValue(record.median_output_tokens_per_second),
    latencySeconds: numberValue(record.median_time_to_first_token_seconds),
    endToEndResponseSeconds: numberValue(record.median_time_to_first_answer_token),
    priceUsdPerMillionTokens: numberValue(pricing.price_1m_blended_3_to_1),
  };
  for (const [key, value] of Object.entries(evaluations)) {
    if (key.startsWith("artificial_analysis_")) continue;
    const numericValue = numberValue(value);
    if (numericValue !== undefined) metrics[key] = numericValue;
  }

  return {
    id,
    name,
    slug,
    provider: stringValue(creator.name),
    sourceUrl: slug ? `https://artificialanalysis.ai/models/${slug}` : sourceUrl,
    updatedAt,
    metrics: Object.fromEntries(
      Object.entries(metrics)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => metricSortIndex(a) - metricSortIndex(b) || a.localeCompare(b)),
    ),
  };
}

function metricSortIndex(metric: string) {
  const index = Object.keys(metricDefinitions).indexOf(metric);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
