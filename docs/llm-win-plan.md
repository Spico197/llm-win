# llm-win.com Product And Engineering Plan

Last updated: 2026-05-09

## 1. Goal

Build a public static website at `llm-win.com` inspired by "My Team Is Better Than Your Team", but for LLM model leaderboards.

The core user experience:

1. User chooses two LLMs.
2. User chooses a comparison mode, such as intelligence, speed, latency, context length, end-to-end response time, or a multi-metric mode.
3. The site explains why Model A can be considered "better than" Model B by showing either:
   - A direct metric comparison.
   - A transitive chain: Model A beats Model X, Model X beats Model Y, and Model Y beats Model B.
4. Every step includes the metric, values, source date, and a link/attribution to Artificial Analysis.

The tone should be playful, but the methodology should be transparent. This is a "bragging rights graph", not a claim that one model is universally superior.

## 2. External References

- Artificial Analysis model leaderboard: <https://artificialanalysis.ai/leaderboards/models>
- Artificial Analysis API documentation: <https://artificialanalysis.ai/documentation>
- GitHub Pages custom domain docs: <https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site>
- GitHub Pages DNS record docs: <https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site>

Important source note: Artificial Analysis currently documents a Free API endpoint for LLM model data at `/api/v2/data/llms/models`, with bearer-token authentication. Use the official API as the primary data source. Only scrape the public leaderboard page if a field is unavailable from the API and if Artificial Analysis terms allow it.

## 3. Product Shape

### 3.1 Primary Pages

#### Home / Comparison Tool

First screen should be the actual comparison interface, not a marketing landing page.

Controls:

- `From model` combobox.
- `To model` combobox.
- Metric mode segmented control:
  - Intelligence
  - Speed
  - Latency
  - End-to-end
  - Context
  - Multi-metric
  - Pareto
- Optional provider filter.
- Optional "minimum margin" slider.
- "Find chain" button.

Output:

- Short headline: `Claude X beats GPT Y through 3 hops`.
- Chain visualization.
- Per-edge explanation with values:
  - `Model A > Model B on Intelligence: 64 vs 58`
  - `Model B > Model C on Speed: 170 tokens/s vs 122 tokens/s`
- Source timestamp.
- Methodology link.

#### Leaderboards

Sub-leaderboard views:

- Overall / composite.
- Intelligence.
- Speed.
- Latency.
- End-to-end response time.
- Context length.
- Price, if included later.
- Custom weighted score, optional in v2.

Each leaderboard should show:

- Rank.
- Model.
- Provider.
- Metric value.
- Last updated.
- Link to model detail.

#### Model Detail

For each model:

- Provider.
- All known metric values.
- Rank per metric.
- Strongest wins.
- Weakest losses.
- Models it can reach by transitive chain.
- Models that can reach it.

#### Methodology

Explain:

- Data source.
- Last update process.
- Metric direction, such as "higher is better" or "lower is better".
- What transitive chains mean.
- What they do not mean.
- How margins and tie handling work.

## 4. Data Strategy

### 4.1 Preferred Source

Use the official Artificial Analysis API.

Expected flow:

```text
GitHub Actions cron
  -> scripts/fetch-aa-data.ts
  -> Artificial Analysis API
  -> normalize records
  -> write public/data/raw.json for audit/debugging
  -> write public/data/models.json
  -> write public/data/leaderboards.json
  -> write public/data/graph.json
  -> commit generated files if changed
  -> GitHub Pages deploy
```

Use `AA_API_KEY` as a GitHub Actions secret. Never expose this key in browser code.

### 4.1.1 Secret Handling Requirements

This repository is intended to become public, so secret handling must be treated as a release blocker.

Rules:

- Keep the local Artificial Analysis API key in `.env`.
- Keep `.env` and `.env.*` ignored by Git.
- Commit only `.env.example`, with placeholder values.
- In GitHub Actions, read the key only from `secrets.AA_API_KEY`.
- Never put the API key in `public/`, `src/`, static JSON, screenshots, logs, or build artifacts.
- Never expose the key through client-side environment variables such as `VITE_AA_API_KEY`.
- The browser app must fetch only generated local files such as `/data/models.json`.
- Data update scripts may read `AA_API_KEY` from local `.env` during development, but generated output must not include request headers, bearer tokens, full environment dumps, or raw error payloads that might echo secrets.
- Before first public push, run a secret scan and inspect `git status --ignored` to confirm `.env` is ignored.

Recommended `.env.example`:

```text
AA_API_KEY=replace_me
```

Recommended local script behavior:

