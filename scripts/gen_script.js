#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(ROOT, "config");
const CLASH_BASE_YAML = path.join(ROOT, "clash", "config.yaml");
const OUTPUT_DIR = path.join(ROOT, "scripts");
const DEFAULT_TEST_URL = "https://cp.cloudflare.com/generate_204";
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
      substoreOutPath: path.join(OUTPUT_DIR, `substore_${base}.js`),
      unifiedOutPath: path.join(OUTPUT_DIR, `unified_${base}.js`),
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
  const nodeOps = { excludeRemarks: "", addEmoji: true, removeOldEmoji: false, emojiRules: [] };

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
      continue;
    }

    if (line.startsWith("exclude_remarks=")) {
      nodeOps.excludeRemarks = line.slice("exclude_remarks=".length).trim();
      continue;
    }

    if (line.startsWith("add_emoji=")) {
      nodeOps.addEmoji = line.slice("add_emoji=".length).trim().toLowerCase() !== "false";
      continue;
    }

    if (line.startsWith("remove_old_emoji=")) {
      nodeOps.removeOldEmoji = line.slice("remove_old_emoji=".length).trim().toLowerCase() === "true";
      continue;
    }

    if (line.startsWith("emoji=")) {
      const body = line.slice("emoji=".length);
      // 规则体自身不含逗号, 末段为国旗 emoji, 按最后一个逗号切分
      const idx = body.lastIndexOf(",");
      if (idx <= 0 || idx === body.length - 1) continue;

      const pattern = body.slice(0, idx);
      const flag = body.slice(idx + 1).trim();
      if (pattern && flag) nodeOps.emojiRules.push({ pattern, flag });
    }
  }

  return { rulesets, groups, nodeOps };
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
    group.lazy = true;
    group.timeout = 5000;
    group["max-failed-times"] = 2;
    group["expected-status"] = 204;
  } else if (filterExpr) {
    group["include-all"] = true;
    group.filter = filterExpr;
  }

  return group;
}

