import React from "react";
import ReactDOM from "react-dom/client";
import { Activity, ArrowRight, ChevronDown, Download, RefreshCw, Search, Share2, Sparkles } from "lucide-react";
import { installAnalytics } from "./analytics";
import {
  availableMetrics,
  categoryNames,
  defaultMetricOrder,
  evidenceMetricsForCategory,
  formatMetricValue,
  getMetricDefinition,
  sortModelsByMetric,
} from "./lib/metrics";
import { buildCategoryEdges, findShortestPath } from "./lib/graph";
import type {
  DataMetadata,
  LeaderboardMetric,
  Leaderboards,
  ModelRecord,
  WinEdge,
} from "./lib/types";
import "./styles.css";

declare global {
  interface Window {
    __llmWinRoot?: ReactDOM.Root;
  }
}

type AppData = {
  models: ModelRecord[];
  leaderboards: Leaderboards;
  metadata: DataMetadata;
  report?: ReportData;
};

type ReportData = {
  generatedAt: string;
  changeSummary?: {
    generatedAt: string;
    previousGeneratedAt?: string;
    modelCountBefore: number;
    modelCountAfter: number;
    modelCountDelta: number;
    addedModels: Array<{ name: string; provider?: string }>;
    removedModels: Array<{ name: string; provider?: string }>;
    metricChanges: Array<{
      model: { name: string; provider?: string };
      metricLabel: string;
      previousFormatted: string;
      currentFormatted: string;
      isImprovement: boolean;
    }>;
    rankChanges: Array<{
      model: { name: string; provider?: string };
      metricLabel: string;
      previousRank: number;
      currentRank: number;
      rankDelta: number;
    }>;
    summary: string[];
  };
  analysisIdeas: Array<{ title: string; question: string; implemented: boolean }>;
  summary: {
    modelCount: number;
    modelsWithIntelligence: number;
    graphEdgeCount: number;
    directWeakToStrongTriples?: number;
    checkedWeakerToStrongerPairs: number;
    reachablePairs: number;
    unreachablePairs: number;
    reachableRate: number;
    unreachableRate: number;
    directUpsetEdgeCount: number;
  };
  shortestPathAnalysis?: {
    note: string;
    meanHops: number;
    medianHops: number;
    p90Hops: number;
    oneHopShare: number;
    twoOrThreeHopShare: number;
    interpretation: string;
  };
  topWeakToStrongTriples?: Array<{
    source: { name: string; provider?: string; intelligence: number | null };
    target: { name: string; provider?: string; intelligence: number | null };
    metricLabel: string;
    sourceFormatted: string;
    targetFormatted: string;
    intelligenceGap: number;
    benchmarkMarginFormatted: string;
    surpriseScore: number;
  }>;
  benchmarkReversalScores?: Array<{
    metric: string;
    label: string;
    category: string;
    coverageRate: number;
    correlation: number;
    reversalTriples: number;
    reversalRate: number;
    averageIntelligenceGap: number;
    averageBenchmarkMargin: number;
    usefulReversalScore: number;
    interpretation: string;
  }>;
  compositeBenchmarkCandidates?: Array<{
    metric: string;
    label: string;
    coverageRate: number;
    correlation: number;
    reversalRate: number;
    compositeUsefulness: number;
    rationale: string;
  }>;
  modelAbilityFingerprints?: Array<{
    model: { name: string; provider?: string; intelligence: number | null };
    role: string;
    upsetPower: { count: number; surprise: number };
    vulnerability: { count: number; surprise: number };
    bridgeCount: number;
    benchmarkCoverage: number;
    strongResiduals: Array<{ label: string; actual: string; expected: string; residual: number }>;
    weakResiduals: Array<{ label: string; actual: string; expected: string; residual: number }>;
  }>;
  benchmarkCoverage: Array<{
    metric: string;
    label: string;
    category: string;
    modelCount: number;
    coverageRate: number;
    average: number | null;
  }>;
  benchmarkCorrelations: Array<{
    metric: string;
    label: string;
    category: string;
    sampleSize: number;
    correlation: number;
  }>;
  directUpsetsByBenchmark: Array<{
    metric: string;
    label: string;
    category: string;
    count: number;
  }>;
  pathLengths: Array<{ hops: number; count: number }>;
  pathBenchmarkUsage: Array<{ metric: string; label: string; category: string; count: number }>;
  topBridgeModels: Array<{
    model: { name: string; provider?: string; intelligence: number | null };
    count: number;
  }>;
  worstSources: Array<{
    model: { name: string; provider?: string; intelligence: number | null };
    count: number;
  }>;
  hardestTargets: Array<{
    model: { name: string; provider?: string; intelligence: number | null };
    count: number;
  }>;
  interpretation: string[];
};

