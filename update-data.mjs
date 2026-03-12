import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCES_PATH = path.join(__dirname, "sources.json");
const JSON_OUT = path.join(__dirname, "data.json");
const JS_OUT = path.join(__dirname, "data.js");

const USER_AGENT = "Mozilla/5.0 (CodexB2BRoleDiscoveryBot)";
const BAD_LINK_SIGNALS = [
  "not found",
  "404",
  "job is closed",
  "position has been filled",
  "no longer available",
  "nenasli jsme zadne nabidky prace odpovidajici zadani",
  "nenašli jsme žádné nabídky práce odpovídající zadání",
  "bohuzel jsme nenasli zadnou nabidku",
  "bohužel jsme nenašli žádnou nabídku",
  "no jobs found",
  "no matching jobs"
];
const NEGATIVE_TITLE_RE = /\b(engineer|engineering|developer|software|data engineer|designer|ux|ui|recruit|talent|hr|finance|legal|accountant|controller|qa|support|customer support|devops)\b/i;
const POSITIVE_TITLE_RE = /\b(marketing|growth|demand generation|demand gen|product marketing|field marketing|partner marketing|brand|crm|lifecycle|retention|acquisition|gtm|go[- ]to[- ]market|commercial marketing|b2b|e-?commerce|marketplace)\b/i;
const SENIORITY_RE = /\b(head|director|lead|manager|senior|regional|global|vp|chief|cmo)\b/i;
const CEE_LOCATION_RE = /\b(prague|praha|czech|czechia|czech republic|slovakia|poland|warsaw|krakow|wroclaw|brno|budapest|hungary|romania|bucharest|bulgaria|sofia|slovenia|ljubljana|croatia|zagreb|serbia|belgrade|vilnius|lithuania|latvia|estonia|cee|central europe|europe|emea|remote|hybrid)\b/i;

function safeNowDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeWhitespace(String(value || "").replace(/<[^>]+>/g, " "));
}

function hasPragueHybrid(location) {
  const l = normalizeWhitespace(location).toLowerCase();
  return l.includes("prague") || l.includes("praha") || l.includes("hybrid");
}

function isCeeOrRemote(location) {
  return CEE_LOCATION_RE.test(normalizeWhitespace(location));
}

function computeMatchRate(base, location) {
  const loc = normalizeWhitespace(location).toLowerCase();
  let boost = 0;
  if (loc.includes("prague") || loc.includes("praha")) boost += 8;
  if (loc.includes("hybrid")) boost += 4;
  if (loc.includes("remote")) boost += 2;
  return Math.min(99, Math.max(1, base + boost));
}