```text
if AA_API_KEY is missing:
  fail with "AA_API_KEY is required"
if API request fails:
  print status code and a short sanitized message
  do not print request headers or process.env
```

### 4.2 Fallback Source

If official API fields are missing, use one of these fallback approaches, in this order:

1. Ask Artificial Analysis whether the missing field is available through their API.
2. Add a manual override file for fields that change infrequently, such as context length.
3. Scrape the public leaderboard page only if permitted by Artificial Analysis terms and robots policy.

Do not make the client browser call Artificial Analysis directly. The static site should only read generated JSON files from this repository.

### 4.3 Candidate Fields

Initial normalized model shape:

```ts
type ModelRecord = {
  id: string;
  name: string;
  slug?: string;
  provider?: string;
  sourceUrl: string;
  updatedAt: string;
  metrics: {
    intelligence?: number;
    outputSpeedTokensPerSecond?: number;
    latencySeconds?: number;
    endToEndResponseSeconds?: number;
    contextTokens?: number;
    priceUsdPerMillionTokens?: number;
  };
  raw?: unknown;
};
```

Generated leaderboard shape:

```ts
type LeaderboardMetric =
  | "intelligence"
  | "outputSpeedTokensPerSecond"
  | "latencySeconds"
  | "endToEndResponseSeconds"
  | "contextTokens"
  | "priceUsdPerMillionTokens";

type MetricDefinition = {
  key: LeaderboardMetric;
  label: string;
  direction: "higher_is_better" | "lower_is_better";
  unit?: string;
  minimumMargin?: number;
};
```

Metric direction:

| Metric | Direction | Notes |
| --- | --- | --- |
| Intelligence | Higher is better | Artificial Analysis index or score. |
| Output speed | Higher is better | Usually tokens per second. |
| Latency | Lower is better | Time to first token or comparable latency measure. |
| End-to-end response time | Lower is better | Total response time. |
| Context length | Higher is better | Tokens. |
| Price | Lower is better | Add after MVP if source field is stable. |

### 4.4 Data Validation

The update script should fail loudly when:

- API response shape changes.
- More than 25 percent of previous models disappear.
- A numeric metric becomes non-numeric.
- Required attribution fields cannot be generated.
- Generated JSON is invalid.

The script should warn, but not fail, when:

- A model lacks one optional metric.
- A provider name is missing.
- A new metric appears that the site does not yet support.

## 5. Ranking And Chain Algorithms

### 5.1 Core Graph Concept

Represent models as graph nodes. A directed edge `A -> B` means "A beats B under a specific comparison rule."

Each edge stores:

```ts
type WinEdge = {
  fromModelId: string;
  toModelId: string;
  metric: LeaderboardMetric | "multi_metric" | "pareto" | "composite";
  fromValue?: number;
  toValue?: number;
  margin?: number;
  explanation: string;
};
```

### 5.2 Single-Metric Mode

For a chosen metric:

1. Remove models missing that metric.
2. Sort models by metric direction.
3. Add an edge from a better model to a worse model when the margin is at least the configured threshold.
4. For a cleaner chain, generate edges only between nearby ranks by default, then allow direct-edge mode as an option.

Why nearby-rank edges matter:

- If every better model points to every worse model, the shortest path is almost always one hop.
- A rank-ladder graph creates more interesting explanations:
  - `Rank 3 beats Rank 4`
  - `Rank 4 beats Rank 5`
  - `Rank 5 beats Rank 12`

Recommended MVP setting:

- Create edges from each model to the next `k = 3` lower-ranked models.
- Also create a direct edge for exact pair comparisons, but display ladder mode by default.

### 5.3 Multi-Metric Bragging-Rights Mode

In this mode, `A -> B` if A beats B on at least one selected metric by the minimum margin.

Example:

```text
Model A beats Model B on speed.
Model B beats Model C on context.
Model C beats Model D on latency.
```

This is the closest match to the playful sports transitive-win concept. It is also the easiest mode to misuse, so the UI must label it clearly as "bragging-rights mode."

### 5.4 Pareto Mode

In this mode, `A -> B` only if:

- A is at least as good as B on every selected metric.
- A is strictly better on at least one selected metric.

This creates fewer chains, but they are more meaningful.

Use Pareto mode as the serious comparison option.

### 5.5 Composite Mode

Normalize selected metrics to a 0 to 1 range, invert lower-is-better metrics, then compute a weighted score.

Initial weights:

| Metric | Weight |
| --- | ---: |
| Intelligence | 0.40 |
| Speed | 0.20 |
| Latency | 0.15 |
| End-to-end response time | 0.15 |
| Context length | 0.10 |

