# B2B/Ecom Role Dashboard

## Run

```bash
cd /Users/karel.parizek/Documents/Codex/denni-web-b2b-ecom-pozic
node server.mjs
```

Open `http://127.0.0.1:8787`.

## Manual Update Button

- `Manualni update` triggers `POST /api/manual-update`.
- Backend runs `update-data.mjs` and fully revalidates all candidate links.
- Ranking prioritizes `Prague/Praha/hybrid`, then highest `match_rate`.

## Data Files

- `sources.json`: candidate pool + metadata, including generic `hr_sources` (or legacy `linkedin_url`) as discovery sources.
- `data.json`: generated top 20 live roles.
- `data.js`: browser-loadable mirror of `data.json`.

## HR Source Note

HR discovery source can be LinkedIn or any other job board/ATS (`hr_sources`). Final published role link stays employer-direct (`url`) to keep direct-application flow.

## How Similar Roles Are Found Next Time

- Add new candidate rows to `sources.json` from any HR source (LinkedIn, Welcome to the Jungle, Jobs.cz, Greenhouse boards, Lever boards, etc.).
- Keep `url` as employer-direct posting and put discovery links into `hr_sources`.
- `update-data.mjs` now infers missing `base_match_rate` from role title keywords:
- seniority terms (`Head`, `Director`, `Regional Lead`, `Senior Lead`, `VP`)
- B2B/e-commerce relevance (`B2B`, `e-commerce`, `growth`, `product marketing`)
- Prague/hybrid location is prioritized in final ranking.

## Current Ranking Rule

- Output is strict `Prague/Praha/hybrid` only.
- Dashboard always shows top 20 rows.
- Verified links are ranked first; if verified Prague/hybrid roles are <20, remaining slots are filled from Prague/hybrid discovery candidates and marked in `Ověření odkazu`.
- Default discovery links are generated for `Jobs.cz`, `Prace.cz`, `StartupJobs`, and `LinkedIn` when missing.