function App() {
  const [data, setData] = React.useState<AppData | undefined>();
  const [error, setError] = React.useState<string | undefined>();
  const [activeView, setActiveView] = React.useState<"compare" | "leaderboards" | "report" | "methodology">("compare");
  const [category, setCategory] = React.useState("Overall");
  const [leaderboardMetric, setLeaderboardMetric] = React.useState<LeaderboardMetric>("intelligence");
  const [fromId, setFromId] = React.useState("");
  const [toId, setToId] = React.useState("");

  React.useEffect(() => {
    Promise.all([
      fetch("/data/models.json").then((response) => response.json()),
      fetch("/data/leaderboards.json").then((response) => response.json()),
      fetch("/data/metadata.json").then((response) => response.json()),
      fetch("/data/report.json")
        .then((response) => (response.ok ? response.json() : undefined))
        .catch(() => undefined),
    ])
      .then(([models, leaderboards, metadata, report]) => {
        setData({ models, leaderboards, metadata, report });
      })
      .catch(() => setError("Could not load generated leaderboard data."));
  }, []);

  const models = data?.models ?? [];
  const modelMap = React.useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );
  const metrics = React.useMemo(() => availableMetrics(models), [models]);
  const categories = React.useMemo(() => categoryNames(metrics), [metrics]);

  React.useEffect(() => {
    if (!models.length) return;
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get("from");
    const toParam = params.get("to");
    const metricParam = params.get("metric") as LeaderboardMetric | null;
    const categoryParam = params.get("category");
    const findBySlugOrId = (value: string | null) =>
      models.find((model) => model.id === value || model.slug === value)?.id;
    const rankedDefaults = sortModelsByMetric(models, "intelligence");
    const defaultFrom =
      findBySlugOrId("llama-2-chat-7b") ?? rankedDefaults[0]?.id ?? models[0].id;
    const defaultTo =
      findBySlugOrId("claude-opus-4-7") ??
      rankedDefaults[Math.min(20, rankedDefaults.length - 1)]?.id ??
      models[Math.min(12, models.length - 1)].id;

    setFromId(findBySlugOrId(fromParam) ?? defaultFrom);
    setToId(findBySlugOrId(toParam) ?? defaultTo);
    if (categoryParam && categories.includes(categoryParam)) {
      setCategory(categoryParam);
    } else if (metricParam) {
      setCategory(getMetricDefinition(metricParam).category);
      setLeaderboardMetric(metricParam);
    } else if (categories.length && !categories.includes(category)) {
      setCategory(categories[0]);
    }
  }, [models, categories]);

  React.useEffect(() => {
    if (!fromId || !toId) return;
    const from = modelMap.get(fromId);
    const to = modelMap.get(toId);
    const params = new URLSearchParams();
    if (from?.slug) params.set("from", from.slug);
    if (to?.slug) params.set("to", to.slug);
    params.set("category", category);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [fromId, toId, category, modelMap]);

  const chain = React.useMemo(() => {
    if (!models.length || !fromId || !toId) return { found: false, edges: [] };
    const graphMetrics = evidenceMetricsForCategory(metrics, category);
    const edges = buildCategoryEdges(models, graphMetrics);
    return findShortestPath(edges, fromId, toId, 9);
  }, [models, metrics, fromId, toId, category]);

  const fromModel = modelMap.get(fromId);
  const toModel = modelMap.get(toId);

  if (error) {
    return (
      <main className="shell">
        <div className="empty-state">{error}</div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="shell">
        <div className="empty-state">
          <RefreshCw aria-hidden="true" />
          Loading leaderboard data
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LLM-WIN.COM</p>
          <h1>LLM Win</h1>
        </div>
        <nav className="tabs" aria-label="Primary">
          <button className={activeView === "compare" ? "active" : ""} onClick={() => setActiveView("compare")}>
            Compare
          </button>
          <button className={activeView === "leaderboards" ? "active" : ""} onClick={() => setActiveView("leaderboards")}>
            Leaderboards
          </button>
          <button className={activeView === "report" ? "active" : ""} onClick={() => setActiveView("report")}>
            Report
          </button>
          <button className={activeView === "methodology" ? "active" : ""} onClick={() => setActiveView("methodology")}>
            Method
          </button>
        </nav>
      </header>

      {activeView === "compare" && (
        <CompareView
          chain={chain}
          fromId={fromId}
          fromModel={fromModel}
          metadata={data.metadata}
          categories={categories}
          category={category}
          metrics={metrics}
          models={models}
          setFromId={setFromId}
          setCategory={setCategory}
          setToId={setToId}
          toId={toId}
          toModel={toModel}
        />
      )}
      {activeView === "leaderboards" && (
        <LeaderboardsView leaderboards={data.leaderboards} metric={leaderboardMetric} metrics={metrics} setMetric={setLeaderboardMetric} />
      )}
      {activeView === "report" && <ReportView report={data.report} />}
      {activeView === "methodology" && <MethodologyView metadata={data.metadata} metrics={metrics} />}
      <footer className="site-footer">
        <div>
          <a href="https://github.com/Spico197/llm-win" target="_blank" rel="noreferrer">
            https://github.com/Spico197/llm-win
          </a>
        </div>
        <div>
          <span>Have fun at </span>
          <a href="https://research-slot.com" target="_blank" rel="noreferrer">
            https://research-slot.com
          </a>
        </div>
      </footer>
    </main>
  );
}

function CompareView(props: {
  chain: { found: boolean; edges: WinEdge[] };
  categories: string[];
  category: string;
  fromId: string;
  fromModel?: ModelRecord;
  metadata: DataMetadata;
  metrics: LeaderboardMetric[];
  models: ModelRecord[];
  setFromId: (value: string) => void;
  setCategory: (value: string) => void;
  setToId: (value: string) => void;
  toId: string;
  toModel?: ModelRecord;
}) {
  const {
    categories,
    category,
    chain,
    fromId,
    fromModel,
    metadata,
    metrics,
    models,
    setFromId,
    setCategory,
    setToId,
    toId,
    toModel,
  } = props;

  const headline = chain.found ? (
    <>
      YES! <span className="headline-model">{fromModel?.name ?? "This model"}</span> is
      better than <span className="headline-model">{toModel?.name ?? "that one"}</span> in{" "}
      {chain.edges.length} hop{chain.edges.length === 1 ? "" : "s"}.
    </>
  ) : (
    <>
      Not yet. <span className="headline-model">{fromModel?.name ?? "This model"}</span>{" "}
      has no receipt chain to{" "}
      <span className="headline-model">{toModel?.name ?? "that one"}</span> here.
    </>
  );
  const evidenceMetrics = evidenceMetricsForCategory(metrics, category);
  const [shareMessage, setShareMessage] = React.useState("");

  const handleDownload = React.useCallback(() => {
    downloadChainImage({
      chain,
      category,
      fromModel,
      models,
      toModel,
    });
  }, [chain, category, fromModel, models, toModel]);

  const handleShare = React.useCallback(async () => {
    const url = window.location.href;
    const copied = await copyToClipboard(url);
    if (copied) {
      setShareMessage("Link copied");
    } else {
      setShareMessage("Copy failed");
    }
    window.setTimeout(() => setShareMessage(""), 5000);
  }, []);

  return (
    <section className="compare-grid">
      <div className="control-panel">
        <div className="meme-question" aria-label="Comparison question">
          <ModelPicker label="Why" value={fromId} models={models} onChange={setFromId} />
          <div className="question-join">is better than</div>
          <ModelPicker label="Pick the target" value={toId} models={models} onChange={setToId} />
        </div>

        <label className="select-label category-select">
          Category
          <span className="select-shell">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
        </label>

        <div className="evidence-note">
          <span>Available Benchmarks: </span>
          <strong>{evidenceMetrics.map((item) => getMetricDefinition(item).shortLabel).join(", ")}</strong>
        </div>

        <div className="source-strip">
          <Activity aria-hidden="true" />
          <span>{metadata.modelCount} models</span>
          <span>Updated {formatDate(metadata.generatedAt)}</span>
        </div>
      </div>

      <div className="result-panel">
        <div className="result-heading">
          <div>
            <p className="eyebrow">Chain Results</p>
            <h2>{headline}</h2>
          </div>
          <Sparkles aria-hidden="true" />
        </div>
        {chain.found ? (
          <Chain edges={chain.edges} models={models} />
        ) : (
          <NoPath category={category} />
        )}
        <div className="result-actions">
          <button type="button" onClick={handleDownload}>
            <Download aria-hidden="true" />
            Download picture
          </button>
          <button type="button" onClick={handleShare}>
            <Share2 aria-hidden="true" />
            Share link
          </button>
          {shareMessage && <span>{shareMessage}</span>}
        </div>
      </div>
    </section>
  );
}

function ModelPicker(props: {
  label: string;
  models: ModelRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputId = React.useId();
  const selectedModel = props.models.find((model) => model.id === props.value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = props.models.filter((model) => {
    if (!normalizedQuery) return true;
    return [model.name, model.provider, model.slug]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <div
      className="model-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={inputId}>{props.label}</label>
      <button
        className="model-trigger"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${inputId}-list`}
      >
        <span>
          <strong>{selectedModel?.name ?? "Choose a model"}</strong>
          {selectedModel?.provider && <small>{selectedModel.provider}</small>}
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="model-menu">
          <div className="model-search">
            <Search aria-hidden="true" />
            <input
              id={inputId}
              autoFocus
              placeholder="Search model or provider"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="model-options" id={`${inputId}-list`} role="listbox">
            {filteredModels.map((model) => (
              <button
                key={model.id}
                type="button"
                className={model.id === props.value ? "model-option active" : "model-option"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  props.onChange(model.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span>{model.name}</span>
                <small>{model.provider ?? "Unknown provider"}</small>
              </button>
            ))}
            {!filteredModels.length && <div className="no-results">No model found</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Chain({ edges, models }: { edges: WinEdge[]; models: ModelRecord[] }) {
  const modelMap = new Map(models.map((model) => [model.id, model]));
  return (
    <ol className="chain-list">
      {edges.map((edge, index) => {
        const from = modelMap.get(edge.fromModelId);
        const to = modelMap.get(edge.toModelId);
        const metric =
          edge.metric === "multi_metric" || edge.metric === "pareto"
            ? edge.evidenceMetric
            : edge.metric;
        return (
          <li key={`${edge.fromModelId}-${edge.toModelId}-${index}`} className="chain-edge">
            <div className="edge-index">{index + 1}</div>
            <div className="edge-content">
              <div className="edge-title">
                <strong>{from?.name}</strong>
                <ArrowRight aria-hidden="true" />
                <strong>{to?.name}</strong>
              </div>
              {metric && (
                <div className="edge-values">
                  <span className="metric-chip">{getMetricDefinition(metric).label}</span>
                  <span>{formatMetricValue(edge.fromValue, metric)}</span>
                  <ArrowRight aria-hidden="true" />
                  <span>{formatMetricValue(edge.toValue, metric)}</span>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  }
}

function downloadChainImage({
  chain,
  category,
  fromModel,
  models,
  toModel,
}: {
  chain: { found: boolean; edges: WinEdge[] };
  category: string;
  fromModel?: ModelRecord;
  models: ModelRecord[];
  toModel?: ModelRecord;
}) {
  const modelMap = new Map(models.map((model) => [model.id, model]));
  const width = 1400;
  const cardX = 48;
  const cardY = 48;
  const cardWidth = width - cardX * 2;
  const contentX = 86;
  const contentWidth = width - contentX * 2;
  const scale = Math.max(2, Math.min(window.devicePixelRatio || 2, 3));
  const title = chain.found
    ? `YES! ${fromModel?.name ?? "This model"} is better than ${toModel?.name ?? "that model"}`
    : `${fromModel?.name ?? "This model"} has no chain to ${toModel?.name ?? "that model"}`;
  const subtitle = chain.found
    ? `${chain.edges.length} hop${chain.edges.length === 1 ? "" : "s"} under ${category}`
    : `No chain found under ${category}`;
  const rows: ChainImageRow[] = chain.found
    ? chain.edges.map((edge, index) => {
        const metric =
          edge.metric === "multi_metric" || edge.metric === "pareto"
            ? edge.evidenceMetric
            : edge.metric;
        return {
          index: index + 1,
          from: modelMap.get(edge.fromModelId)?.name ?? "Unknown",
          to: modelMap.get(edge.toModelId)?.name ?? "Unknown",
          metric: metric ? getMetricDefinition(metric).label : "Metric",
          fromValue: metric ? formatMetricValue(edge.fromValue, metric) : "N/A",
          toValue: metric ? formatMetricValue(edge.toValue, metric) : "N/A",
        };
      })
    : [];

  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) return;

  measureContext.font = imageFont(900, 44);
  const titleLines = wrapCanvasText(measureContext, title, contentWidth, 3);
  measureContext.font = imageFont(800, 23);
  const subtitleLines = wrapCanvasText(measureContext, subtitle, contentWidth, 2);
  const rowLayouts = rows.map((row) => measureChainImageRow(measureContext, row));
  const rowGap = 18;
  const rowsHeight = chain.found
    ? rowLayouts.reduce((total, row) => total + row.height, 0) + Math.max(0, rowLayouts.length - 1) * rowGap
    : 108;
  const contentBottom =
    96 + 56 + titleLines.length * 52 + 8 + subtitleLines.length * 32 + 24 + rowsHeight;
  const height = Math.max(620, contentBottom + 132);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#fff8e7");
  background.addColorStop(0.55, "#fffdf8");
  background.addColorStop(1, "#eafdff");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  roundRect(context, cardX, cardY, cardWidth, height - cardY * 2, 28);
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.fill();
  context.strokeStyle = "#f1d28a";
  context.lineWidth = 2;
  context.stroke();

  let cursorY = 96;
  context.fillStyle = "#9b6214";
  context.font = imageFont(900, 24);
  context.fillText("https://llm-win.com", contentX, cursorY);
  cursorY += 56;

  context.fillStyle = "#17120d";
  context.font = imageFont(900, 44);
  cursorY = drawWrappedText(context, titleLines, contentX, cursorY, 52);
  cursorY += 8;

  context.fillStyle = "#0f7281";
  context.font = imageFont(800, 23);
  cursorY = drawWrappedText(context, subtitleLines, contentX, cursorY, 32);
  cursorY += 24;

  if (chain.found) {
    for (const row of rowLayouts) {
      drawChainImageRow(context, row, contentX, cursorY, contentWidth);
      cursorY += row.height + rowGap;
    }
  } else {
    roundRect(context, contentX, cursorY, contentWidth, 92, 18);
    context.fillStyle = "#fffdf7";
    context.fill();
    context.strokeStyle = "#f1dca9";
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = "#57483b";
    context.font = imageFont(800, 28);
    context.fillText("Try another category or swap the models.", contentX + 28, cursorY + 56);
  }

  const footerY = height - cardY - 58;
  context.strokeStyle = "#f1dca9";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(contentX, footerY - 24);
  context.lineTo(contentX + contentWidth, footerY - 24);
  context.stroke();

  context.fillStyle = "#5f5147";
  context.font = imageFont(750, 22);
  context.fillText("GitHub: Spico197/llm-win", contentX, footerY);

  context.fillStyle = "#0f7281";
  context.font = imageFont(700, 20);
  context.fillText("https://github.com/Spico197/llm-win", contentX, footerY + 30);

  const anchor = document.createElement("a");
  anchor.download = `llm-win-${fromModel?.slug ?? "source"}-vs-${toModel?.slug ?? "target"}.png`;
  canvas.toBlob((blob) => {
    if (!blob) {
      anchor.href = canvas.toDataURL("image/png");
      clickDownloadAnchor(anchor);
      return;
    }
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    clickDownloadAnchor(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

type ChainImageRow = {
  index: number;
  from: string;
  to: string;
  metric: string;
  fromValue: string;
  toValue: string;
};

type ChainImageRowLayout = ChainImageRow & {
  fromLines: string[];
  toLines: string[];
  metricLines: string[];
  valuesLines: string[];
  height: number;
};

function imageFont(weight: number, size: number) {
  return `${weight} ${size}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

function measureChainImageRow(
  context: CanvasRenderingContext2D,
  row: ChainImageRow,
): ChainImageRowLayout {
  const modelColumnWidth = 430;
  context.font = imageFont(900, 24);
  const fromLines = wrapCanvasText(context, row.from, modelColumnWidth, 3);
  const toLines = wrapCanvasText(context, row.to, modelColumnWidth, 3);
  context.font = imageFont(800, 20);
  const metricLines = wrapCanvasText(context, row.metric, 360, 2);
  const valuesLines = wrapCanvasText(context, `${row.fromValue} -> ${row.toValue}`, 560, 2);
  const modelHeight = Math.max(fromLines.length, toLines.length) * 29;
  const evidenceHeight = Math.max(metricLines.length, valuesLines.length) * 25;
  return {
    ...row,
    fromLines,
    toLines,
    metricLines,
    valuesLines,
    height: Math.max(118, 34 + modelHeight + 16 + evidenceHeight + 26),
  };
}

function drawChainImageRow(
  context: CanvasRenderingContext2D,
  row: ChainImageRowLayout,
  x: number,
  y: number,
  width: number,
) {
  roundRect(context, x, y, width, row.height, 18);
  context.fillStyle = "#fffdf7";
  context.fill();
  context.strokeStyle = "#f1dca9";
  context.lineWidth = 1.5;
  context.stroke();

  const indexX = x + 44;
  const indexY = y + 52;
  context.beginPath();
  context.arc(indexX, indexY, 22, 0, Math.PI * 2);
  context.fillStyle = "#8ee3ef";
  context.fill();
  context.fillStyle = "#153941";
  context.font = imageFont(900, 19);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(row.index), indexX, indexY + 1);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  const fromX = x + 90;
  const arrowX = x + width / 2;
  const toX = arrowX + 50;
  const modelY = y + 44;
  context.fillStyle = "#17120d";
  context.font = imageFont(900, 24);
  drawWrappedText(context, row.fromLines, fromX, modelY, 29);
  drawWrappedText(context, row.toLines, toX, modelY, 29);

  context.fillStyle = "#0f7281";
  context.font = imageFont(900, 25);
  context.textAlign = "center";
  context.fillText("->", arrowX, modelY);
  context.textAlign = "left";

  const evidenceY =
    modelY + Math.max(row.fromLines.length, row.toLines.length) * 29 + 23;
  context.fillStyle = "#9b6214";
  context.font = imageFont(800, 20);
  drawWrappedText(context, row.metricLines, fromX, evidenceY, 25);
  context.fillStyle = "#57483b";
  drawWrappedText(context, row.valuesLines, fromX + 390, evidenceY, 25);
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = Number.POSITIVE_INFINITY,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidates = breakLongWord(context, word, maxWidth);
    for (const candidate of candidates) {
      const next = current ? `${current} ${candidate}` : candidate;
      if (context.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = candidate;
      }
    }
  }

  if (current) lines.push(current);
  if (lines.length > maxLines) {
    return withEllipsis(context, lines.slice(0, maxLines), maxWidth);
  }
  return lines;
}

function breakLongWord(
  context: CanvasRenderingContext2D,
  word: string,
  maxWidth: number,
) {
  if (context.measureText(word).width <= maxWidth) return [word];
  const pieces: string[] = [];
  let current = "";
  for (const character of word) {
    const next = `${current}${character}`;
    if (context.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      if (current) pieces.push(current);
      current = character;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function withEllipsis(
  context: CanvasRenderingContext2D,
  lines: string[],
  maxWidth: number,
) {
  if (!Number.isFinite(maxWidth) || lines.length === 0) return lines;
  const lastIndex = lines.length - 1;
  let lastLine = lines[lastIndex] ?? "";
  while (lastLine && context.measureText(`${lastLine}...`).width > maxWidth) {
    lastLine = lastLine.slice(0, -1);
  }
  lines[lastIndex] = lastLine ? `${lastLine}...` : "...";
  return lines;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
) {
  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function clickDownloadAnchor(anchor: HTMLAnchorElement) {
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function NoPath({ category }: { category: string }) {
  return (
    <div className="empty-state compact">
      <Search aria-hidden="true" />
      <p>No chain found under {category}.</p>
      <p className="muted">Try another category or swap the models.</p>
    </div>
  );
}

function LeaderboardsView({
  leaderboards,
  metric,
  metrics,
  setMetric,
}: {
  leaderboards: Leaderboards;
  metric: LeaderboardMetric;
  metrics: LeaderboardMetric[];
  setMetric: (value: LeaderboardMetric) => void;
}) {
  const selectedMetric = metrics.includes(metric) ? metric : metrics[0];
  const entries = selectedMetric ? leaderboards[selectedMetric] ?? [] : [];
  return (
    <section className="leaderboard-layout">
      <div className="metric-rail">
        {defaultMetricOrder.map((item) => (
          <button
            key={item}
            disabled={!metrics.includes(item)}
            className={selectedMetric === item ? "active" : ""}
            onClick={() => setMetric(item)}
          >
            {getMetricDefinition(item).label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>Provider</th>
              <th>{selectedMetric ? getMetricDefinition(selectedMetric).label : "Value"}</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 100).map((entry) => (
              <tr key={entry.modelId}>
                <td>{entry.rank}</td>
                <td>{entry.name}</td>
                <td>{entry.provider ?? "Unknown"}</td>
                <td>{selectedMetric ? formatMetricValue(entry.value, selectedMetric) : entry.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportView({ report }: { report?: ReportData }) {
  const [selectedUpset, setSelectedUpset] = React.useState<string | undefined>();
  const [selectedCorrelation, setSelectedCorrelation] = React.useState<string | undefined>();

  if (!report) {
    return (
      <section className="empty-state compact">
        <Search aria-hidden="true" />
        <p>Report data is not available yet.</p>
        <p className="muted">Run npm run data:report after updating model data.</p>
      </section>
    );
  }

  const topUpsets = report.directUpsetsByBenchmark.slice(0, 10);
  const lowCorrelations = report.benchmarkCorrelations.slice(0, 10);
  const reversalScores = report.benchmarkReversalScores?.slice(0, 10) ?? [];
  const selectedUpsetRow =
    topUpsets.find((row) => row.metric === selectedUpset) ?? topUpsets[0];
  const selectedCorrelationRow =
    lowCorrelations.find((row) => row.metric === selectedCorrelation) ?? lowCorrelations[0];

  return (
    <section className="report-view">
      <div className="report-hero">
        <div>
          <p className="eyebrow">Report</p>
          <h2>Why can weak models beat strong models?</h2>
          <p>
            The short answer: narrow benchmark specialization. A model can have a lower
            Intelligence Index, yet still outrank a stronger model on one concrete task.
          </p>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Weak -> strong pairs" value={report.summary.checkedWeakerToStrongerPairs.toLocaleString()} />
        <StatCard label="Reachable" value={`${percent(report.summary.reachableRate)}%`} />
        <StatCard label="Unreachable" value={report.summary.unreachablePairs.toLocaleString()} />
        <StatCard label="Direct upset edges" value={report.summary.directUpsetEdgeCount.toLocaleString()} />
      </section>

      {report.changeSummary && <DataChangePanel changeSummary={report.changeSummary} />}

      <section className="report-grid two">
        <ReportPanel
          title="Benchmark Upsets"
          note="These benchmarks most often create direct weak-over-strong graph edges."
          detail={
            selectedUpsetRow
              ? `${selectedUpsetRow.label}: ${selectedUpsetRow.count.toLocaleString()} direct upset edges`
              : ""
          }
        >
          <BarChart
            rows={topUpsets.map((row) => ({
              key: row.metric,
              label: row.label,
              value: row.count,
            }))}
            selectedKey={selectedUpsetRow?.metric}
            onSelect={setSelectedUpset}
          />
        </ReportPanel>

        <ReportPanel
          title="Specialization Signal"
          note="Lower correlation means the benchmark disagrees more with the aggregate Intelligence Index."
          detail={
            selectedCorrelationRow
              ? `${selectedCorrelationRow.label}: r=${selectedCorrelationRow.correlation.toFixed(2)} over ${selectedCorrelationRow.sampleSize} models`
              : ""
          }
        >
          <BarChart
            rows={lowCorrelations.map((row) => ({
              key: row.metric,
              label: row.label,
              value: Math.max(0, 1 - row.correlation),
            }))}
            selectedKey={selectedCorrelationRow?.metric}
            onSelect={setSelectedCorrelation}
            valueFormatter={(value) => `${Math.round(value * 100)}%`}
          />
        </ReportPanel>
      </section>

      <section className="report-grid two">
        <ReportPanel title="Chain Lengths" note="Reconstructed shortest-path lengths for weak-to-strong reachable pairs.">
          <BarChart
            rows={report.pathLengths.map((row) => ({
              key: String(row.hops),
              label: `${row.hops} hops`,
              value: row.count,
            }))}
          />
        </ReportPanel>
        <ReportPanel title="Benchmark Coverage" note="Missing benchmark values can block chains and make targets hard to reach.">
          <BarChart
            rows={report.benchmarkCoverage
              .slice()
              .sort((a, b) => b.coverageRate - a.coverageRate)
              .slice(0, 12)
              .map((row) => ({
                key: row.metric,
                label: row.label,
                value: row.coverageRate,
              }))}
            valueFormatter={(value) => `${percent(value)}%`}
          />
        </ReportPanel>
      </section>

      {report.shortestPathAnalysis && (
        <section className="report-section">
          <h3>Shortest Path Takeaways</h3>
          <div className="insight-list compact">
            <p>
              Mean path length is {report.shortestPathAnalysis.meanHops.toFixed(2)} hops;
              median is {report.shortestPathAnalysis.medianHops}; p90 is{" "}
              {report.shortestPathAnalysis.p90Hops}.{" "}
              {percent(report.shortestPathAnalysis.twoOrThreeHopShare)}% of reachable weak-to-strong
              pairs resolve in 2-3 hops.
            </p>
            <p>{report.shortestPathAnalysis.note}</p>
            <p>{report.shortestPathAnalysis.interpretation}</p>
          </div>
        </section>
      )}

      <section className="report-grid two">
        <ReportPanel
          title="Benchmark Reversal Score"
          note="High values mean a benchmark often lets lower-Intelligence models beat higher-Intelligence models while still carrying useful coverage."
        >
          <BarChart
            rows={reversalScores.map((row) => ({
              key: row.metric,
              label: row.label,
              value: row.usefulReversalScore,
            }))}
            valueFormatter={(value) => value.toFixed(3)}
          />
        </ReportPanel>
        <CompositeCandidateList rows={report.compositeBenchmarkCandidates ?? []} />
      </section>

      <ReversalTriplesTable rows={report.topWeakToStrongTriples ?? []} />

      <FingerprintList rows={report.modelAbilityFingerprints ?? []} />

      <section className="report-grid three">
        <TopModelList title="Bridge Models" rows={report.topBridgeModels} />
        <TopModelList title="Worst Sources" rows={report.worstSources} />
        <TopModelList title="Hardest Targets" rows={report.hardestTargets} />
      </section>

      <section className="report-section">
        <h3>Optimization Hints</h3>
        <div className="insight-list">
          {report.interpretation.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      </section>
    </section>
  );
}

function DataChangePanel({ changeSummary }: { changeSummary: NonNullable<ReportData["changeSummary"]> }) {
  const topMetricChanges = changeSummary.metricChanges.slice(0, 5);
  const topRankChanges = changeSummary.rankChanges.slice(0, 5);
  return (
    <section className="report-section data-change-panel">
      <div className="panel-heading">
        <h3>Latest Data Changes</h3>
        <p>
          Compared with the previous generated snapshot
          {changeSummary.previousGeneratedAt ? ` from ${formatDate(changeSummary.previousGeneratedAt)}` : ""}.
        </p>
      </div>
      <div className="change-summary-list">
        {changeSummary.summary.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </div>
      <div className="change-mini-grid">
        <ChangeList
          title="Model Count"
          rows={[
            `${changeSummary.modelCountBefore.toLocaleString()} -> ${changeSummary.modelCountAfter.toLocaleString()} (${formatSignedCount(
              changeSummary.modelCountDelta,
            )})`,
          ]}
        />
        <ChangeList
          title="New Models"
          rows={changeSummary.addedModels.slice(0, 5).map((model) => model.name)}
          emptyText="No new models"
        />
        <ChangeList
          title="Metric Moves"
          rows={topMetricChanges.map(
            (item) =>
              `${item.model.name}: ${item.metricLabel} ${item.previousFormatted} -> ${item.currentFormatted}`,
          )}
          emptyText="No material metric moves"
        />
        <ChangeList
          title="Rank Moves"
          rows={topRankChanges.map(
            (item) =>
              `${item.model.name}: ${item.metricLabel} #${item.previousRank} -> #${item.currentRank}`,
          )}
          emptyText="No rank moves"
        />
      </div>
    </section>
  );
}

function ChangeList({
  title,
  rows,
  emptyText = "No changes",
}: {
  title: string;
  rows: string[];
  emptyText?: string;
}) {
  return (
    <article>
      <h4>{title}</h4>
      <ul>
        {(rows.length ? rows : [emptyText]).map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </article>
  );
}

function CompositeCandidateList({
  rows,
}: {
  rows: NonNullable<ReportData["compositeBenchmarkCandidates"]>;
}) {
  return (
    <article className="report-panel compact">
      <div className="panel-heading">
        <h3>Composite Candidates</h3>
        <p>Benchmarks that add reversal information without relying only on one extreme ability.</p>
      </div>
      <ol className="model-rank-list">
        {rows.slice(0, 8).map((row) => (
          <li key={row.metric}>
            <span>
              <strong>{row.label}</strong>
              <small>
                reversal {percent(row.reversalRate)}% · coverage {percent(row.coverageRate)}% · r=
                {row.correlation.toFixed(2)}
              </small>
            </span>
            <b>{row.compositeUsefulness.toFixed(3)}</b>
          </li>
        ))}
      </ol>
    </article>
  );
}

function ReversalTriplesTable({
  rows,
}: {
  rows: NonNullable<ReportData["topWeakToStrongTriples"]>;
}) {
  if (!rows.length) return null;
  return (
    <section className="report-section">
      <h3>Top Weak-to-Strong Triples</h3>
      <p className="section-note">
        Ranked by surprise: Intelligence gap times benchmark margin. Non-positive benchmark values
        are treated as missing in this analysis.
      </p>
      <div className="compact-table">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Target</th>
              <th>Benchmark</th>
              <th>Values</th>
              <th>Gap</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row) => (
              <tr key={`${row.source.name}-${row.target.name}-${row.metricLabel}`}>
                <td>{row.source.name}</td>
                <td>{row.target.name}</td>
                <td>{row.metricLabel}</td>
                <td>
                  {row.sourceFormatted} {"->"} {row.targetFormatted}
                </td>
                <td>
                  IQ +{row.intelligenceGap.toFixed(1)} · {row.benchmarkMarginFormatted}
                </td>
                <td>{row.surpriseScore.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FingerprintList({
  rows,
}: {
  rows: NonNullable<ReportData["modelAbilityFingerprints"]>;
}) {
  if (!rows.length) return null;
  return (
    <section className="report-section">
      <h3>Model Ability Fingerprints</h3>
      <p className="section-note">
        A fingerprint combines direct reversal power, vulnerability, bridge frequency, and residual
        benchmark strengths after accounting for Intelligence Index.
      </p>
      <div className="fingerprint-grid">
        {rows.slice(0, 6).map((row) => (
          <article key={row.model.name} className="fingerprint-card">
            <div>
              <h4>{row.model.name}</h4>
              <p>
                {row.role} · {row.model.provider ?? "Unknown"} · IQ{" "}
                {row.model.intelligence ?? "N/A"}
              </p>
            </div>
            <div className="fingerprint-stats">
              <span>upsets {row.upsetPower.count.toLocaleString()}</span>
              <span>vulnerable {row.vulnerability.count.toLocaleString()}</span>
              <span>bridge {row.bridgeCount.toLocaleString()}</span>
            </div>
            <ResidualList title="Strong residuals" rows={row.strongResiduals} />
            <ResidualList title="Weak residuals" rows={row.weakResiduals} />
          </article>
        ))}
      </div>
    </section>
  );
}

function ResidualList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; actual: string; expected: string; residual: number }>;
}) {
  return (
    <div className="residual-list">
      <strong>{title}</strong>
      {(rows.length ? rows : [{ label: "None", actual: "", expected: "", residual: 0 }]).map((row) => (
        <span key={`${title}-${row.label}`}>
          {row.label}
          {row.actual && ` ${row.actual} vs expected ${row.expected}`}
        </span>
      ))}
    </div>
  );
}

function formatSignedCount(value: number) {
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ReportPanel({
  title,
  note,
  detail,
  children,
}: {
  title: string;
  note: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="report-panel">
      <div className="panel-heading">
        <h3>{title}</h3>
        <p>{note}</p>
      </div>
      {children}
      {detail && <p className="panel-detail">{detail}</p>}
    </article>
  );
}

function BarChart({
  rows,
  selectedKey,
  onSelect,
  valueFormatter = (value: number) => Math.round(value).toLocaleString(),
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  selectedKey?: string;
  onSelect?: (key: string) => void;
  valueFormatter?: (value: number) => string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="bar-chart">
      {rows.map((row) => (
        <button
          key={row.key}
          className={selectedKey === row.key ? "bar-row active" : "bar-row"}
          type="button"
          onClick={() => onSelect?.(row.key)}
        >
          <span className="bar-label">{row.label}</span>
          <span className="bar-track">
            <span style={{ width: `${Math.max((row.value / max) * 100, 2)}%` }} />
          </span>
          <span className="bar-value">{valueFormatter(row.value)}</span>
        </button>
      ))}
    </div>
  );
}

function TopModelList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ model: { name: string; provider?: string; intelligence: number | null }; count: number }>;
}) {
  return (
    <article className="report-panel compact">
      <h3>{title}</h3>
      <ol className="model-rank-list">
        {rows.slice(0, 8).map((row) => (
          <li key={`${title}-${row.model.name}`}>
            <span>
              <strong>{row.model.name}</strong>
              <small>
                {row.model.provider ?? "Unknown"} · AA Intelligence Index{" "}
                {row.model.intelligence ?? "N/A"}
              </small>
            </span>
            <b>{row.count.toLocaleString()}</b>
          </li>
        ))}
      </ol>
    </article>
  );
}

function percent(value: number) {
  return (value * 100).toFixed(1);
}

function MethodologyView({
  metadata,
  metrics,
}: {
  metadata: DataMetadata;
  metrics: LeaderboardMetric[];
}) {
  return (
    <section className="method-grid">
      <article className="method-card method-card-wide">
        <h2>Data</h2>
        <p>
          Generated from{" "}
          <a href={metadata.sourceUrl} target="_blank" rel="noreferrer">
            Artificial Analysis
          </a>{" "}
          on {formatDate(metadata.generatedAt)}.
        </p>
      </article>
      <article className="method-card">
        <h2>Algorithm</h2>
        <p>
          Each model is a node. For the selected category, the app builds directed edges from higher-scoring models to lower-scoring models on concrete benchmarks, using rank-neighbor jumps to keep chains readable. It then runs breadth-first search to find the shortest chain from source to target within 9 hops.
        </p>
      </article>
      <article className="method-card">
        <h2>Overall</h2>
        <p>
          Overall searches across every concrete benchmark from Intelligence, Coding, and Math. Intelligence only searches intelligence benchmarks such as MMLU-Pro, GPQA, HLE, IFBench, LCR, and TAU2.
        </p>
      </article>
      <article className="method-card method-card-wide">
        <h2>Metrics</h2>
        <ul className="method-metric-list">
          {defaultMetricOrder.map((item) => (
            <li key={item} className={metrics.includes(item) ? "" : "muted"}>
              <strong>{getMetricDefinition(item).label}</strong>
              <span>{getMetricDefinition(item).direction.replaceAll("_", " ")}</span>
              {!metrics.includes(item) && <em>not in current AA API data</em>}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}


function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const rootElement = document.getElementById("root")!;
const root = window.__llmWinRoot ?? ReactDOM.createRoot(rootElement);
window.__llmWinRoot = root;

installAnalytics();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