Use min-max normalization at first:

```text
normalized = (value - min) / (max - min)
```

For lower-is-better metrics:

```text
normalized = 1 - ((value - min) / (max - min))
```

Later improvement: use percentile ranks or log scaling for skewed metrics like context length and price.

### 5.6 Path Search

Use breadth-first search for shortest chains.

Inputs:

- `sourceModelId`
- `targetModelId`
- comparison mode
- selected metrics
- maximum hops, default 6
- minimum margin

Output:

- `found: true | false`
- ordered list of edges
- total hops
- explanation text

Tie handling:

- If values are equal or within the margin threshold, no edge.
- Show "too close to call" if no path exists and direct values are near equal.

### 5.7 Precompute Or Client Compute

MVP recommendation:

- Precompute normalized model data and metric rankings during GitHub Actions.
- Compute paths in the browser from generated graph JSON.

Reason:

- Model count is likely small enough for browser BFS.
- The static site remains simple.
- Users can adjust mode and margin instantly without server infrastructure.

If graph size grows, precompute adjacency lists per metric.

## 6. Static Site Architecture

Recommended stack:

- Vite.
- React.
- TypeScript.
- Plain CSS or Tailwind, depending on preferred project style.
- Vitest for algorithm tests.
- Playwright for basic UI smoke tests.

Alternative:

- Astro with React islands, if SEO and static content are prioritized.

Recommended repo structure:

```text
.
├── .github/
│   └── workflows/
│       ├── update-aa-data.yml
│       └── deploy-pages.yml
├── docs/
│   └── llm-win-plan.md
├── public/
│   ├── CNAME
│   └── data/
│       ├── models.json
│       ├── leaderboards.json
│       ├── graph.json
│       └── metadata.json
├── scripts/
│   ├── fetch-aa-data.ts
│   ├── normalize-aa-data.ts
│   ├── build-leaderboards.ts
│   └── build-graph.ts
├── src/
│   ├── components/
│   ├── lib/
│   │   ├── metrics.ts
│   │   ├── graph.ts
│   │   ├── path-search.ts
│   │   └── format.ts
│   ├── pages/
│   └── main.tsx
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 7. GitHub Actions

### 7.1 Data Update Workflow

Schedule:

- Run daily.
- Allow manual dispatch.
- Commit generated data only when changed.

Example workflow design:

```yaml
name: Update Artificial Analysis Data

on:
  schedule:
    - cron: "17 3 * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update-data:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run data:update
        env:
          AA_API_KEY: ${{ secrets.AA_API_KEY }}
      - run: npm test
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "Update Artificial Analysis data"
          file_pattern: "public/data/*.json"
