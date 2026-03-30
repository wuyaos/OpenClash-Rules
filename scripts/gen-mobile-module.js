#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INI_PATH = path.join(ROOT, "config", "Mobile_mod_mini.ini");
const OUT_PATH = path.join(ROOT, "clash", "mobile-module.yaml");
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
  ["AI", "Bot.png"],
  ["GPT", "Bot.png"],
  ["GitHub", "GitHub.png"],
  ["微软云盘", "OneDrive.png"],
  ["微软服务", "Microsoft.png"],
  ["国外媒体", "ForeignMedia.png"],
  ["哔哩哔哩", "bilibili.png"],
  ["广告拦截", "AdBlack.png"],
  ["全球直连", "Direct.png"],
  ["Final", "Final.png"],
  ["香港", "Hong_Kong.png"],
  ["**###**", "Taiwan.png"],
  ["中国", "China.png"],
  ["狮城", "Singapore.png"],
  ["日本", "Japan.png"],
  ["美国", "United_States.png"],
  ["其他", "Global.png"],
  ["手动选择", "Available.png"],
];

// Keep mobile rename rules compact: only regions used by current proxy groups.
const CORE_REGION_EMOJIS = new Set(["ℹ", "🇭🇰", "🇹🇼", "🇨🇳", "🇲🇴", "🇸🇬", "🇯🇵", "🇺🇲", "🇺🇸"]);

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
  let addEmoji = false;
  let removeOldEmoji = false;
  const emojiRules = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    if (line.startsWith("add_emoji=")) {
      const value = line.slice("add_emoji=".length).trim().toLowerCase();
      addEmoji = value === "true" || value === "1";
      continue;
    }

    if (line.startsWith("remove_old_emoji=")) {
      const value = line.slice("remove_old_emoji=".length).trim().toLowerCase();
      removeOldEmoji = value === "true" || value === "1";
      continue;
    }

    if (line.startsWith("emoji=")) {
      const body = line.slice("emoji=".length);
      const idx = body.lastIndexOf(",");
      if (idx <= 0) continue;

      const pattern = body.slice(0, idx).trim();
      const emoji = body.slice(idx + 1).trim();
      if (!pattern || !emoji) continue;
      emojiRules.push({ pattern, emoji });
      continue;
    }

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

  return { rulesets, groups, addEmoji, removeOldEmoji, emojiRules };
}

function buildProxyNameOverrides(addEmoji, removeOldEmoji, emojiRules) {
  const rules = [];

  if (removeOldEmoji) {
    rules.push({ pattern: "^[🇦-🇿]{2}\\s*", target: "" });
  }

  if (addEmoji) {
    const pickedEmoji = new Set();
    for (const { pattern, emoji } of emojiRules) {
      if (!CORE_REGION_EMOJIS.has(emoji)) continue;
      if (pickedEmoji.has(emoji)) continue;
      pickedEmoji.add(emoji);
      rules.push({ pattern, target: `${emoji} $0` });
    }
  }

  return rules;
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
  if (uniqueStatic.length > 0) group.proxies = uniqueStatic;

  const filterExpr = regexTokens.join("|");
  const latencyTypes = new Set(["url-test", "fallback", "load-balance"]);
  if (latencyTypes.has(type)) {
    group["include-all"] = true;
    group["include-all-providers"] = true;
    if (filterExpr) group.filter = filterExpr;
    group.url = testUrl || DEFAULT_TEST_URL;
    group.interval = interval;
    group.tolerance = tolerance;
  } else if (filterExpr) {
    // For select groups with explicit static proxies, keep exact INI order.
    // Only use include-all/filter when no static proxies are defined.
    if (uniqueStatic.length === 0) {
      group["include-all"] = true;
      group["include-all-providers"] = true;
      group.filter = filterExpr;
    }
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
        type: "http",
        behavior: "classical",
        format: isClassic ? "yaml" : "text",
        interval: 86400,
        path: `./ruleset/${providerName}.${isClassic ? "yaml" : "list"}`,
        url,
      };
    }

    addRule(`RULE-SET,${providerName},${target}`);
  }

  return { providers, rules };
}

function withDnsHijackRule(rules) {
  const dnsHijackRule = "DST-PORT,53,DNS_Hijack";
  const out = rules.filter((rule) => rule !== dnsHijackRule);
  out.unshift(dnsHijackRule);
  return out;
}

