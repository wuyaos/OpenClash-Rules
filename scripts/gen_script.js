#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(ROOT, "config");
const OUTPUT_DIR = path.join(ROOT, "scripts");
const DEFAULT_TEST_URL = "http://www.gstatic.com/generate_204";
const ICON_BASE = "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/";

const ICON_RULES = [
  ["节点选择", "Proxy.png"],
  ["自动选择", "Auto.png"],
  ["故障转移", "Available.png"],
  ["负载均衡", "Speedtest.png"],
  ["回家", "Home.png"],
  ["电报", "Telegram.png"],
  ["谷歌", "Google_Search.png"],
  ["GPT", "Bot.png"],
  ["GitHub", "GitHub.png"],
  ["开发", "GitHub.png"],
  ["微软云盘", "OneDrive.png"],
  ["微软服务", "Microsoft.png"],
  ["国外媒体", "ForeignMedia.png"],
  ["哔哩哔哩", "BiliBili.png"],
  ["广告拦截", "AdBlack.png"],
  ["全球直连", "Direct.png"],
  ["Final", "Final.png"],
  ["香港", "Hong_Kong.png"],
  ["TW", "Taiwan.png"],
  ["台湾", "Taiwan.png"],
  ["中国", "China.png"],
  ["狮城", "Singapore.png"],
  ["日本", "Japan.png"],
  ["美国", "United_States.png"],
  ["其他", "Global.png"],
  ["手动选择", "Available.png"],
];

function collectTargets() {
  const names = fs
    .readdirSync(CONFIG_DIR)
    .filter((name) => name.toLowerCase().endsWith(".ini"))
    .sort((a, b) => a.localeCompare(b));

  return names.map((name) => {
    const base = path.basename(name, ".ini");
    return {
      iniPath: path.join(CONFIG_DIR, name),
      outPath: path.join(OUTPUT_DIR, `override_${base}.js`),
      label: base,
    };
  });
}

function uniqueOrdered(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function toSafeName(urlText) {
  try {
    const u = new URL(urlText);
    const raw = path.basename(u.pathname) || "provider";
    const noExt = raw.replace(/\.[^.]+$/, "");
    const clean = noExt.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
    return clean || "provider";
  } catch (_e) {
    return "provider";
  }
}

function pickIcon(groupName) {
  for (const [keyword, iconName] of ICON_RULES) {
    if (groupName.includes(keyword)) {
      return `${ICON_BASE}${iconName}`;
    }
  }
  return null;
}

function parseIni(iniText) {
  const lines = iniText.split(/\r?\n/);
  const rulesets = [];
  const groups = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    if (line.startsWith("ruleset=")) {
      const body = line.slice("ruleset=".length);
      const idx = body.indexOf(",");
      if (idx <= 0) continue;

      const target = body.slice(0, idx).trim();
      const source = body.slice(idx + 1).trim();
      if (!target || !source) continue;

      rulesets.push({ target, source });
      continue;
    }

    if (line.startsWith("custom_proxy_group=")) {
      const body = line.slice("custom_proxy_group=".length);
      const chunks = body.split("`").map((part) => part.trim());
      if (chunks.length < 2) continue;

      const name = chunks[0];
      const type = chunks[1];
      const tokens = chunks.slice(2).filter(Boolean);
      if (!name || !type) continue;

      groups.push({ name, type, tokens });
    }
  }

  return { rulesets, groups };
}

function buildProxyGroup(groupSpec) {
  const { name, type, tokens } = groupSpec;
  const staticProxies = [];
  const regexTokens = [];
  let testUrl = "";
  let interval = 300;
  let tolerance = 50;

  for (const token of tokens) {
    if (token.startsWith("[]")) {
      staticProxies.push(token.slice(2));
      continue;
    }
    if (/^https?:\/\//.test(token)) {
      testUrl = token;
      continue;
    }
    if (/^\d+(?:,,\d+)?$/.test(token)) {
      const [iv, , to] = token.split(",");
      interval = Number.parseInt(iv, 10) || interval;
      tolerance = Number.parseInt(to, 10) || tolerance;
      continue;
    }
    regexTokens.push(token);
  }

  const group = { name, type };
  const icon = pickIcon(name);
  if (icon) group.icon = icon;

  const uniqueStatic = uniqueOrdered(staticProxies);
  if (uniqueStatic.length > 0) {
    group.proxies = uniqueStatic;
  }

  const filterExpr = regexTokens.join("|");
  const latencyTypes = new Set(["url-test", "fallback", "load-balance"]);

  if (latencyTypes.has(type)) {
    group["include-all"] = true;
    if (filterExpr) group.filter = filterExpr;
    group.url = testUrl || DEFAULT_TEST_URL;
    group.interval = interval;
    group.tolerance = tolerance;
  } else if (filterExpr) {
    group["include-all"] = true;
    group.filter = filterExpr;
  }

  return group;
}

