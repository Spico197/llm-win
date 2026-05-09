import type {
  LeaderboardMetric,
  MetricDefinition,
  ModelRecord,
} from "./types";

export const baseMetricDefinitions: Record<string, MetricDefinition> = {
  intelligence: {
    key: "intelligence",
    label: "AA Intelligence Index",
    shortLabel: "IQ",
    category: "Intelligence",
    direction: "higher_is_better",
    precision: 1,
    minimumMargin: 0.1,
    sourceKey: "evaluations.artificial_analysis_intelligence_index",
  },
  coding: {
    key: "coding",
    label: "AA Coding Index",
    shortLabel: "Code",
    category: "Coding",
    direction: "higher_is_better",
    precision: 1,
    minimumMargin: 0.1,
    sourceKey: "evaluations.artificial_analysis_coding_index",
  },
  math: {
    key: "math",
    label: "AA Math Index",
    shortLabel: "Math",
    category: "Math",
    direction: "higher_is_better",
    precision: 1,
    minimumMargin: 0.1,
    sourceKey: "evaluations.artificial_analysis_math_index",
  },
  outputSpeedTokensPerSecond: {
    key: "outputSpeedTokensPerSecond",
    label: "Output speed",
    shortLabel: "Speed",
    category: "Speed",
    direction: "higher_is_better",
    unit: "tok/s",
    precision: 1,
    minimumMargin: 0.1,
    sourceKey: "median_output_tokens_per_second",
  },
  latencySeconds: {
    key: "latencySeconds",
    label: "Latency",
    shortLabel: "Latency",
    category: "Latency",
    direction: "lower_is_better",
    unit: "s",
    precision: 2,
    minimumMargin: 0.01,
    sourceKey: "median_time_to_first_token_seconds",
  },
  endToEndResponseSeconds: {
    key: "endToEndResponseSeconds",
    label: "End-to-end response",
    shortLabel: "E2E",
    category: "Latency",
    direction: "lower_is_better",
    unit: "s",
    precision: 2,
    minimumMargin: 0.01,
    sourceKey: "median_time_to_first_answer_token",
  },
  priceUsdPerMillionTokens: {
    key: "priceUsdPerMillionTokens",
    label: "Blended price",
    shortLabel: "Price",
    category: "Price",
    direction: "lower_is_better",
    unit: "$/1M",
    precision: 2,
    minimumMargin: 0.01,
    valueKind: "currency",
    sourceKey: "pricing.price_1m_blended_3_to_1",
  },
};

export const benchmarkMetricDefinitions: Record<string, MetricDefinition> = {
  mmlu_pro: benchmark("mmlu_pro", "MMLU-Pro", "MMLU", "Intelligence"),
  gpqa: benchmark("gpqa", "GPQA", "GPQA", "Intelligence"),
  hle: benchmark("hle", "Humanity's Last Exam", "HLE", "Intelligence"),
  ifbench: benchmark("ifbench", "IFBench", "IFBench", "Intelligence"),
  lcr: benchmark("lcr", "LCR", "LCR", "Intelligence"),
  tau2: benchmark("tau2", "TAU2", "TAU2", "Intelligence"),
  livecodebench: benchmark("livecodebench", "LiveCodeBench", "LCB", "Coding"),
  scicode: benchmark("scicode", "SciCode", "SciCode", "Coding"),
  terminalbench_hard: benchmark(
    "terminalbench_hard",
    "Terminal-Bench Hard",
    "TBench",
    "Coding",
  ),
  math_500: benchmark("math_500", "MATH-500", "MATH", "Math"),
  aime: benchmark("aime", "AIME", "AIME", "Math"),
  aime_25: benchmark("aime_25", "AIME 2025", "AIME25", "Math"),
};

export const metricDefinitions: Record<string, MetricDefinition> = {
  ...baseMetricDefinitions,
  ...benchmarkMetricDefinitions,
};

export const defaultMetricOrder: LeaderboardMetric[] = [
  "intelligence",
  "mmlu_pro",
  "gpqa",
  "hle",
  "ifbench",
  "lcr",
  "tau2",
  "coding",
  "livecodebench",
  "scicode",
  "terminalbench_hard",
  "math",
  "math_500",
  "aime",
  "aime_25",
  "outputSpeedTokensPerSecond",
  "latencySeconds",
  "endToEndResponseSeconds",
  "priceUsdPerMillionTokens",
];

function benchmark(
  key: string,
  label: string,
  shortLabel: string,
  category: string,
): MetricDefinition {
  return {
    key,
    label,
    shortLabel,
    category,
    direction: "higher_is_better",
    precision: 1,
    minimumMargin: 0.001,
    valueKind: "percent",
    sourceKey: `evaluations.${key}`,
    isBenchmark: true,
  };
}

