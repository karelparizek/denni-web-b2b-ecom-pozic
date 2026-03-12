# B2B/Ecom Role Dashboard

## Run

```bash
cd /Users/karel.parizek/Documents/Codex/denni-web-b2b-ecom-pozic
node server.mjs
```

Open `http://127.0.0.1:8787`.

## Manual Update Button

- `Manualni update` triggers `POST /api/manual-update`.
- Backend runs `update-data.mjs`, discovers live roles from configured ATS boards, and validates direct job links.
- Ranking prioritizes `Prague/Praha/hybrid`, then uses `CEE/Europe remote-hybrid` fallback to get as close to 20 active roles as possible.

## Data Files

- `sources.json`: manual role seeds plus ATS discovery config (`Greenhouse`, `Lever`).
- `data.json`: generated live role list with Prague-first ordering and current validation timestamps.
- `data.js`: browser-loadable mirror of `data.json`.

## HR Source Note

HR discovery source can be LinkedIn or any other job board/ATS (`hr_sources`). Final published role link must stay employer-direct (`url`) to keep direct-application flow.

## How Similar Roles Are Found Next Time

- Add or remove ATS boards in `sources.json > discovery`.
- Keep manual seeds in `sources.json > roles` only for boards that do not expose a usable public API.
- `update-data.mjs` scores titles by seniority and B2B/e-commerce relevance, validates the direct ad page, and then sorts Prague first.

## Current Ranking Rule

- Output contains only direct verified ads.
- Prague/hybrid roles are first.
- If Prague/hybrid roles are below target, CEE/Europe remote-hybrid roles fill the remaining slots.
- Default discovery links are generated for `Jobs.cz`, `Prace.cz`, `StartupJobs`, and `LinkedIn` when missing.