function buildRulesAndProviders(rulesets) {
  const providers = {};
  const providerBySource = new Map();
  const providerNameCount = new Map();
  const rules = [];
  const seenRules = new Set();

  const addRule = (rule) => {
    if (seenRules.has(rule)) return;
    seenRules.add(rule);
    rules.push(rule);
  };

  for (const { target, source } of rulesets) {
    if (source.startsWith("[]")) {
      const builtin = source.slice(2).trim();
      if (!builtin) continue;

      if (/^FINAL$/i.test(builtin)) {
        addRule(`MATCH,${target}`);
      } else {
        addRule(`${builtin},${target}`);
      }
      continue;
    }

    const isClassic = source.startsWith("clash-classic:");
    const url = isClassic ? source.slice("clash-classic:".length).trim() : source;
    if (!url) continue;

    const providerKey = `${isClassic ? "yaml" : "text"}|${url}`;
    let providerName = providerBySource.get(providerKey);

    if (!providerName) {
      const baseName = toSafeName(url);
      const count = (providerNameCount.get(baseName) || 0) + 1;
      providerNameCount.set(baseName, count);
      providerName = count === 1 ? baseName : `${baseName}_${count}`;
      providerBySource.set(providerKey, providerName);

      providers[providerName] = {
        url,
        path: `./ruleset/${providerName}.${isClassic ? "yaml" : "list"}`,
        behavior: "classical",
        interval: 86400,
        format: isClassic ? "yaml" : "text",
        type: "http",
      };
    }

    addRule(`RULE-SET,${providerName},${target}`);
  }

  return { providers, rules };
}

function buildScriptContent(iniPath, proxyGroups, providers, rules) {
  const banner = [
    "/*",
    ` * Auto-generated from ${path.relative(ROOT, iniPath)}`,
    " * Generated by scripts/gen_script.js",
    " */",
  ].join("\n");

  return `${banner}\nfunction main(config) {\n  const generatedProxyGroups = ${JSON.stringify(
    proxyGroups,
    null,
    2
  )};\n  const generatedRuleProviders = ${JSON.stringify(providers, null, 2)};\n  const generatedRules = ${JSON.stringify(
    rules,
    null,
    2
  )};\n\n  config["proxy-groups"] = generatedProxyGroups;\n  config["rule-providers"] = generatedRuleProviders;\n  config["rules"] = generatedRules;\n\n  return config;\n}\n`;
}

function generateOne(target) {
  const iniText = fs.readFileSync(target.iniPath, "utf8");
  const parsed = parseIni(iniText);
  const proxyGroups = parsed.groups.map(buildProxyGroup);
  const { providers, rules } = buildRulesAndProviders(parsed.rulesets);
  const scriptText = buildScriptContent(target.iniPath, proxyGroups, providers, rules);

  fs.mkdirSync(path.dirname(target.outPath), { recursive: true });
  fs.writeFileSync(target.outPath, scriptText, "utf8");

  return {
    label: target.label,
    ini: path.relative(ROOT, target.iniPath),
    out: path.relative(ROOT, target.outPath),
    groups: proxyGroups.length,
    providers: Object.keys(providers).length,
    rules: rules.length,
  };
}

function main() {
  const targets = collectTargets();
  if (targets.length === 0) {
    console.log("[override] no ini files found under config/");
    return;
  }

  const stats = targets.map(generateOne);
  for (const item of stats) {
    console.log(
      `[override:${item.label}] ${item.ini} -> ${item.out} (groups=${item.groups}, providers=${item.providers}, rules=${item.rules})`
    );
  }
}

main();
