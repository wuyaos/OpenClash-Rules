#!/usr/bin/env node
// 本地或 CI 运行：读取 config/*.ini 与 clash/config.yaml，生成 scripts/unified.js。
// 客户端使用生成的 unified.js，不直接运行此文件。

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(ROOT, "config");
const CLASH_BASE_YAML = path.join(ROOT, "clash", "config.yaml");
const OUTPUT_DIR = path.join(ROOT, "scripts");
const DEFAULT_TEST_URL = "https://connectivitycheck.platform.hicloud.com/generate_204";
const ICON_BASE = "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/";

const ICON_RULES = [
  ["节点选择", "Proxy.png"],
  ["自动选择", "Auto.png"],
  ["故障转移", "Available.png"],
  ["负载均衡", "Speedtest.png"],
  ["回家", "Home.png"],
  ["电报", "Telegram.png"],
  ["谷歌", "Google_Search.png"],
  ["GPT", "ChatGPT.png"],
  ["AI", "AI.png"],
  ["PT", "Download.png"],
  ["刮削🇯🇵", "Japan.png"],
  ["刮削", "Media.png"],
  ["GitHub", "GitHub.png"],
  ["开发", "GitHub.png"],
  ["微软云盘", "OneDrive.png"],
  ["微软服务", "Microsoft.png"],
  ["国外媒体", "ForeignMedia.png"],
  ["哔哩哔哩", "bilibili.png"],
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
  ["Global", "Global.png"],
  ["GLOBAL", "Global.png"],
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
  return `${ICON_BASE}Global.png`;
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
    group.timeout = 10000;
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

  // respect-rules 下海外 DoH 显式走代理；广告拦截之后、其他规则之前插入，
  // 避免上游规则集尚未加载时回落到 Final兜底(DIRECT)。
  const dnsProxyTarget = proxyGroups.find((group) => /节点选择/.test(group.name))?.name;
  let dnsRulesAdded = false;
  const addDnsRules = () => {
    if (dnsRulesAdded) return;
    dnsRulesAdded = true;
    if (dnsProxyTarget) {
      addRule(`IP-CIDR,1.1.1.1/32,${dnsProxyTarget},no-resolve`);
      addRule(`DOMAIN,doh.dns.sb,${dnsProxyTarget}`);
    }
  };

  for (const { target, source } of rulesets) {
    if (!/广告拦截/.test(target)) addDnsRules();
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
  addDnsRules();

  return { providers, rules };
}

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

function buildBaseConfigDeclaration(baseYaml) {
  if (!baseYaml) return "";
  return `const BASE_YAML_TEXT = ${JSON.stringify(baseYaml)};
const baseConfig = (() => {
  try {
    const parser = (typeof ProxyUtils !== "undefined" && ProxyUtils.yaml)
      ? ProxyUtils.yaml
      : (typeof YAML !== "undefined" && YAML)
        ? YAML
        : (typeof globalThis !== "undefined" && globalThis.yaml)
          ? globalThis.yaml
          : null;
    if (!parser) throw new Error("YAML parser unavailable");
    const parsed = typeof parser.parse === "function"
      ? parser.parse(BASE_YAML_TEXT)
      : typeof parser.safeLoad === "function"
        ? parser.safeLoad(BASE_YAML_TEXT)
        : typeof parser.load === "function"
          ? parser.load(BASE_YAML_TEXT)
          : null;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid base YAML result");
    return parsed;
  } catch (error) {
    if (typeof console !== "undefined" && console.error) {
      console.error("[OpenClash-Rules] base YAML parse failed:", error);
    }
    return {};
  }
})();
`;
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



// 参数化合并版: 多个 ini 的分组/规则打包为 PROFILES, 通过 #profile=... 切换;
// ipv6/full 对齐 powerfullz 参数语义。operator(节点级) 仅一份 —— 各 ini 节点处理逻辑已验证一致。
function buildUnifiedScriptContent(nodeOps, profileList, baseYaml) {
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
    " *   profile: general(默认) | router | app-proxy —— 选择 ini 方案",
    " *   ipv6:     true | false(默认) —— 启用 IPv6(顶层 ipv6 + dns.ipv6)",
    " *   full:     true(默认) | false —— true 输出完整配置(合并 base), false 仅输出节点/分组/规则",
    " *   threshold:  非负整数(默认 0) —— filter 分组命中节点数低于该值时隐藏分组并清理引用",
    " *   groupemoji: true(默认) | false —— true 保留原始 emoji 组名; false 组名去 emoji、保留 icon",
    " */",
  ].join("\n");

  const baseDecl = buildBaseConfigDeclaration(baseYaml);

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
  // 旧配置名称保留为兼容别名，不再生成独立 profile。
  if (profileMap.general) {
    aliasMap.acl4ssr = "general";
    aliasMap.acl4ssr_mod_mini = "general";
  }
  if (profileMap.router) aliasMap.router_mod_mini = "router";
  const firstKey = profileMap.general ? "general" : profileList[0].key;

  // 节点级声明
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
  const HAS_IPV6_ARG = Object.prototype.hasOwnProperty.call(ARGS, "ipv6");
  const MIN_GROUP_NODES = argInt(ARGS.threshold, 0);
  const KEEP_GROUP_EMOJI = parseBoolean(ARGS.groupemoji, true);

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

  // FULL=true 以项目 base 为准，避免上游完整订阅的旧 DNS/端口覆盖已审核配置。
  // hosts 保留上游自定义项，但同名键由项目固定映射覆盖。
  const ordered = {};
  if (FULL) {
    for (const [key, value] of Object.entries(runtimeBase)) {
      if (["proxies", "proxy-groups", "rule-providers", "rules"].includes(key)) continue;
      if (key === "hosts" && value && typeof value === "object") {
        const sourceHosts = config.hosts && typeof config.hosts === "object" ? config.hosts : {};
        ordered.hosts = { ...sourceHosts, ...value };
      } else {
        ordered[key] = value;
      }
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

  if (FULL || HAS_IPV6_ARG) {
    ordered["ipv6"] = IPV6;
    if (ordered.dns && typeof ordered.dns === "object") ordered.dns.ipv6 = IPV6;
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

  let baseYaml = "";
  if (/^clash_rule_base=/m.test(iniText)) {
    if (fs.existsSync(CLASH_BASE_YAML)) {
      baseYaml = fs.readFileSync(CLASH_BASE_YAML, "utf8");
    } else {
      console.warn(`[unified:${target.label}] clash_rule_base 已配置但 ${CLASH_BASE_YAML} 不存在, 忽略 base 合并`);
    }
  }
  if (parsed.nodeOps.removeOldEmoji) {
    console.warn(`[unified:${target.label}] remove_old_emoji=true 暂不支持, 生成脚本将保留节点原有国旗`);
  }
  return {
    key: target.label.toLowerCase() === "router_mod_mini" ? "router_mod_mini" : target.label.toLowerCase().replace(/_mod_mini$/i, ""),
    label: target.label,
    nodeOps: parsed.nodeOps,
    groups: proxyGroups,
    providers,
    rules,
    baseYaml,
  };
}

function main() {
  const targets = collectTargets();
  if (targets.length === 0) {
    console.log("[unified] no ini files found under config/");
    return;
  }
  const profiles = targets.map(generateOne);
  const firstProfile = profiles[0];
  const out = path.join(OUTPUT_DIR, "unified.js");
  fs.writeFileSync(out, buildUnifiedScriptContent(firstProfile.nodeOps, profiles, firstProfile.baseYaml), "utf8");
  console.log(`[unified] config/*.ini -> ${path.relative(ROOT, out)} (profiles=${profiles.map((item) => item.key).join(",")})`);
}

main();