function buildDefaultHrSources(role) {
  const query = encodeURIComponent(`${role.title || ""} ${role.company || ""} Prague hybrid`.trim());
  return [
    { label: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${query}` },
    { label: "Jobs.cz", url: `https://www.jobs.cz/prace/?q=${query}` },
    { label: "Prace.cz", url: `https://www.prace.cz/hledani/?search%5Bphrase%5D=${query}` },
    { label: "StartupJobs", url: `https://www.startupjobs.com/jobs?search=${query}` }
  ];
}

function inferEstimatedCompensation(role) {
  if (role.estimated_compensation_czk_per_month) return role.estimated_compensation_czk_per_month;

  const title = normalizeWhitespace(role.title).toLowerCase();
  if (/\b(cmo|chief|vp|director)\b/.test(title)) return "170000-280000";
  if (/\b(head|regional|global|senior lead|lead)\b/.test(title)) return "140000-220000";
  if (/\b(senior manager|manager)\b/.test(title)) return "110000-180000";
  if (/\b(specialist|associate)\b/.test(title)) return "70000-120000";
  return "100000-160000";
}

function inferRoleType(role) {
  return normalizeWhitespace(role.role_type || role.commitment || role.employment_type || "Full-time");
}

function inferBaseMatchRate(role) {
  if (typeof role.base_match_rate === "number") return role.base_match_rate;

  const title = normalizeWhitespace(role.title).toLowerCase();
  const location = normalizeWhitespace(role.location).toLowerCase();
  const text = `${title} ${normalizeWhitespace(role.description).toLowerCase()}`;
  let score = 36;

  if (/\b(cmo|chief|vp)\b/.test(title)) score += 28;
  else if (/\b(head|director)\b/.test(title)) score += 24;
  else if (/\b(regional lead|senior lead|global lead)\b/.test(title)) score += 22;
  else if (/\blead\b/.test(title)) score += 18;
  else if (/\bmanager\b/.test(title)) score += 12;
  else if (/\bspecialist|analyst\b/.test(title)) score += 4;

  if (/\bb2b\b/.test(text)) score += 14;
  if (/\be-?commerce|ecom|marketplace\b/.test(text)) score += 10;
  if (/\bmarketing\b/.test(text)) score += 8;
  if (/\bgrowth|demand generation|product marketing|partner marketing|field marketing|lifecycle|crm|retention|acquisition|go[- ]to[- ]market|gtm\b/.test(text)) score += 8;
  if (/\bregional|cee|central europe|emea|global\b/.test(text)) score += 4;
  if (hasPragueHybrid(location)) score += 6;
  if (NEGATIVE_TITLE_RE.test(title)) score -= 30;

  return Math.min(95, Math.max(30, score));
}

function locationTier(location) {
  const loc = normalizeWhitespace(location).toLowerCase();
  const isPrague = loc.includes("prague") || loc.includes("praha");
  const isHybrid = loc.includes("hybrid");
  const isRemote = loc.includes("remote");

  if (isPrague && isHybrid) return 4;
  if (isPrague) return 3;
  if (isHybrid && isCeeOrRemote(loc)) return 2;
  if (isCeeOrRemote(loc) || isRemote) return 1;
  return 0;
}

function isRelevantRole(role) {
  const title = normalizeWhitespace(role.title);
  const text = `${title} ${normalizeWhitespace(role.description)}`;

  if (!title || NEGATIVE_TITLE_RE.test(title)) return false;
  if (!POSITIVE_TITLE_RE.test(text)) return false;
  if (!SENIORITY_RE.test(text)) return false;
  if (/\b(pr|communications?)\b/i.test(title) && !/\bmarketing\b/i.test(title)) return false;
  return inferBaseMatchRate(role) >= 58;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json,text/plain,*/*"
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function discoverGreenhouseJobs(board) {
  try {
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`);
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs.map((job) => ({
      title: normalizeWhitespace(job.title),
      company: board.company,
      role_type: inferRoleType({
        role_type: job.metadata?.find?.((item) => /employment|commitment/i.test(item.name || ""))?.value
      }),
      location: normalizeWhitespace(job.location?.name || ""),
      estimated_compensation_czk_per_month: inferEstimatedCompensation({ title: job.title }),
      base_match_rate: inferBaseMatchRate({
        title: job.title,
        location: job.location?.name || "",
        description: stripHtml(job.content || "")
      }),
      url: job.absolute_url,
      source: `${board.label} discovery`,
      description: stripHtml(job.content || ""),
      hr_sources: buildDefaultHrSources({ title: job.title, company: board.company })
    }));
  } catch {
    return [];
  }
}

async function discoverLeverJobs(site) {
  try {
    const jobs = await fetchJson(`https://api.lever.co/v0/postings/${site.token}?mode=json`);
    return (Array.isArray(jobs) ? jobs : []).map((job) => ({
      title: normalizeWhitespace(job.text),
      company: site.company,
      role_type: inferRoleType({ role_type: job.categories?.commitment }),
      location: normalizeWhitespace(job.categories?.location || job.categories?.allLocations || ""),
      estimated_compensation_czk_per_month: inferEstimatedCompensation({ title: job.text }),
      base_match_rate: inferBaseMatchRate({
        title: job.text,
        location: job.categories?.location || job.categories?.allLocations || "",
        description: stripHtml(job.descriptionPlain || job.description || "")
      }),
      url: job.hostedUrl,
      source: `${site.label} discovery`,
      description: stripHtml(job.descriptionPlain || job.description || ""),
      hr_sources: buildDefaultHrSources({ title: job.text, company: site.company })
    }));
  } catch {
    return [];
  }
}

function hostOf(input) {
  return input.hostname.replace(/^www\./, "").toLowerCase();
}

function isSearchOrListingUrl(input) {
  const host = hostOf(input);
  const pathname = input.pathname.toLowerCase();
  const hasSearchParams = ["q", "search", "keywords", "phrase"].some((p) => input.searchParams.has(p));

  if (hasSearchParams) return true;
  if (host.includes("jobs.cz") && pathname.startsWith("/prace")) return true;
  if (host.includes("prace.cz") && pathname.startsWith("/hledani")) return true;
  if (host.includes("startupjobs.com") && pathname === "/jobs") return true;
  if (host.includes("linkedin.com") && pathname.startsWith("/jobs/search")) return true;
  return false;
}

async function checkLink(url) {
  try {
    const initialUrl = new URL(url);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      }
    });

    const finalUrl = res.url || url;
    const finalUrlParsed = new URL(finalUrl);
    const text = (await res.text()).toLowerCase().slice(0, 35000);
    const badContent = BAD_LINK_SIGNALS.some((signal) => text.includes(signal));
    const badRedirect = /404|not-found|job-not-found|error/.test(finalUrl.toLowerCase());
    const notDirectAd = isSearchOrListingUrl(finalUrlParsed) || (isSearchOrListingUrl(initialUrl) && finalUrlParsed.origin === initialUrl.origin);
    const ok = res.status >= 200 && res.status < 300 && !badContent && !badRedirect && !notDirectAd;

    return { ok, status: res.status, final_url: finalUrl };
  } catch (err) {
    return { ok: false, status: 0, final_url: url, error: err.message };
  }
}

async function main() {
  const sourceData = JSON.parse(await fs.readFile(SOURCES_PATH, "utf8"));
  const checkedAt = safeNowDate();
  const runTimestamp = new Date().toISOString();
  const skipValidation = process.env.SKIP_LINK_VALIDATION === "1";
  const targetRoles = sourceData.discovery?.target_roles || 20;
  let previousData = null;

  try {
    previousData = JSON.parse(await fs.readFile(JSON_OUT, "utf8"));
  } catch {
    previousData = null;
  }

  const greenhouseBoards = Array.isArray(sourceData.discovery?.greenhouse_boards) ? sourceData.discovery.greenhouse_boards : [];
  const leverCompanies = Array.isArray(sourceData.discovery?.lever_companies) ? sourceData.discovery.lever_companies : [];

  const discovered = [
    ...(await Promise.all(greenhouseBoards.map(discoverGreenhouseJobs))).flat(),
    ...(await Promise.all(leverCompanies.map(discoverLeverJobs))).flat()
  ];

  const manualRoles = Array.isArray(sourceData.roles) ? sourceData.roles : [];
  const mergedCandidates = uniqueBy(
    [...manualRoles, ...discovered]
      .map((role) => ({
        ...role,
        title: normalizeWhitespace(role.title),
        company: normalizeWhitespace(role.company),
        role_type: inferRoleType(role),
        location: normalizeWhitespace(role.location),
        estimated_compensation_czk_per_month: inferEstimatedCompensation(role),
        base_match_rate: inferBaseMatchRate(role),
        description: normalizeWhitespace(role.description)
      }))
      .filter((role) => role.url && role.title && role.company)
      .filter(isRelevantRole),
    (role) => `${role.url}::${role.title.toLowerCase()}::${role.company.toLowerCase()}`
  );

  const checked = [];
  for (const role of mergedCandidates) {
    const link = skipValidation ? { ok: true, status: 200, final_url: role.url } : await checkLink(role.url);
    checked.push({
      ...role,
      match_rate: computeMatchRate(role.base_match_rate, role.location),
      link_verified: link.ok,
      link_status: link.status,
      final_url: link.final_url,
      link_checked_at: checkedAt
    });
  }

  const zeroStatusCount = checked.filter((role) => role.link_status === 0).length;
  const networkLikelyBlocked = !skipValidation && checked.length > 0 && zeroStatusCount === checked.length;
  if (networkLikelyBlocked && previousData && Array.isArray(previousData.roles) && previousData.roles.length > 0) {
    const reused = {
      ...previousData,
      last_checked_at: runTimestamp,
      last_run_status: "reused_previous_data",
      last_run_reason: "network blocked during validation"
    };
    await fs.writeFile(JSON_OUT, `${JSON.stringify(reused, null, 2)}\n`, "utf8");
    await fs.writeFile(JS_OUT, `window.DASHBOARD_DATA = ${JSON.stringify(reused, null, 2)};\n`, "utf8");
    console.log(JSON.stringify({
      ok: true,
      reused_previous_data: true,
      checked_at: runTimestamp,
      total_roles: reused.roles.length
    }, null, 2));
    return;
  }

  const verified = checked.filter((role) => role.link_verified);
  const ranked = verified
    .filter((role) => locationTier(role.location) > 0)
    .sort((a, b) => {
      const tierDiff = locationTier(b.location) - locationTier(a.location);
      if (tierDiff !== 0) return tierDiff;
      return b.match_rate - a.match_rate;
    })
    .slice(0, targetRoles)
    .map((role) => ({
      title: role.title,
      company: role.company,
      role_type: role.role_type,
      location: role.location,
      estimated_compensation_czk_per_month: role.estimated_compensation_czk_per_month,
      match_rate: role.match_rate,
      url: role.final_url,
      source: role.source,
      hr_sources: Array.isArray(role.hr_sources) && role.hr_sources.length > 0 ? role.hr_sources : buildDefaultHrSources(role),
      link_verified: role.link_verified,
      link_status: role.link_status,
      link_checked_at: role.link_checked_at
    }));

  const pragueRoles = ranked.filter((role) => hasPragueHybrid(role.location)).length;
  const out = {
    generated_at: runTimestamp,
    last_checked_at: runTimestamp,
    last_run_status: "fresh_data",
    last_run_reason: null,
    timezone: sourceData.timezone,
    currency: sourceData.currency,
    total_roles: ranked.length,
    target_roles: targetRoles,
    prague_hybrid_roles: pragueRoles,
    validation_rule: skipValidation
      ? "Discovery + validation skipped by SKIP_LINK_VALIDATION=1."
      : "Live ATS discovery from Greenhouse and Lever, then validation of direct ads. Prague/hybrid prioritized, CEE/remote fallback allowed.",
    roles: ranked
  };

  await fs.writeFile(JSON_OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  await fs.writeFile(JS_OUT, `window.DASHBOARD_DATA = ${JSON.stringify(out, null, 2)};\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    generated_at: runTimestamp,
    total_roles: ranked.length,
    prague_hybrid_roles: pragueRoles,
    discovered_candidates: discovered.length,
    checked_candidates: checked.length
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
