export type LeaderboardMetric = string;

export type MetricDirection = "higher_is_better" | "lower_is_better";

export type MetricDefinition = {
  key: LeaderboardMetric;
  label: string;
  shortLabel: string;
  category: string;
  direction: MetricDirection;
  unit?: string;
  precision: number;
  minimumMargin: number;
  valueKind?: "number" | "percent" | "currency" | "integer";
  sourceKey?: string;
  isBenchmark?: boolean;
};

export type ModelMetrics = Record<LeaderboardMetric, number | undefined>;

export type ModelRecord = {
  id: string;
  name: string;
  slug?: string;
  provider?: string;
  sourceUrl: string;
  updatedAt: string;
  metrics: ModelMetrics;
};

export type LeaderboardEntry = {
  rank: number;
  modelId: string;
  name: string;
  provider?: string;
  value: number;
};

export type Leaderboards = Partial<Record<LeaderboardMetric, LeaderboardEntry[]>>;

export type DataMetadata = {
  generatedAt: string;
  source: string;
  sourceUrl: string;
  modelCount: number;
  isPlaceholder?: boolean;
  availableMetrics?: LeaderboardMetric[];
  rawDataPath?: string;
  promptOptions?: Record<string, unknown>;
};

export type ChainMode = "metric" | "multi" | "pareto";

export type WinEdge = {
  fromModelId: string;
  toModelId: string;
  metric: LeaderboardMetric | "multi_metric" | "pareto";
  evidenceMetric?: LeaderboardMetric;
  fromValue?: number;
  toValue?: number;
  margin?: number;
  explanation: string;
};

export type ChainResult = {
  found: boolean;
  edges: WinEdge[];
};