function buildRulesAndProviders(rulesets, proxyGroups) {
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

  // respect-rules 下，海外 DoH 必须显式走代理；规则放在 provider 规则之前，
  // 使首次启动和规则集尚未加载时也不会回落到 Final兜底(DIRECT)。
  const dnsProxyTarget = proxyGroups.find((group) => /节点选择/.test(group.name))?.name;
  if (dnsProxyTarget) {
    addRule(`IP-CIDR,1.1.1.1/32,${dnsProxyTarget},no-resolve`);
    addRule(`DOMAIN,doh.dns.sb,${dnsProxyTarget}`);
  }

  for (const { target, source } of rulesets) {
    if (source.startsWith("[]")) {
      const builtin = source.slice(2).trim();
      if (!builtin) continue;

      if (/^FINAL$/i.test(builtin)) {
        addRule(`MATCH,${target}`);
      } else if (/^(GEOIP|IP-CIDR|IP-ASN|SRC-IP-CIDR)/i.test(builtin)) {
        // IP 类规则加 no-resolve: 避免 GEOIP 匹配时先解析域名(powerfullz 同款实践),
        // 减少 DNS 延迟与解析记录泄露。
        addRule(`${builtin},${target},no-resolve`);
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

    addRule(`RULE-SET,${providerName},${target},no-resolve`);
  }

  return { providers, rules };
}

// 解析 clash/config.yaml 的键值结构(缩进块), 仅用于生成器内提取字段, 不依赖外部 yaml 库。
// 返回 [key, 原始文本块(含子行)] 列表, 保持文件顺序。
function parseYamlTopLevel(yamlText) {
  const lines = yamlText.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let current = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    if (/^\S/.test(rawLine)) {
      if (current) blocks.push(current);
      const idx = rawLine.indexOf(":");
      if (idx < 0) { current = null; continue; }
      current = { key: rawLine.slice(0, idx).trim(), lines: [rawLine] };
    } else if (current) {
      current.lines.push(rawLine);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

// 去行内注释并化简 YAML 标量为 JS 值(字符串/数字/布尔), 块字段交给 main 里 YAML.parse。
// 为避免引入 yaml 解析依赖, 生成脚本运行时优先用环境自带的 yaml 工具(ProxyUtils.yaml),
// 不可用时退化为纯文本透传(拼回 YAML 文本再让内核解析)。
const GROUP_NAME_TOOLS = `
function getScriptArguments() {
  try {
    return typeof $arguments !== "undefined" ? $arguments || {} : {};
  } catch (_e) {
    return {};
  }
}

function parseBoolean(value, defaultValue) {
  if (value == null || value === "") return defaultValue;
  return value === true || value === 1 || String(value).toLowerCase() === "true" || value === "1";
}

function normalizeGroupName(name) {
  const flagNames = {
    "🇭🇰": "香港",
    "🇹🇼": "台湾",
    "🇨🇳": "中国",
    "🇲🇴": "澳门",
    "🇸🇬": "狮城",
    "🇯🇵": "日本",
    "🇺🇸": "美国",
    "🇺🇲": "美国",
  };
  let text = String(name).replace(
    /^(?:[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\uFE0F\\u200D]|\\s|ᯅ)+/gu,
    ""
  );
  for (const [flag, label] of Object.entries(flagNames)) text = text.split(flag).join(label);
  text = text.replace(/no\\s*日本/gi, "非日本");
  return text
    .replace(/[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\uFE0F\\u200D]/gu, "")
    .replace(/\\s+/g, " ")
    .trim();
}

function applyGroupNameMode(groups, rules, keepEmoji) {
  if (keepEmoji) return;
  const nameMap = new Map();
  const used = new Set();

  for (const group of groups) {
    const base = normalizeGroupName(group.name) || group.name;
    let next = base;
    let suffix = 2;
    while (used.has(next)) next = base + "-" + suffix++;
    used.add(next);
    nameMap.set(group.name, next);
  }

  for (const group of groups) {
    group.name = nameMap.get(group.name) || group.name;
    if (Array.isArray(group.proxies)) {
      group.proxies = group.proxies.map((name) => nameMap.get(name) || name);
    }
    if (nameMap.has(group["default-selected"])) {
      group["default-selected"] = nameMap.get(group["default-selected"]);
    }
  }

  for (let i = 0; i < rules.length; i++) {
    const parts = String(rules[i]).split(",");
    let targetIndex = parts.length - 1;
    if (parts[targetIndex] === "no-resolve") targetIndex--;
    if (nameMap.has(parts[targetIndex])) parts[targetIndex] = nameMap.get(parts[targetIndex]);
    rules[i] = parts.join(",");
  }
}
`;

function buildScriptContent(iniPath, proxyGroups, providers, rules, baseYaml, includeNodeOps) {
  const banner = [
    "/*",
    ` * Auto-generated from ${path.relative(ROOT, iniPath)}`,
    " * Generated by scripts/gen_script.js",
    " *",
    " * 用法 A (Clash Verge/FlClash 等客户端): 粘贴到订阅的「编辑脚本/覆写」。",
    " * 用法 B (Sub-Store 文件管理): 新建 Mihomo 配置, 来源选订阅, 脚本操作填本文件,",
    " *   流量信息请在文件编辑页「订阅信息」(subInfoUrl) 填上游订阅链接。",
    " * 参数: groupemoji=true 保留原始 emoji 组名; 默认去掉组名 emoji, icon 字段保留。",
    " */",
  ].join("\n");

  const baseDecl = baseYaml
    ? `const BASE_YAML_TEXT = ${JSON.stringify(baseYaml)};\nconst baseConfig = (() => {\n  try {\n    const yaml = (typeof ProxyUtils !== "undefined" && ProxyUtils.yaml)\n      ? ProxyUtils.yaml.safeLoad(BASE_YAML_TEXT)\n      : (typeof yaml !== "undefined" && yaml) ? yaml.safeLoad(BASE_YAML_TEXT) : null;\n    return yaml || {};\n  } catch (_e) {\n    return {};\n  }\n})();\n`
    : "";

  // unified 模式: main 内也做节点级处理(过滤信息伪节点 + 补国旗)。
  // 与订阅侧 operator 同源逻辑, 幂等: 已带国旗的节点不会被重复加(emoji 规则自带防重)。
  const nodeBlock = includeNodeOps
    ? `\n  // 节点级处理(幂等): 过滤信息伪节点 + 补国旗, 与订阅侧 operator 同源\n  if (Array.isArray(config.proxies)) {\n    config.proxies = EXCLUDE_REMARKS\n      ? config.proxies.filter((proxy) => !EXCLUDE_REMARKS.test(proxy.name))\n      : config.proxies;\n    for (const proxy of config.proxies) {\n      for (const [pattern, flag] of EMOJI_RULES) {\n        if (pattern.test(proxy.name)) {\n          proxy.name = \`\${flag} \${proxy.name}\`;\n          break;\n        }\n      }\n    }\n  }\n`
    : "";

  // 键序重排: base 基础键在前(保持 config 已有值优先的合并语义), 其余 config 键, 最后依次 节点/分组/规则, 符合 clash 配置阅读惯例。
  const orderBlock = `\n  const ordered = {};\n  for (const [key, value] of Object.entries(baseConfig)) {\n    if (["proxies", "proxy-groups", "rule-providers", "rules"].includes(key)) continue;\n    ordered[key] = config[key] != null ? config[key] : value;\n  }\n  for (const [key, value] of Object.entries(config)) {\n    if (["proxies", "proxy-groups", "rule-providers", "rules"].includes(key)) continue;\n    if (key in ordered) continue;\n    ordered[key] = value;\n  }\n  ordered["proxies"] = config.proxies;\n  ordered["proxy-groups"] = generatedProxyGroups;\n  ordered["rule-providers"] = generatedRuleProviders;\n  ordered["rules"] = generatedRules;\n  return ordered;\n`;

  return `${banner}\n${baseDecl}${GROUP_NAME_TOOLS}\nfunction main(config) {\n  const generatedProxyGroups = ${JSON.stringify(
    proxyGroups,
    null,
    2
  )};\n  const generatedRuleProviders = ${JSON.stringify(providers, null, 2)};\n  const generatedRules = ${JSON.stringify(
    rules,
    null,
    2
  )};\n  const ARGS = getScriptArguments();\n  const KEEP_GROUP_EMOJI = parseBoolean(ARGS.groupemoji, false);\n  applyGroupNameMode(generatedProxyGroups, generatedRules, KEEP_GROUP_EMOJI);\n${nodeBlock}
  // 空分组剔除(可选优化, 默认关闭): 分组内实际节点数 < MIN_GROUP_NODES 时隐藏该组,
  // 并同步清理其他分组对该组的引用, 避免 mihomo 报 proxy not found。
  // 注意: 需在节点已加国旗后统计(地区组 filter 依赖国旗), unified 模式已保证。
  const MIN_GROUP_NODES = 0;
  if (MIN_GROUP_NODES > 0 && Array.isArray(config.proxies)) {
    const weak = new Set();
    const weakFilters = [];
    for (const g of generatedProxyGroups) {
      if (!g.filter || g["include-all"] !== true || !/自动$/.test(g.name)) continue;
      try {
        const jsFilter = g.filter.split("[🇦-🇿]").join("[\\u{1F1E6}-\\u{1F1FF}]");
        const re = new RegExp(jsFilter, "u");
        const n = config.proxies.filter((p) => re.test(p.name || "")).length;
        if (n < MIN_GROUP_NODES) {
          weak.add(g.name);
          weakFilters.push(g.filter);
        }
      } catch (_e) {
        // filter 含 JS 无法编译的 mihomo 方言时跳过该组统计
      }
    }
    if (weak.size > 0) {
      const other = generatedProxyGroups.find((g) => /其他$/.test(g.name));
      if (other && weakFilters.length > 0) {
        other["include-all"] = true;
        other.filter = [other.filter, ...weakFilters]
          .filter(Boolean)
          .map((filter) => "(?:" + filter + ")")
          .join("|");
      }
      for (const g of generatedProxyGroups) {
        if (Array.isArray(g.proxies)) g.proxies = g.proxies.filter((name) => !weak.has(name));
      }
      for (let i = generatedProxyGroups.length - 1; i >= 0; i--) {
        if (weak.has(generatedProxyGroups[i].name)) generatedProxyGroups.splice(i, 1);
      }
    }
  }
\n  config[\"proxy-groups\"] = generatedProxyGroups;\n  config[\"rule-providers\"] = generatedRuleProviders;\n  config[\"rules\"] = generatedRules;\n\n${orderBlock}\n}\n`;
}

// subconverter 的 [🇦-🇿]{2} 表示一个完整国旗(连续两个 Regional Indicator);
// JS 正则需在 u 模式下改写为码点区间才是等义语义。
const FLAG_CLASS = "[🇦-🇿]";

// PCRE 的 (?i:...) 作用域大小写修饰符需要极新 JS 引擎(Node>=23),
// 主流 Sub-Store 后端(Node 20/22)会 SyntaxError;
// 已验证本仓库规则作用域外不含大小写敏感构造, 改写为全局 i 标志语义等价。
// lookbehind(?<!...) 在 Node>=9 / Safari>=16.4 均已支持, 保留原样。
function toSubstoreRegexSpec(pattern) {
  let src = pattern.split(FLAG_CLASS).join("[\\u{1F1E6}-\\u{1F1FF}]");
  let caseInsensitive = false;

  if (src.includes("(?i:")) {
    src = src.split("(?i:").join("(?:");
    caseInsensitive = true;
  }
  if (src.includes("(?i)")) {
    src = src.split("(?i)").join("");
    caseInsensitive = true;
  }

  return [src, caseInsensitive];
}

function buildSubstoreScriptContent(iniPath, nodeOps) {
  const banner = [
    "/*",
    ` * Auto-generated from ${path.relative(ROOT, iniPath)}`,
    " * Generated by scripts/gen_script.js",
    " *",
    " * Sub-Store 节点处理脚本(仅声明 operator):",
    " *   - 挂在订阅的脚本操作: exclude_remarks 过滤 + emoji 国旗(rename)",
    " *   - 不生成分组/规则/base; 完整配置请使用 unified_*.js 或 unified_all.js。",
    " * 用法: Sub-Store 订阅/组合订阅 -> 操作 -> 脚本操作, 填本文件链接或粘贴内容。",
    " * 兼容性: 规则含 lookbehind, 需 Node>=9 或 Safari>=16.4; PCRE (?i:) 已改写为 i 标志。",
    " */",
  ].join("\n");

  const [excludeSrc, excludeCI] = toSubstoreRegexSpec(nodeOps.excludeRemarks);
  const emojiEntries = nodeOps.addEmoji
    ? nodeOps.emojiRules.map((rule) => {
        const [src, ci] = toSubstoreRegexSpec(rule.pattern);
        return [src, ci ? "iu" : "u", rule.flag];
      })
    : [];

  const excludeDecl = excludeSrc
    ? `const EXCLUDE_REMARKS = new RegExp(${JSON.stringify(excludeSrc)}, ${JSON.stringify(excludeCI ? "i" : "")});`
    : "const EXCLUDE_REMARKS = null; // ini 未配置 exclude_remarks";
  const emojiDecl = emojiEntries.length
    ? `const EMOJI_RULES = ${JSON.stringify(emojiEntries, null, 2)}.map(([pattern, flags, flag]) => [\n  new RegExp(pattern, flags),\n  flag,\n]);`
    : "const EMOJI_RULES = []; // ini 未启用 add_emoji";

  return `${banner}\n${excludeDecl}\n${emojiDecl}\n\nfunction operator(proxies = [], targetPlatform, context) {\n  const kept = EXCLUDE_REMARKS ? proxies.filter((proxy) => !EXCLUDE_REMARKS.test(proxy.name)) : proxies;\n\n  for (const proxy of kept) {\n    for (const [pattern, flag] of EMOJI_RULES) {\n      if (pattern.test(proxy.name)) {\n        proxy.name = \`\${flag} \${proxy.name}\`;\n        break;\n      }\n    }\n  }\n\n  return kept;\n}\n`;
}

// 单文件全功能版: operator(节点级) + main(配置级) + base 配置, 供“只想维护一个脚本”的场景。
function buildUnifiedScriptContent(iniPath, nodeOps, proxyGroups, providers, rules, baseYaml) {
  const overridePart = buildScriptContent(iniPath, proxyGroups, providers, rules, baseYaml, true)
    .replace(/^[\s\S]*?\n(?=const BASE_YAML_TEXT|function getScriptArguments|function main)/, "") // 去 banner
    .replace(/\* 用法 A[\s\S]*?\*\/\n/, "") // 去旧用法注释块
    .replace(/\n$/, "");
  const nodePart = buildSubstoreScriptContent(iniPath, nodeOps)
    .replace(/^[\s\S]*?\n(?=const EXCLUDE_REMARKS)/, "") // 去 banner
    .replace(/\n$/, "");

  const banner = [
    "/*",
    ` * Auto-generated from ${path.relative(ROOT, iniPath)}`,
    " * Generated by scripts/gen_script.js",
    " *",
    " * 单文件全功能脚本(同时声明 operator 与 main):",
    " *   - 挂在订阅的脚本操作: 执行 operator, 节点级处理(exclude_remarks 过滤 + emoji 国旗)",
    " *   - 挂在文件(Mihomo 配置)的脚本操作: 执行 main, 配置级处理(分组/规则/base)",
    " *   - 两处均可填同一份本文件; 后端按挂载位置自动选择入口。",
    " *   - Verge/FlClash 覆写场景: 仅 main 生效(operator 被忽略), 行为同 override 版。",
    " * 兼容性: 规则含 lookbehind, 需 Node>=9 或 Safari>=16.4; PCRE (?i:) 已改写为 i 标志。",
    " */",
  ].join("\n");

  return `${banner}\n// ===== 节点级: operator =====\n${nodePart}\n\n// ===== 配置级: main =====\n${overridePart}\n`;
}


// 参数化合并版: 多个 ini 的分组/规则打包为 PROFILES, 通过 #profile=... 切换;
// ipv6/full 对齐 powerfullz 参数语义。operator(节点级) 仅一份 —— 各 ini 节点处理逻辑已验证一致。
function buildUnifiedAllScriptContent(nodeOps, profileList, baseYaml) {
  const banner = [
    "/*",
    " * Auto-generated from config/*.ini (merged)",
    " * Generated by scripts/gen_script.js",
    " *",
    " * 参数化单文件脚本(operator + main 双入口):",
    " *   订阅挂载 -> operator(节点级: 过滤信息节点 + 加国旗)",
    " *   文件(Mihomo 配置)/Verge 覆写 -> main(配置级: 分组/规则/base)",
    " *",
    " * 链接 # 参数(Sub-Store 脚本操作链接追加, 如 ...#profile=router&ipv6=true):",
    " *   profile: acl4ssr(默认) | router —— 选择 ini 方案",
    " *   ipv6:     true | false(默认) —— 启用 IPv6(顶层 ipv6 + dns.ipv6)",
    " *   full:     true(默认) | false —— true 输出完整配置(合并 base), false 仅输出节点/分组/规则",
    " *   threshold:  非负整数(默认 0) —— filter 分组命中节点数低于该值时隐藏分组并清理引用",
    " *   groupemoji: true | false(默认) —— true 保留原始 emoji 组名; false 组名去 emoji、保留 icon",
    " */",
  ].join("\n");

  const baseDecl = baseYaml
    ? `const BASE_YAML_TEXT = ${JSON.stringify(baseYaml)};
const baseConfig = (() => {
  try {
    const yaml = (typeof ProxyUtils !== "undefined" && ProxyUtils.yaml)
      ? ProxyUtils.yaml.safeLoad(BASE_YAML_TEXT)
      : (typeof yaml !== "undefined" && yaml) ? yaml.safeLoad(BASE_YAML_TEXT) : null;
    return yaml || {};
  } catch (_e) {
    return {};
  }
})();
`
    : "";

  // profiles 数据: key(短名) -> {proxy-groups, rule-providers, rules}
  const profileMap = {};
  const aliasMap = {};
  for (const prof of profileList) {
    profileMap[prof.key] = {
      "proxy-groups": prof.groups,
      "rule-providers": prof.providers,
      rules: prof.rules,
    };
    aliasMap[prof.label.toLowerCase()] = prof.key;
  }
  const firstKey = profileList[0].key;

  // 节点级声明(与 buildSubstoreScriptContent 同源)
  const [excludeSrc, excludeCI] = toSubstoreRegexSpec(nodeOps.excludeRemarks);
  const emojiEntries = nodeOps.addEmoji
    ? nodeOps.emojiRules.map((rule) => {
        const [src, ci] = toSubstoreRegexSpec(rule.pattern);
        return [src, ci ? "iu" : "u", rule.flag];
      })
    : [];
  const excludeDecl = excludeSrc
    ? `const EXCLUDE_REMARKS = new RegExp(${JSON.stringify(excludeSrc)}, ${JSON.stringify(excludeCI ? "i" : "")});`
    : "const EXCLUDE_REMARKS = null;";
  const emojiDecl = emojiEntries.length
    ? `const EMOJI_RULES = ${JSON.stringify(emojiEntries, null, 2)}.map(([pattern, flags, flag]) => [
  new RegExp(pattern, flags),
  flag,
]);`
    : "const EMOJI_RULES = [];";

  const body = `${banner}
${excludeDecl}
${emojiDecl}

const PROFILES = ${JSON.stringify(profileMap, null, 2)};

// 节点级处理: 过滤信息伪节点 + 补国旗(幂等, 规则自带防重)
function operator(proxies = [], targetPlatform, context) {
  const kept = EXCLUDE_REMARKS ? proxies.filter((proxy) => !EXCLUDE_REMARKS.test(proxy.name)) : proxies;

  for (const proxy of kept) {
    for (const [pattern, flag] of EMOJI_RULES) {
      if (pattern.test(proxy.name)) {
        proxy.name = \`\${flag} \${proxy.name}\`;
        break;
      }
    }
  }

  return kept;
}

${baseDecl}
${GROUP_NAME_TOOLS}
function main(config) {
  // ===== 参数解析 =====
  const ARGS = getScriptArguments();
  const argInt = (v, def) => {
    if (v == null || v === "") return def;
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };
  const PROFILE_ALIASES = ${JSON.stringify(aliasMap)};
  const profileKey = (() => {
    const want = String(ARGS.profile || ARGS.name || "").trim().toLowerCase();
    if (PROFILES[want]) return want;
    if (PROFILE_ALIASES[want]) return PROFILE_ALIASES[want];
    return ${JSON.stringify(firstKey)};
  })();
  const FULL = parseBoolean(ARGS.full, true);
  const IPV6 = parseBoolean(ARGS.ipv6, false);
  const MIN_GROUP_NODES = argInt(ARGS.threshold, 0);
  const KEEP_GROUP_EMOJI = parseBoolean(ARGS.groupemoji, false);

  // main 可能在同一脚本实例中多次调用; 深拷贝避免 threshold/ipv6 修改常量数据。
  const selectedProfile = JSON.parse(JSON.stringify(PROFILES[profileKey]));
  const runtimeBase = JSON.parse(JSON.stringify(baseConfig));
  const generatedProxyGroups = selectedProfile["proxy-groups"];
  const generatedRuleProviders = selectedProfile["rule-providers"];
  const generatedRules = selectedProfile.rules;
  applyGroupNameMode(generatedProxyGroups, generatedRules, KEEP_GROUP_EMOJI);

  // 节点级处理(幂等): 过滤信息伪节点 + 补国旗, 与 operator 同源
  if (Array.isArray(config.proxies)) {
    config.proxies = EXCLUDE_REMARKS
      ? config.proxies.filter((proxy) => !EXCLUDE_REMARKS.test(proxy.name))
      : config.proxies;
    for (const proxy of config.proxies) {
      for (const [pattern, flag] of EMOJI_RULES) {
        if (pattern.test(proxy.name)) {
          proxy.name = \`\${flag} \${proxy.name}\`;
          break;
        }
      }
    }
  }

  // 空分组剔除: 仅统计名称以“自动”结尾的国家/地区组; 低于 threshold 时隐藏并清理引用
  if (MIN_GROUP_NODES > 0 && Array.isArray(config.proxies)) {
    const weak = new Set();
    const weakFilters = [];
    for (const g of generatedProxyGroups) {
      if (!g.filter || g["include-all"] !== true || !/自动$/.test(g.name)) continue;
      try {
        const jsFilter = g.filter.split("[🇦-🇿]").join("[\\u{1F1E6}-\\u{1F1FF}]");
        const re = new RegExp(jsFilter, "u");
        const n = config.proxies.filter((p) => re.test(p.name || "")).length;
        if (n < MIN_GROUP_NODES) {
          weak.add(g.name);
          weakFilters.push(g.filter);
        }
      } catch (_e) {
        // filter 含 JS 无法编译的 mihomo 方言时跳过该组统计
      }
    }
    if (weak.size > 0) {
      const other = generatedProxyGroups.find((g) => /其他$/.test(g.name));
      if (other && weakFilters.length > 0) {
        other["include-all"] = true;
        other.filter = [other.filter, ...weakFilters]
          .filter(Boolean)
          .map((filter) => "(?:" + filter + ")")
          .join("|");
      }
      for (const g of generatedProxyGroups) {
        if (Array.isArray(g.proxies)) g.proxies = g.proxies.filter((name) => !weak.has(name));
      }
      for (let i = generatedProxyGroups.length - 1; i >= 0; i--) {
        if (weak.has(generatedProxyGroups[i].name)) generatedProxyGroups.splice(i, 1);
      }
    }
  }

  // 键序重排: base 基础键在前(FULL 时), 其余 config 键, 最后 节点/分组/规则
  const ordered = {};
  if (FULL) {
    for (const [key, value] of Object.entries(runtimeBase)) {
      if (["proxies", "proxy-groups", "rule-providers", "rules"].includes(key)) continue;
      ordered[key] = config[key] != null ? config[key] : value;
    }
  }
  for (const [key, value] of Object.entries(config)) {
    if (["proxies", "proxy-groups", "rule-providers", "rules"].includes(key)) continue;
    if (key in ordered) continue;
    ordered[key] = value;
  }
  ordered["proxies"] = config.proxies;
  ordered["proxy-groups"] = generatedProxyGroups;
  ordered["rule-providers"] = generatedRuleProviders;
  ordered["rules"] = generatedRules;

  if (IPV6) {
    ordered["ipv6"] = true;
    if (ordered.dns && typeof ordered.dns === "object") ordered.dns.ipv6 = true;
  }

  return ordered;
}
`;
  return body;
}

function generateOne(target) {
  const iniText = fs.readFileSync(target.iniPath, "utf8");
  const parsed = parseIni(iniText);
  const proxyGroups = parsed.groups.map(buildProxyGroup);
  const { providers, rules } = buildRulesAndProviders(parsed.rulesets, proxyGroups);

  // 与 ini 的 clash_rule_base 对应: 将 clash/config.yaml 作为 base 并入 override 脚本。
  // ini 中指向本仓库 raw 链接的 clash_rule_base 均为同一路径, 直接读本地文件。
  let baseYaml = "";
  if (/^clash_rule_base=/m.test(iniText)) {
    if (fs.existsSync(CLASH_BASE_YAML)) {
      baseYaml = fs.readFileSync(CLASH_BASE_YAML, "utf8");
    } else {
      console.warn(`[override:${target.label}] clash_rule_base 已配置但 ${CLASH_BASE_YAML} 不存在, 忽略 base 合并`);
    }
  }
  const scriptText = buildScriptContent(target.iniPath, proxyGroups, providers, rules, baseYaml);

  fs.mkdirSync(path.dirname(target.outPath), { recursive: true });
  fs.writeFileSync(target.outPath, scriptText, "utf8");

  if (parsed.nodeOps.removeOldEmoji) {
    console.warn(
      `[substore:${target.label}] remove_old_emoji=true 暂不支持, 生成脚本将保留节点原有国旗`
    );
  }
  const substoreText = buildSubstoreScriptContent(target.iniPath, parsed.nodeOps);
  fs.writeFileSync(target.substoreOutPath, substoreText, "utf8");

  const unifiedText = buildUnifiedScriptContent(target.iniPath, parsed.nodeOps, proxyGroups, providers, rules, baseYaml);
  fs.writeFileSync(target.unifiedOutPath, unifiedText, "utf8");

  return {
    label: target.label,
    ini: path.relative(ROOT, target.iniPath),
    out: path.relative(ROOT, target.outPath),
    substoreOut: path.relative(ROOT, target.substoreOutPath),
    unifiedOut: path.relative(ROOT, target.unifiedOutPath),
    groups: proxyGroups.length,
    providers: Object.keys(providers).length,
    rules: rules.length,
    emojiRules: parsed.nodeOps.addEmoji ? parsed.nodeOps.emojiRules.length : 0,
    exclude: parsed.nodeOps.excludeRemarks ? "yes" : "no",
    profileData: {
      key: target.label.toLowerCase().replace(/_mod_mini$/i, ""),
      label: target.label,
      nodeOps: parsed.nodeOps,
      groups: proxyGroups,
      providers,
      rules,
      baseYaml,
    },
  };
}

function cleanupOrphanScripts(targets) {
  const expected = new Set([
    ...targets.map((item) => path.basename(item.outPath)),
    ...targets.map((item) => path.basename(item.substoreOutPath)),
    ...targets.map((item) => path.basename(item.unifiedOutPath)),
    "unified_all.js",
  ]);
  const names = fs
    .readdirSync(OUTPUT_DIR)
    .filter((name) => /^(override|substore|unified)_.*\.js$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const removed = [];
  for (const name of names) {
    if (expected.has(name)) continue;
    const fullPath = path.join(OUTPUT_DIR, name);
    fs.unlinkSync(fullPath);
    removed.push(path.relative(ROOT, fullPath));
  }
  return removed;
}

function main() {
  const targets = collectTargets();
  if (targets.length === 0) {
    console.log("[override] no ini files found under config/");
    return;
  }

  const stats = targets.map(generateOne);

  // 合并所有 ini 为一份参数化脚本: #profile=<key>&ipv6=true&full=true
  const firstProfile = stats[0]?.profileData;
  if (firstProfile) {
    const unifiedAllOut = path.join(OUTPUT_DIR, "unified_all.js");
    const unifiedAllText = buildUnifiedAllScriptContent(
      firstProfile.nodeOps,
      stats.map((item) => item.profileData),
      firstProfile.baseYaml
    );
    fs.writeFileSync(unifiedAllOut, unifiedAllText, "utf8");
    console.log(
      `[unified:all] config/*.ini -> ${path.relative(ROOT, unifiedAllOut)} (profiles=${stats
        .map((item) => item.profileData.key)
        .join(",")})`
    );
  }

  for (const item of stats) {
    console.log(
      `[override:${item.label}] ${item.ini} -> ${item.out} (groups=${item.groups}, providers=${item.providers}, rules=${item.rules})`
    );
    console.log(
      `[substore:${item.label}] ${item.ini} -> ${item.substoreOut} (exclude=${item.exclude}, emojiRules=${item.emojiRules})`
    );
    console.log(
      `[unified:${item.label}] ${item.ini} -> ${item.unifiedOut} (operator+main, groups=${item.groups}, rules=${item.rules})`
    );
  }

  const removed = cleanupOrphanScripts(targets);
  for (const file of removed) {
    console.log(`[override:cleanup] removed orphan ${file}`);
  }
}

main();