export function getMetricDefinition(metric: LeaderboardMetric): MetricDefinition {
  return (
    metricDefinitions[metric] ?? {
      key: metric,
      label: titleize(metric),
      shortLabel: titleize(metric),
      category: "Benchmarks",
      direction: "higher_is_better",
      precision: 1,
      minimumMargin: 0.001,
      valueKind: "percent",
      sourceKey: `evaluations.${metric}`,
      isBenchmark: true,
    }
  );
}

export function metricValue(model: ModelRecord, metric: LeaderboardMetric) {
  const value = model.metrics[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function beatsByMetric(
  a: ModelRecord,
  b: ModelRecord,
  metric: LeaderboardMetric,
  minimumMargin = getMetricDefinition(metric).minimumMargin,
) {
  const aValue = metricValue(a, metric);
  const bValue = metricValue(b, metric);
  if (aValue === undefined || bValue === undefined) return false;
  const direction = getMetricDefinition(metric).direction;
  return direction === "higher_is_better"
    ? aValue - bValue >= minimumMargin
    : bValue - aValue >= minimumMargin;
}

export function metricMargin(
  aValue: number,
  bValue: number,
  metric: LeaderboardMetric,
) {
  return getMetricDefinition(metric).direction === "higher_is_better"
    ? aValue - bValue
    : bValue - aValue;
}

export function sortModelsByMetric(
  models: ModelRecord[],
  metric: LeaderboardMetric,
) {
  const direction = getMetricDefinition(metric).direction;
  return models
    .filter((model) => metricValue(model, metric) !== undefined)
    .sort((a, b) => {
      const aValue = metricValue(a, metric) ?? 0;
      const bValue = metricValue(b, metric) ?? 0;
      const delta =
        direction === "higher_is_better" ? bValue - aValue : aValue - bValue;
      return delta || a.name.localeCompare(b.name);
    });
}

export function formatMetricValue(
  value: number | undefined,
  metric: LeaderboardMetric,
) {
  if (value === undefined) return "N/A";
  const definition = getMetricDefinition(metric);
  if (definition.valueKind === "percent") {
    return `${(value * 100).toFixed(definition.precision)}%`;
  }
  if (definition.valueKind === "integer") {
    return `${Math.round(value).toLocaleString()} ${definition.unit ?? ""}`.trim();
  }
  if (definition.valueKind === "currency" || metric === "priceUsdPerMillionTokens") {
    return `$${value.toFixed(definition.precision)}/1M`;
  }
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: definition.precision,
    minimumFractionDigits: definition.precision,
  });
  return definition.unit ? `${formatted} ${definition.unit}` : formatted;
}

export function availableMetrics(models: ModelRecord[]) {
  const discovered = new Set<LeaderboardMetric>();
  for (const model of models) {
    for (const [key, value] of Object.entries(model.metrics)) {
      if (typeof value === "number" && Number.isFinite(value)) discovered.add(key);
    }
  }
  const ordered = defaultMetricOrder.filter((metric) => discovered.has(metric));
  const extras = [...discovered]
    .filter((metric) => !defaultMetricOrder.includes(metric))
    .sort();
  return [...ordered, ...extras];
}

export function groupedMetrics(metrics: LeaderboardMetric[]) {
  const groups = new Map<string, LeaderboardMetric[]>();
  for (const metric of metrics) {
    const category = getMetricDefinition(metric).category;
    groups.set(category, [...(groups.get(category) ?? []), metric]);
  }
  return [...groups.entries()];
}

export function categoryNames(metrics: LeaderboardMetric[]) {
  const names = groupedMetrics(metrics).map(([category]) => category);
  return evidenceMetricsForCategory(metrics, "Overall").length
    ? ["Overall", ...names]
    : names;
}

export function metricsForCategory(metrics: LeaderboardMetric[], category: string) {
  if (category === "Overall") return metrics;
  return metrics.filter((metric) => getMetricDefinition(metric).category === category);
}

export function evidenceMetricsForCategory(metrics: LeaderboardMetric[], category: string) {
  if (category === "Overall") {
    return metrics.filter((metric) => getMetricDefinition(metric).isBenchmark);
  }
  const categoryMetrics = metricsForCategory(metrics, category);
  const benchmarks = categoryMetrics.filter(
    (metric) => getMetricDefinition(metric).isBenchmark,
  );
  return benchmarks.length ? benchmarks : categoryMetrics;
}

function titleize(value: string) {
  return value
    .replace(/^artificial_analysis_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
