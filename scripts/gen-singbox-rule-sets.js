#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "sing-box", "rule-set");

const RULE_SOURCES = [
  {
    tag: "oc-pt",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/pt.list",
    output: "pt.json",
  },
  {
    tag: "oc-direct-custom",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/direct-custom.list",
    output: "direct-custom.json",
  },
  {
    tag: "oc-proxy-custom",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/proxy-custom.list",
    output: "proxy-custom.json",
  },
  {
    tag: "oc-android-block",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/android-block.list",
    output: "android-block.json",
  },
  {
    tag: "oc-awavenue-ads",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/awavenue-ads.list",
    output: "awavenue-ads.json",
  },
  {
    tag: "oc-ai",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/ai.list",
    output: "ai.json",
  },
  {
    tag: "oc-github",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/github.list",
    output: "github.json",
  },
  {
    tag: "oc-developer",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/developer.list",
    output: "developer.json",
  },
  {
    tag: "oc-proxy-media",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/proxy-media.list",
    output: "proxy-media.json",
  },
  {
    tag: "oc-scraper-nojp",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/scraper-nojp.list",
    output: "scraper-nojp.json",
  },
  {
    tag: "oc-scraper-jp",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/scraper-jp.list",
    output: "scraper-jp.json",
  },
  {
    tag: "oc-quest3",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/quest3.list",
    output: "quest3.json",
  },
  {
    tag: "oc-app-mutated",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/app-mutated.list",
    output: "app-mutated.json",
  },
  {
    tag: "oc-game-mutated",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/game-mutated.list",
    output: "game-mutated.json",
  },
  {
    tag: "oc-androidcn-allow",
    url: "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/androidcn-allow.list",
    output: "androidcn-allow.json",
  },
];

const FIELD_MAP = {
  DOMAIN: "domain",
  "DOMAIN-SUFFIX": "domain_suffix",
  "DOMAIN-KEYWORD": "domain_keyword",
  "DOMAIN-REGEX": "domain_regex",
  "IP-CIDR": "ip_cidr",
  "IP-CIDR6": "ip_cidr",
  "PROCESS-NAME": "process_name",
  "PROCESS-PATH": "process_path",
};

const CHUNK_SIZE = 500;

function fetchText(url, redirectLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(new URL(url), (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location && redirectLeft > 0) {
        response.resume();
        fetchText(location, redirectLeft - 1).then(resolve).catch(reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }

      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => resolve(data));
    });

    request.on("error", reject);
  });
}

function compactValues(values) {
  const out = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

function chunkArray(values, size) {
  if (values.length <= size) return [values];
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function parseClashRules(text) {
  const valuesByField = new Map();
  const unsupported = new Map();

  const pushValue = (field, value) => {
    if (!valuesByField.has(field)) valuesByField.set(field, []);
    valuesByField.get(field).push(value);
  };

  const pushUnsupported = (kind) => {
    const key = String(kind || "").trim() || "(empty)";
    unsupported.set(key, (unsupported.get(key) || 0) + 1);
  };

  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const parts = line.split(",");
    if (parts.length < 2) continue;

    const kind = parts[0].trim().toUpperCase();
    const mapped = FIELD_MAP[kind];
    if (!mapped) {
      pushUnsupported(kind);
      continue;
    }

    const value = parts[1].trim();
    if (!value) continue;
    pushValue(mapped, value);
  }

  const rules = [];
  for (const [field, rawValues] of valuesByField.entries()) {
    const values = compactValues(rawValues);
    for (const chunk of chunkArray(values, CHUNK_SIZE)) {
      rules.push({ [field]: chunk });
    }
  }

  return { rules, unsupported };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifest = [];
  for (const source of RULE_SOURCES) {
    const text = await fetchText(source.url);
    const { rules, unsupported } = parseClashRules(text);

    const output = {
      version: 3,
      rules,
    };
    const outPath = path.join(OUTPUT_DIR, source.output);
    fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

    manifest.push({
      tag: source.tag,
      source: source.url,
      file: path.relative(ROOT, outPath),
      rules: rules.length,
      unsupported: Object.fromEntries(unsupported.entries()),
    });
  }

  const manifestPath = path.join(OUTPUT_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  for (const item of manifest) {
    const unsupportedKinds = Object.keys(item.unsupported);
    const unsupportedText =
      unsupportedKinds.length === 0
        ? "unsupported=none"
        : `unsupported=${unsupportedKinds
            .map((key) => `${key}:${item.unsupported[key]}`)
            .join("|")}`;
    console.log(
      `[sing-box-rules] ${item.tag} -> ${item.file} (rules=${item.rules}, ${unsupportedText})`
    );
  }
}

main().catch((error) => {
  console.error(`[sing-box-rules] failed: ${error && error.message ? error.message : String(error)}`);
  process.exit(1);
});
