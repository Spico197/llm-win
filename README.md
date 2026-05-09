# LLM Win

LLM Win is a playful static website for transitive LLM leaderboard claims:

```text
Why Model A is better than Model B?
```

Instead of claiming that one model is universally better, the app builds a directed graph from benchmark wins and searches for a short receipt chain. A weak-looking model can sometimes "beat" a stronger model through specific benchmark edges, which makes the result useful as both a meme and a small leaderboard analysis tool.

Live domain:

```text
https://llm-win.com
```

## Features

- Searchable source and target model pickers for hundreds of LLMs.
- Category comparison with `Overall` as the default.
- Transitive chain results with model names, benchmark names, and values.
- Leaderboard views for individual benchmarks.
- Report tab with statistics about weak-to-strong paths, bridge models, benchmark usage, and unreachable pairs.
- Share-link button for the current comparison.
- High-resolution PNG export for sharing comparison results.
- GitHub Pages deployment with a custom domain.
- Scheduled Artificial Analysis data updates through GitHub Actions.
- Google Analytics and Baidu Tongji support.

## How It Works

The generated data is treated as a graph:

- Each model is a node.
- Each concrete benchmark comparison can create a directed edge.
- If Model A scores better than Model B on a benchmark by enough margin, the graph contains `A -> B`.
- For a selected category, the frontend builds the relevant graph and runs breadth-first search.
- Breadth-first search returns the shortest chain from the source model to the target model, up to the configured hop limit.

Example:

```text
Llama 2 Chat 7B
  -> GPT-5.4 mini on Humanity's Last Exam
  -> DeepSeek V3.2 on SciCode
  -> Claude Opus 4.7 on IFBench
```

`Overall` searches across all concrete benchmarks currently available in the generated data. More specific categories, such as `Intelligence`, only search benchmarks in that category.

## Data Source

The project uses generated files from the Artificial Analysis API. The browser never calls Artificial Analysis directly.

Data generation flow:

```text
scripts/update-data.ts
  -> Artificial Analysis API
  -> public/data/raw.json
  -> public/data/models.json
  -> public/data/leaderboards.json
  -> public/data/metadata.json
  -> public/data/graph.json
  -> public/data/unreachable-overall-pairs.json
  -> public/data/report.json
```

Important generated files:

- `public/data/raw.json`: raw API response for auditing and debugging.
- `public/data/models.json`: normalized model records.
- `public/data/leaderboards.json`: benchmark leaderboards used by the app.
- `public/data/metadata.json`: source and generation metadata.
- `public/data/graph.json`: generated graph-oriented data.
- `public/data/unreachable-overall-pairs.json`: lower-intelligence source models that cannot reach higher-intelligence targets in `Overall`.
- `public/data/report.json`: statistics used by the Report tab.

## Local Development

Install dependencies:

```sh
npm install
```

Create a local `.env` file:

```text
AA_API_KEY=replace_me
```

Update data:

```sh
npm run data:update
npm run data:analyze-unreachable
npm run data:report
```

Start the dev server:

```sh
npm run dev
```

Run checks:

```sh
npm test
npm run build
npm audit --audit-level=moderate
```

## Scripts

```sh
npm run dev
```

Starts the Vite dev server.

```sh
npm run build
```

Runs TypeScript checking and builds the static site into `dist/`.

```sh
npm test
```

Runs Vitest tests.

```sh
npm run data:update
```

Fetches Artificial Analysis data and writes generated JSON files.

```sh
npm run data:analyze-unreachable
```

Searches weak-to-strong model pairs and writes unreachable pair records.

```sh
npm run data:report
```

Builds the statistics report consumed by the Report tab.

## Secrets And Public Config

This repository is intended to be public.

Keep secrets out of the repo:

- `.env` is ignored by Git.
- `.env.example` is safe to commit.
- `AA_API_KEY` must stay server-side or local-only.
- Do not expose the Artificial Analysis API key through any `VITE_*` variable.
- Do not commit generated logs, screenshots, or raw error payloads that might include secrets.

Public frontend IDs are not secrets:

- `VITE_GA_ID`
- `VITE_BAIDU_TONGJI_ID`

The app has default analytics IDs in `src/analytics.ts`, and GitHub Actions can override them with repository variables.

## Analytics

Analytics are installed from `src/analytics.ts`.

Current defaults:

```text
Google Analytics: G-9VKCGJ2TSZ
Baidu Tongji: 6e2b5eae2bbfdfc895a99c635fb9e384
```

Optional GitHub repository variables:

```text
VITE_GA_ID
VITE_BAIDU_TONGJI_ID
```

These IDs are bundled into the public frontend. That is expected for analytics tracking IDs.

## GitHub Pages Deployment

Deployment is handled by:

```text
.github/workflows/deploy-pages.yml
```

The workflow:

1. Checks out the repo.
2. Installs Node.js 22.
3. Runs `npm ci`.
4. Runs `npm test`.
5. Runs `npm run build`.
6. Uploads `dist/` as the GitHub Pages artifact.
7. Deploys with `actions/deploy-pages`.

GitHub setup:

1. Open the repository on GitHub.
2. Go to `Settings -> Pages`.
3. Set `Build and deployment` to `GitHub Actions`.
4. Add the custom domain:

```text
llm-win.com
```

The custom domain file is:

```text
public/CNAME
```

with content:

```text
llm-win.com
```

## Scheduled Data Updates

Data updates are handled by:

```text
.github/workflows/update-aa-data.yml
```

The workflow runs daily and can also be triggered manually from GitHub Actions.

Required GitHub secret:

```text
AA_API_KEY
```

The workflow:

1. Runs `npm run data:update`.
2. Runs `npm run data:analyze-unreachable`.
3. Runs `npm run data:report`.
4. Runs `npm test`.
5. Commits changed `public/data/*.json` files.

## Cloudflare DNS

For the root domain `llm-win.com`, add GitHub Pages A records in Cloudflare:

```text
A  @  185.199.108.153
A  @  185.199.109.153
A  @  185.199.110.153
A  @  185.199.111.153
```

Optional `www` redirect/support:

```text
CNAME  www  Spico197.github.io
```

Recommended order:

1. Configure GitHub Pages first.
2. Add or confirm Cloudflare DNS records.
3. In GitHub Pages settings, wait for DNS verification.
4. Enable `Enforce HTTPS`.

If Cloudflare proxy causes certificate or verification friction, switch the records to DNS-only until GitHub Pages finishes provisioning HTTPS.

## Project Structure

```text
src/
  analytics.ts          Analytics installers
  main.tsx              React app and UI views
  styles.css            Site styles
  lib/
    graph.ts            Graph construction and BFS search
    graph.test.ts       Graph tests
    leaderboards.ts     Leaderboard builders
    metrics.ts          Metric definitions and formatting
    normalize.ts        API normalization helpers
    types.ts            Shared types

scripts/
  update-data.ts                    Fetch and normalize AA data
  analyze-unreachable-overall.ts    Weak-to-strong reachability analysis
  build-report.ts                   Report data generation

public/
  CNAME
  data/

.github/workflows/
  deploy-pages.yml
  update-aa-data.yml
```

## Notes

This is a fun transitive comparison tool, not a scientific claim that one model is always better than another. A chain means that each step has a benchmark receipt. It does not mean the source model dominates the target model in every task, product setting, price point, or latency regime.
