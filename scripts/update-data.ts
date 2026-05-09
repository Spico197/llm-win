import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { availableMetrics } from "../src/lib/metrics";
import { buildLeaderboards } from "../src/lib/leaderboards";
import { normalizeAaModels } from "../src/lib/normalize";
import type { DataMetadata } from "../src/lib/types";

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

const previousModels = await readPreviousModels();
if (previousModels > 0 && models.length < previousModels * 0.75) {
  throw new Error(
    `Model count dropped from ${previousModels} to ${models.length}; refusing to overwrite generated data.`,
  );
}

const leaderboards = buildLeaderboards(models);
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

async function readPreviousModels() {
  try {
    const text = await readFile(path.join(outputDir, "models.json"), "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
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