```

### 7.2 Pages Deploy Workflow

For Vite:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## 8. Custom Domain Plan

Target domain: `llm-win.com`

### 8.1 Repository Configuration

1. Add `public/CNAME` containing:

```text
llm-win.com
```

2. In GitHub repository settings:
   - Go to Pages.
   - Set source to GitHub Actions.
   - Set custom domain to `llm-win.com`.
   - Enable "Enforce HTTPS" after DNS validates.

### 8.2 Cloudflare DNS

For apex domain `llm-win.com`, use GitHub Pages apex records or Cloudflare CNAME flattening.

Recommended explicit records:

```text
Type  Name  Value
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
AAAA  @     2606:50c0:8000::153
AAAA  @     2606:50c0:8001::153
AAAA  @     2606:50c0:8002::153
AAAA  @     2606:50c0:8003::153
```

Optional `www` redirect:

```text
Type   Name  Value
CNAME  www   <github-username>.github.io
```

Then configure GitHub Pages for either:

- Apex only: `llm-win.com`
- Or www primary: `www.llm-win.com`

If using Cloudflare proxy, start with DNS-only mode until GitHub Pages HTTPS is validated. After validation, Cloudflare proxy can be tested carefully.

## 9. Frontend Design Notes

The app should feel like a compact analytical tool, not a marketing site.

Suggested layout:

- Left or top comparison controls.
- Center chain visualization.
- Right or lower details panel.
- Table-based leaderboard views for scanning.
- Compact cards only for individual model facts or chain edges.

Important UI states:

- Loading data.
- Data stale warning.
- Missing metric.
- No path found.
- Direct win found.
- Tie or too-close-to-call.
- API/source attribution.

Accessibility:

- Comboboxes must be keyboard usable.
- Chain should also render as ordered text, not only graphics.
- Metric colors should not be the only information channel.

## 10. Implementation Milestones

### Milestone 0: Project Bootstrap

Deliverables:

- Vite + React + TypeScript project.
- GitHub Pages build workflow.
- `public/CNAME`.
- Basic home page shell.

Acceptance criteria:

- `npm run build` succeeds.
- GitHub Pages deploy succeeds.
- `llm-win.com` resolves after DNS setup.

### Milestone 1: Data Pipeline

Deliverables:

- `scripts/fetch-aa-data.ts`.
- `scripts/normalize-aa-data.ts`.
- Generated `public/data/models.json`.
- Generated `public/data/raw.json` containing the sanitized raw API response body for inspection.
- Generated `public/data/metadata.json`.
- Daily GitHub Actions workflow.

Acceptance criteria:

- Manual workflow fetches data using `AA_API_KEY`.
- Generated data includes source timestamp and source URL.
- No API key appears in built frontend assets.

### Milestone 2: Leaderboards

Deliverables:

- Metric definitions.
- `leaderboards.json`.
- Leaderboard page with tabs or segmented controls.

Acceptance criteria:

- Intelligence, speed, latency, end-to-end, and context leaderboards display when data is available.
- Sort direction is correct per metric.
- Missing values are shown clearly.

### Milestone 3: Transitive Chain Engine

Deliverables:

- Graph builder.
- BFS path search.
- Unit tests for metric direction, margins, ties, and no-path cases.
- Browser UI for choosing two models and finding a chain.

Acceptance criteria:

- User can find a chain between two models for single-metric mode.
- Chain output includes every edge's metric, values, and source date.
- No-path state is understandable.

### Milestone 4: Multi-Metric And Pareto Modes

Deliverables:

- Multi-metric bragging-rights graph.
- Pareto graph.
- Mode explanations in methodology page.

Acceptance criteria:

- User can switch modes without page reload.
- UI labels playful mode separately from serious mode.
- Tests cover conflicting metrics.

### Milestone 5: Polish And Launch

Deliverables:

- Model detail pages.
- Shareable comparison URLs:
  - `/?from=gpt-4o&to=claude-3-5-sonnet&mode=speed`
- Open Graph metadata.
- Analytics, if desired.
- Error monitoring, if desired.

Acceptance criteria:

- Mobile and desktop layouts are checked.
- Lighthouse accessibility issues are addressed.
- README includes local development and data update instructions.

## 11. Testing Plan

Unit tests:

- Metric comparator.
- Normalization.
- Leaderboard sorting.
- Edge generation.
- BFS path search.
- Tie threshold behavior.
- Missing metric behavior.

Integration tests:

- Given fixture AA data, generated JSON matches snapshot.
- Update script handles new model and removed model.
- Build succeeds with generated data.

Playwright smoke tests:

- Home page loads.
- User selects two models.
- User changes metric.
- Chain appears or no-path state appears.
- Leaderboard tab switches.

## 12. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| API fields differ from public leaderboard columns | Some sub-leaderboards unavailable | Use official API first, add manual overrides or request API access for missing fields. |
| API key exposure | Security issue | Fetch only in GitHub Actions, publish generated JSON only. |
| Scraping violates source terms | Legal/reputation issue | Avoid scraping unless permitted. Prefer API. |
| Scalar metrics make transitive chains trivial | Boring UX | Use nearby-rank ladder edges and multi-metric mode. |
| Multi-metric chains are misleading | User trust issue | Label as playful, provide methodology, offer Pareto mode. |
| GitHub Actions commits too often | Noisy history | Commit only if generated data changes. |
| DNS/HTTPS validation delay | Launch delay | Configure DNS-only first, verify in GitHub Pages, then enforce HTTPS. |

## 13. Open Questions

1. Should `llm-win.com` be apex-only, or should `www.llm-win.com` be primary?
2. Should the MVP include price, or wait until the core metrics are stable?
3. Should multi-metric mode let users choose arbitrary metric subsets?
4. Should chains prefer shortest path, funniest path, or strongest average margin?
5. Should model providers have their own pages?
6. Do we want to store historical snapshots for "was better than" comparisons over time?

## 14. Recommended MVP Scope

Build the smallest version that is fun and defensible:

1. Static React site on GitHub Pages.
2. Daily AA API data update through GitHub Actions.
3. Leaderboards for all available supported metrics.
4. Single-metric transitive chain search.
5. Multi-metric bragging-rights mode.
6. Clear methodology and source attribution.
7. Custom domain `llm-win.com`.

Defer:

- User accounts.
- Backend server.
- Database.
- Historical trend charts.
- Custom weights.
- Social sharing image generation.
