import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCES_PATH = path.join(__dirname, "sources.json");
const JSON_OUT = path.join(__dirname, "data.json");
const JS_OUT = path.join(__dirname, "data.js");

function hasPragueHybrid(location) {
  const l = (location || "").toLowerCase();
  return l.includes("prague") || l.includes("praha") || l.includes("hybrid");
}

function safeNowDate() {
  return new Date().toISOString().slice(0, 10);
}

function computeMatchRate(base, location) {
  const boost = hasPragueHybrid(location) ? 10 : 0;
  return Math.min(99, Math.max(1, base + boost));
}

function inferBaseMatchRate(role) {
  if (typeof role.base_match_rate === "number") return role.base_match_rate;

  const title = (role.title || "").toLowerCase();
  let score = 52;

  if (/\b(head|director|regional lead|senior lead|vp)\b/.test(title)) score += 20;
  else if (/\blead\b/.test(title)) score += 14;
  else if (/\bmanager\b/.test(title)) score += 10;
  else if (/\bspecialist|analyst\b/.test(title)) score += 4;

  if (/\bb2b\b/.test(title)) score += 12;
  if (/\be-?commerce|ecom\b/.test(title)) score += 8;
  if (/\bmarketing\b/.test(title)) score += 6;
  if (/\bgrowth|demand generation|product marketing\b/.test(title)) score += 4;
  if (/\bpr\b/.test(title)) score -= 4;

  return Math.min(95, Math.max(45, score));
}

async function checkLink(url) {
  const badSignals = ["not found", "404", "job is closed", "position has been filled", "no longer available"];

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (CodexAutomationLinkValidator)",
        accept: "text/html,application/xhtml+xml"
      }
    });

    const finalUrl = res.url || url;
    const status = res.status;
    const text = (await res.text()).toLowerCase().slice(0, 12000);

    const badContent = badSignals.some((s) => text.includes(s));
    const badRedirect = /404|not-found|job-not-found|error/.test(finalUrl.toLowerCase());

    const ok = status >= 200 && status < 300 && !badContent && !badRedirect;
    return { ok, status, final_url: finalUrl };
  } catch (err) {
    return { ok: false, status: 0, final_url: url, error: err.message };
  }
}

async function main() {
  const raw = await fs.readFile(SOURCES_PATH, "utf8");
  const sourceData = JSON.parse(raw);
  const checkedAt = safeNowDate();
  const skipValidation = process.env.SKIP_LINK_VALIDATION === "1";
  let previousData = null;

  try {
    previousData = JSON.parse(await fs.readFile(JSON_OUT, "utf8"));
  } catch {
    previousData = null;
  }

  const checked = [];
  for (const role of sourceData.roles) {
    const link = skipValidation
      ? { ok: true, status: 200, final_url: role.url }
      : await checkLink(role.url);
    checked.push({
      ...role,
      match_rate: computeMatchRate(inferBaseMatchRate(role), role.location),
      link_verified: link.ok,
      link_status: link.status,
      final_url: link.final_url,
      link_checked_at: checkedAt
    });
  }

  const verified = checked.filter((r) => r.link_verified);
  const zeroStatusCount = checked.filter((r) => r.link_status === 0).length;
  const networkLikelyBlocked = !skipValidation && checked.length > 0 && zeroStatusCount === checked.length;

  if (networkLikelyBlocked && previousData && Array.isArray(previousData.roles) && previousData.roles.length > 0) {
    await fs.writeFile(JSON_OUT, `${JSON.stringify(previousData, null, 2)}\n`, "utf8");
    await fs.writeFile(JS_OUT, `window.DASHBOARD_DATA = ${JSON.stringify(previousData, null, 2)};\n`, "utf8");
    console.log(JSON.stringify({
      ok: true,
      reused_previous_data: true,
      reason: "network blocked during validation",
      total_roles: previousData.roles.length
    }, null, 2));
    return;
  }

  const selected = verified
    .sort((a, b) => {
      const aPrague = hasPragueHybrid(a.location) ? 1 : 0;
      const bPrague = hasPragueHybrid(b.location) ? 1 : 0;
      if (aPrague !== bPrague) return bPrague - aPrague;
      return b.match_rate - a.match_rate;
    })
    .slice(0, 20)
    .map((r) => {
      const hrSources = Array.isArray(r.hr_sources) && r.hr_sources.length > 0
        ? r.hr_sources
        : (r.linkedin_url ? [{ label: "LinkedIn", url: r.linkedin_url }] : []);

      return {
      title: r.title,
      company: r.company,
      role_type: r.role_type,
      location: r.location,
      estimated_compensation_czk_per_month: r.estimated_compensation_czk_per_month,
      match_rate: r.match_rate,
      url: r.final_url,
      source: r.source,
      hr_sources: hrSources,
      link_verified: r.link_verified,
      link_status: r.link_status,
      link_checked_at: r.link_checked_at
      };
    });

  const out = {
    generated_at: new Date().toISOString(),
    timezone: sourceData.timezone,
    currency: sourceData.currency,
    total_roles: selected.length,
    validation_rule: skipValidation
      ? "Validation skipped by SKIP_LINK_VALIDATION=1. Prague/hybrid prioritized in ranking."
      : "Full list revalidated on manual/automated run. Prague/hybrid prioritized in ranking.",
    roles: selected
  };

  await fs.writeFile(JSON_OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  await fs.writeFile(JS_OUT, `window.DASHBOARD_DATA = ${JSON.stringify(out, null, 2)};\n`, "utf8");

  console.log(JSON.stringify({ ok: true, total_roles: selected.length, generated_at: out.generated_at }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