function buildMobileConfig(proxyGroups, providers, rules, proxyNameOverrides) {
  const subscription = {
    type: "http",
    path: "./proxy_provider/subscription.yaml",
    url: "",
    interval: 21600,
    "exclude-filter":
      "(?i)官网|邀请|到期|流量|更新|验证|剩余|频道|长期|推广|分享|周期|我的",
    "health-check": {
      enable: true,
      url: "https://www.gstatic.com/generate_204",
      interval: 1800,
      timeout: 5000,
    },
    header: {
      "User-Agent": ["ClashMetaForAndroid/2.11.2.Meta"],
    },
  };

  subscription.override = {
    "client-fingerprint": "chrome",
  };
  if (proxyNameOverrides.length > 0) {
    subscription.override["proxy-name"] = proxyNameOverrides;
  }

  return {
    "mixed-port": 7890,
    "redir-port": 9797,
    "tproxy-port": 9898,
    ipv6: true,
    mode: "rule",
    "allow-lan": true,
    "unified-delay": true,
    "tcp-concurrent": true,
    "log-level": "silent",
    "bind-address": "*",
    "find-process-mode": "always",
    "external-controller": "0.0.0.0:9090",
    "external-ui": "./dashboard",
    "geo-auto-update": true,
    "geo-update-interval": 24,
    "geodata-mode": true,
    "geox-url": {
      geoip:
        "https://v6.gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat",
      geosite:
        "https://v6.gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat",
      mmdb:
        "https://v6.gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb",
      asn:
        "https://v6.gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb",
    },
    secret: "",
    "proxy-providers": {
      subscription,
    },
    profile: {
      "store-selected": true,
      "store-fake-ip": true,
    },
    ntp: {
      enable: true,
      "write-to-system": true,
      server: "ntp.ntsc.ac.cn",
      port: 123,
      interval: 60,
    },
    sniffer: {
      enable: true,
      "force-dns-mapping": true,
      "parse-pure-ip": true,
      "override-destination": true,
      sniff: {
        HTTP: { ports: [80, "8080-8880"] },
        TLS: { ports: [443, 5228, 8443] },
        QUIC: { ports: [443, 8443] },
      },
      "force-domain": ["+.v2ex.com"],
      "skip-domain": ["Mijia Cloud"],
    },
    tun: {
      enable: true,
      device: "Meta",
      stack: "gvisor",
      "dns-hijack": ["any:53", "tcp://any:53"],
      "udp-timeout": 300,
      "auto-route": true,
      "strict-route": true,
      "auto-redirect": false,
      "auto-detect-interface": true,
      "exclude-package": [],
    },
    dns: {
      enable: true,
      ipv6: true,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "use-hosts": true,
      "use-system-hosts": true,
      "respect-rules": true,
      // Bootstrap resolvers (IP-based), expanded with public CN DNS.
      "default-nameserver": [
        "tls://223.5.5.5",
        "tls://223.6.6.6",
        "tls://119.29.29.29",
        "tls://1.12.12.12",
      ],
      "nameserver": [
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/dns-query",
        "https://dns.quad9.net/dns-query",
        "https://dns.opendns.com/dns-query",
      ],
      "proxy-server-nameserver": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query",
        "https://doh.360.cn/dns-query",
      ],
      "direct-nameserver": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query",
        "https://doh.360.cn/dns-query",
      ],
      "fake-ip-filter-mode": "blacklist",
      "fake-ip-filter": [
        "*.lan",
        "*.local",
        "*.localhost",
        "*.home.arpa",
        "geosite:private",
        "geosite:category-ntp",
      ],
    },
    proxies: [
      { name: "DNS_Hijack", type: "dns" },
      { name: "🇨🇳 本地直连", type: "direct", udp: true },
      { name: "⛔ 拒绝连接", type: "reject" },
    ],
    "proxy-groups": proxyGroups,
    "rule-providers": providers,
    rules,
  };
}

function formatKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function formatScalar(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

function toYaml(value, indent = 0) {
  const sp = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${sp}[]`;
    return value
      .map((item) => {
        const isComplex = item && typeof item === "object";
        if (!isComplex) return `${sp}- ${formatScalar(item)}`;
        return `${sp}-\n${toYaml(item, indent + 1)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${sp}{}`;
    const lines = [];
    for (const [key, val] of entries) {
      const renderedKey = formatKey(key);
      const isComplex = val && typeof val === "object";
      if (!isComplex) {
        lines.push(`${sp}${renderedKey}: ${formatScalar(val)}`);
      } else if (Array.isArray(val) && val.length === 0) {
        lines.push(`${sp}${renderedKey}: []`);
      } else {
        lines.push(`${sp}${renderedKey}:`);
        lines.push(toYaml(val, indent + 1));
      }
    }
    return lines.join("\n");
  }

  return `${sp}${formatScalar(value)}`;
}

function main() {
  const iniText = fs.readFileSync(INI_PATH, "utf8");
  const parsed = parseIni(iniText);
  const proxyGroups = parsed.groups.map(buildProxyGroup);
  const { providers, rules } = buildRulesAndProviders(parsed.rulesets);
  const finalRules = withDnsHijackRule(rules);
  const proxyNameOverrides = buildProxyNameOverrides(parsed.addEmoji, parsed.removeOldEmoji, parsed.emojiRules);
  const config = buildMobileConfig(proxyGroups, providers, finalRules, proxyNameOverrides);

  const header = [
    "# Auto-generated mobile module config",
    `# Source INI: ${path.relative(ROOT, INI_PATH)}`,
    "# Generated by: scripts/gen-mobile-module.js",
    "# 订阅地址请填写 proxy-providers.subscription.url",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${header}${toYaml(config)}\n`, "utf8");

  console.log(
    `[mobile] ${path.relative(ROOT, INI_PATH)} -> ${path.relative(ROOT, OUT_PATH)} ` +
      `(groups=${proxyGroups.length}, providers=${Object.keys(providers).length}, rules=${rules.length})`
  );
}

main();
