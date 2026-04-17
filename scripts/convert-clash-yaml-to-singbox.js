#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "clash", "mobile-module.yaml");
const DEFAULT_OUTPUT = path.join(ROOT, "sing-box", "config.example.json");
const PROJECT_RULE_PREFIX =
  "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/rules/";
const PROJECT_RULESET_JSON_PREFIX =
  "https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/sing-box/rule-set/";

function parseClashYaml(yamlText) {
  const providerUrlByName = new Map();
  const rules = [];

  const lines = yamlText.split(/\r?\n/);
  let inProviders = false;
  let inRules = false;
  let currentProvider = "";

  for (const line of lines) {
    if (/^rule-providers:\s*$/.test(line)) {
      inProviders = true;
      inRules = false;
      currentProvider = "";
      continue;
    }
    if (/^rules:\s*$/.test(line)) {
      inProviders = false;
      inRules = true;
      currentProvider = "";
      continue;
    }

    if (inProviders) {
      const providerMatch = line.match(/^ {2}([^:\s][^:]*):\s*$/);
      if (providerMatch) {
        currentProvider = providerMatch[1].trim();
        continue;
      }

      const urlMatch = line.match(/^\s+url:\s*"([^"]+)"/);
      if (currentProvider && urlMatch) {
        providerUrlByName.set(currentProvider, urlMatch[1].trim());
      }
      continue;
    }

    if (inRules) {
      const ruleMatch = line.match(/^ {2}-\s*"(.+)"\s*$/);
      if (ruleMatch) {
        rules.push(ruleMatch[1].trim());
      }
    }
  }

  return { providerUrlByName, rules };
}

function basenameNoExt(urlText) {
  try {
    const url = new URL(urlText);
    const raw = path.basename(url.pathname);
    return raw.replace(/\.[^.]+$/, "");
  } catch (_error) {
    return "";
  }
}

function actionFromTarget(targetText) {
  const target = String(targetText || "");
  if (target.includes("广告拦截")) return { action: "reject" };
  if (target.includes("全球直连")) return { action: "route", outbound: "direct" };
  return { action: "route", outbound: "proxy" };
}

function splitCsv(line) {
  return line.split(",").map((v) => v.trim()).filter(Boolean);
}

function buildProjectProviderMap(providerUrlByName) {
  const projectByProvider = new Map();
  for (const [provider, url] of providerUrlByName.entries()) {
    if (!url.startsWith(PROJECT_RULE_PREFIX) || !url.endsWith(".list")) continue;
    const base = basenameNoExt(url);
    if (!base) continue;
    projectByProvider.set(provider, {
      provider,
      sourceUrl: url,
      base,
      tag: `oc-${base}`,
      ruleSetUrl: `${PROJECT_RULESET_JSON_PREFIX}${base}.json`,
    });
  }
  return projectByProvider;
}

function buildRouteConfig(projectByProvider, clashRules) {
  const routeRules = [
    {
      protocol: "dns",
      action: "route",
      outbound: "dns-out",
    },
  ];
  const routeRuleSets = [];
  const seenTags = new Set();

  for (const rawRule of clashRules) {
    const fields = splitCsv(rawRule);
    if (fields.length < 2) continue;

    const kind = fields[0].toUpperCase();
    if (kind !== "RULE-SET") continue;

    const provider = fields[1];
    const target = fields[2] || "";
    const project = projectByProvider.get(provider);
    if (!project) continue;

    if (!seenTags.has(project.tag)) {
      seenTags.add(project.tag);
      routeRuleSets.push({
        type: "remote",
        tag: project.tag,
        format: "source",
        url: project.ruleSetUrl,
        download_detour: "proxy",
      });
    }

    const actionBlock = actionFromTarget(target);
    const rule = {
      rule_set: [project.tag],
      action: actionBlock.action,
    };
    if (actionBlock.outbound) {
      rule.outbound = actionBlock.outbound;
    }
    routeRules.push(rule);
  }

  return {
    rules: routeRules,
    rule_set: routeRuleSets,
    final: "proxy",
    auto_detect_interface: true,
    find_process: true,
    default_domain_resolver: "local",
  };
}

function baseConfig() {
  return {
    log: {
      level: "info",
      timestamp: true,
    },
    dns: {
      servers: [
        {
          tag: "google",
          type: "tls",
          server: "8.8.8.8",
        },
        {
          tag: "local",
          type: "https",
          server: "223.5.5.5",
        },
      ],
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        interface_name: "tun0",
        address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
        auto_route: true,
        strict_route: true,
        stack: "mixed",
      },
    ],
    outbounds: [
      {
        type: "selector",
        tag: "proxy",
        outbounds: ["auto", "node-01", "node-02"],
        default: "auto",
      },
      {
        type: "urltest",
        tag: "auto",
        outbounds: ["node-01", "node-02"],
        url: "https://www.gstatic.com/generate_204",
        interval: "3m",
        tolerance: 50,
      },
      {
        type: "socks",
        tag: "node-01",
        server: "127.0.0.1",
        server_port: 10801,
      },
      {
        type: "socks",
        tag: "node-02",
        server: "127.0.0.1",
        server_port: 10802,
      },
      {
        type: "direct",
        tag: "direct",
      },
      {
        type: "dns",
        tag: "dns-out",
      },
    ],
    route: {},
    experimental: {
      cache_file: {
        enabled: true,
        store_rdrc: true,
      },
      clash_api: {
        default_mode: "Enhanced",
      },
    },
  };
}

function main() {
  const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT);
  const outputPath = path.resolve(process.argv[3] || DEFAULT_OUTPUT);

  const yaml = fs.readFileSync(inputPath, "utf8");
  const { providerUrlByName, rules } = parseClashYaml(yaml);
  const projectByProvider = buildProjectProviderMap(providerUrlByName);
  const route = buildRouteConfig(projectByProvider, rules);

  const config = baseConfig();
  config.route = route;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log(
    `[clash->sing-box] ${path.relative(ROOT, inputPath)} -> ${path.relative(
      ROOT,
      outputPath
    )} (providers=${projectByProvider.size}, route_rules=${route.rules.length}, rule_sets=${route.rule_set.length})`
  );
}

main();
