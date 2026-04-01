#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const RULES_DIR = path.join(ROOT, "rules");

const SOURCES = [
  {
    name: "app-mutated",
    sourceLabel: "mnixry/direct-android-ruleset",
    url: "https://raw.githubusercontent.com/mnixry/direct-android-ruleset/rules/@Merged/APP.mutated.yaml",
    outFile: path.join(RULES_DIR, "app-mutated.list"),
  },
  {
    name: "game-mutated",
    sourceLabel: "mnixry/direct-android-ruleset",
    url: "https://raw.githubusercontent.com/mnixry/direct-android-ruleset/rules/@Merged/GAME.mutated.yaml",
    outFile: path.join(RULES_DIR, "game-mutated.list"),
  },
  {
    name: "adblock-reject",
    sourceLabel: "217heidai/adblockfilters",
    url: "https://raw.githubusercontent.com/217heidai/adblockfilters/main/rules/adblockmihomolite.yaml",
    outFile: path.join(RULES_DIR, "adblock-reject.list"),
    parser: "payload-yaml",
  },
  {
    name: "awavenue-ads",
    sourceLabel: "TG-Twilight/AWAvenue-Ads-Rule",
    url: "https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/Filters/AWAvenue-Ads-Rule-QuantumultX.list",
    outFile: path.join(RULES_DIR, "awavenue-ads.list"),
    parser: "qx-list",
  },
  {
    name: "ddgksf-ads",
    sourceLabel: "ddgksf2013/Profile/QuantumultX.conf(filter_remote reject)",
    url: "https://ddgksf2013.top/Profile/QuantumultX.conf",
    outFile: path.join(RULES_DIR, "ddgksf-ads.list"),
    parser: "qx-conf-reject-merge",
  },
];

function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`Too many redirects: ${url}`));
      return;
    }

    const mod = url.startsWith("https://") ? https : http;
    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent": "OpenClash-Rules ruleset sync",
          Accept: "text/plain, text/yaml, application/x-yaml, */*",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location) {
          res.resume();
          const nextUrl = new URL(location, url).toString();
          fetchText(nextUrl, redirectCount + 1).then(resolve, reject);
          return;
        }

        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status}: ${url}`));
          return;
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve(body));
      }
    );

    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Request timeout: ${url}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url, attempts = 4) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fetchText(url);
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        const delay = i * 1500;
        console.warn(`[ruleset-sync] retry ${i}/${attempts - 1} after error: ${err.message}`);
        await sleep(delay);
      }
    }
  }
  throw lastError || new Error(`Failed to fetch: ${url}`);
}

function unquote(value) {
  const s = value.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function stripInlineComment(value) {
  return value.replace(/\s+#.*$/, "");
}

function parsePayloadToList(yamlText) {
  const lines = yamlText.replace(/\r/g, "").split("\n");
  const out = [];
  const seen = new Set();
  let inPayload = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (!inPayload) {
      if (line === "payload:") inPayload = true;
      continue;
    }

    if (!line.startsWith("- ")) {
      // payload block ended
      if (!raw.startsWith(" ")) break;
      continue;
    }

    const itemText = line.slice(2).trim();
    const item = unquote(stripInlineComment(itemText)).trim();
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }

  return out;
}

function normalizeEntryBySource(sourceName, entry) {
  if (sourceName !== "adblock-reject") return entry;

  const text = entry.trim();
  if (!text) return "";

  // adblockmihomolite payload uses "+.domain" style; convert to mihomo classical list.
  if (text.startsWith("+.")) {
    const domain = text.slice(2).trim();
    return domain ? `DOMAIN-SUFFIX,${domain}` : "";
  }

  return text;
}

function normalizeEntries(sourceName, entries) {
  const out = [];
  const seen = new Set();

  for (const entry of entries) {
    const normalized = normalizeEntryBySource(sourceName, entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function parseQuantumultXList(listText) {
  const lines = listText.replace(/\r/g, "").split("\n");
  const out = [];
  const seen = new Set();
  const kindMap = new Map([
    ["DOMAIN", "DOMAIN"],
    ["HOST", "DOMAIN"],
    ["DOMAIN-SUFFIX", "DOMAIN-SUFFIX"],
    ["HOST-SUFFIX", "DOMAIN-SUFFIX"],
    ["DOMAIN-KEYWORD", "DOMAIN-KEYWORD"],
    ["HOST-KEYWORD", "DOMAIN-KEYWORD"],
    ["IP-CIDR", "IP-CIDR"],
    ["IP-CIDR6", "IP-CIDR6"],
    ["IP6-CIDR", "IP-CIDR6"],
  ]);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("[")) continue;

    const [kindRaw, valueRaw] = line.split(",");
    const kind = (kindRaw || "").trim().toUpperCase();
    const value = (valueRaw || "").trim();
    const mappedKind = kindMap.get(kind);
    if (!mappedKind || !value) continue;

    const converted = `${mappedKind},${value}`;
    if (seen.has(converted)) continue;
    seen.add(converted);
    out.push(converted);
  }

  return out;
}

function parseQxFilterRemoteRejectUrls(confText) {
  const lines = confText.replace(/\r/g, "").split("\n");
  const out = [];
  const seen = new Set();
  let inFilterRemote = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    if (/^\[.*\]$/.test(line)) {
      inFilterRemote = line.toLowerCase() === "[filter_remote]";
      continue;
    }
    if (!inFilterRemote) continue;

    const parts = line.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const url = parts[0];
    if (!/^https?:\/\//i.test(url)) continue;

    const attrs = {};
    for (const item of parts.slice(1)) {
      const idx = item.indexOf("=");
      if (idx <= 0) continue;
      const key = item.slice(0, idx).trim().toLowerCase();
      const value = item.slice(idx + 1).trim();
      attrs[key] = value;
    }

    const enabled = (attrs.enabled || "true").toLowerCase();
    if (enabled === "false") continue;

    const forcePolicy = (attrs["force-policy"] || "").toLowerCase();
    if (!forcePolicy.includes("reject")) continue;

    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }

  return out;
}

function parseRuleTextAny(rawText) {
  if (/(^|\n)\s*payload:\s*(\n|$)/.test(rawText)) {
    return parsePayloadToList(rawText);
  }
  return parseQuantumultXList(rawText);
}

function buildListContent(sourceLabel, name, sourceUrl, entries) {
  const header = [
    `# Auto-synced from ${sourceLabel} (${name})`,
    `# Source: ${sourceUrl}`,
    "# Generated by: scripts/sync-ruleset.js",
    "",
  ];
  return `${header.join("\n")}${entries.join("\n")}\n`;
}

async function parseOne(source) {
  const sourceText = await fetchTextWithRetry(source.url);
  const parser = source.parser || "payload-yaml";
  let rawEntries = [];

  if (parser === "qx-list") {
    rawEntries = parseQuantumultXList(sourceText);
  } else if (parser === "qx-conf-reject-merge") {
    const rejectUrls = parseQxFilterRemoteRejectUrls(sourceText);
    if (rejectUrls.length === 0) {
      throw new Error(`No reject filter_remote URLs found in ${source.url}`);
    }

    for (const rejectUrl of rejectUrls) {
      const ruleText = await fetchTextWithRetry(rejectUrl);
      const parsedRules = parseRuleTextAny(ruleText);
      for (const item of parsedRules) {
        rawEntries.push(item);
      }
    }
  } else {
    rawEntries = parsePayloadToList(sourceText);
  }

  const entries = normalizeEntries(source.name, rawEntries);
  if (entries.length === 0) {
    throw new Error(`No entries parsed from ${source.url}`);
  }
  return { source, entries };
}

async function main() {
  const parsed = [];
  for (const source of SOURCES) {
    parsed.push(await parseOne(source));
  }

  for (const { source, entries } of parsed) {
    const content = buildListContent(source.sourceLabel, source.name, source.url, entries);
    fs.mkdirSync(path.dirname(source.outFile), { recursive: true });
    fs.writeFileSync(source.outFile, content, "utf8");

    console.log(
      `[ruleset-sync] ${source.name} -> ${path.relative(ROOT, source.outFile)} (entries=${entries.length})`
    );
  }
}

main().catch((err) => {
  console.error(`[ruleset-sync] failed: ${err.message}`);
  process.exit(1);
});
