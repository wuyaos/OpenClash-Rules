# OpenClash-Rules

# 订阅转换教程

***

## 快速使用

打开[肥羊订阅转换前端](https://suburl.v1.mk/)，填入必要信息（如图所示），用就完事了
![填写示例](suburl.png)

***

### 1. 选择订阅转换服务器

> - 用别人搭建好的（因为前端一般不支持自定义后端故以下仅作前端推荐）
  [肥羊](https://sub.v1.mk)、[acl4ssr](https://acl4ssr-sub.github.io/)
> - 自行搭建: [前端项目sub-web-modify](https://github.com/youshandefeiyang/sub-web-modify) | [后端项目subconverter](https://github.com/tindy2013/subconverter)

***

### 2.订阅转换

> 以肥羊前端（https://sub.v1.mk ）为例，解释一下各个参数

> **2.1 订阅链接**  
> 
> > 顾名思义就是把要转换的订阅（必须直接包含节点信息，用已经转换过的放进去套娃是识别不到的哦）> 放进去，可放多个（每行一个或用"|"符号分隔）
> 
> **2.2 生成类型**
> 
> > a. clash：clash系和shadowrocket软件通用  
> > b. 混合订阅（mixed）：混合订阅的意思就是把各类型（包括Shadowsocks、V2ray、Trajon）的节> 点以纯节点信息然后base64加密的方式混在一起，V2ray系和shadowrocket都可用
> 
> **2.3 订阅转换**
> 
> > 点击后开始转换，转换完成后会自动下载转换后的订阅文件（clash格式）
> 
> **2.4 后端地址**
> 
> > 一般只能选提供的后端无法自定义，这里推荐选择肥羊的后端，长期使用下来兼容性和稳定性可以说都> 是最好的
> 
> **2.5 短链选择**
> 
>   > 转换后的订阅地址为后端地址加一系列参数，URL一般较长不甚美观，故可转为短链接  
>   > 自行搭建推荐: [YOURLS](https://github.com/YOURLS/YOURLS)
> 
> **2.6 远程配置**
> 
> > 分流配置，可以选择给定的也可以输入URL自定义分流规则（注意必须是直链才行），自用clash分流> 规则直链地址：https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/config/general.ini
> 
> 
> **2.7 高级功能**
> 
> > 高级功能是可选的，可以不选，这里仅作介绍
> > 
> > a. 包含节点
> > 
> >   > * 节点黑名单，只有符合匹配规则的节点才会显示
> >   > 
> >   > * 常用规则
> >   >   
> >   >   * 只用香港节点: HK|香港|Hong Kong
> >   >   
> >   >   * 待补充
> > 
> > b. 排除节点
> >   
> >   > * 节点白名单，符合匹配规则的节点会被筛掉
> >   > 
> >   > * 常用规则
> >   >   
> >   >   * 将官网信息节点和流量信息节点筛掉: 官网|流量
> >   >   
> >   >   * 待补充
> > 
> > c. 节点命名
> >   
> >   > 节点按照一定规则重命名
> > 
> > d. 远程设备
> >   
> >   > 似乎是给QX用的，没用过QX不太清楚
> > 
> > e. 更新间隔
> >   
> >   > 顾名思义
> > 
> > f. 订阅命名
> >   
> >   >  订阅名称，在Clash for Windows一般会显示，其他客户端大多都为自定义
> > 
> > g. 更多选项（右下角）
> >   
> >   > * Emoji: 默认开启
> >   > 
> >   > * 启动UDP: 推荐开启，代理打游戏、打电话时大概率会用到，当然节点也得支持UDP开了才有用
> >   > 
> >   > * 启动TFO: 推荐开启
> >   > 
> >   > * 待补充

### 3. clash软件

***

> 推荐使用
> - [Clash Verge](https://github.com/clash-verge-rev/clash-verge-rev)
> - [mihomo-party](https://github.com/mihomo-party-org/mihomo-party)

***

### 4. 参数化脚本

使用脚本是 `scripts/unified.js`；`scripts/gen_script.js` 只用于生成脚本，不能作为客户端覆写脚本使用。

#### 4.1 选择配置

| 参数 | 适用场景 | 配置文件 |
| --- | --- | --- |
| `profile=general` | 通用配置，包含广告拦截规则（默认） | [general.ini](config/general.ini) |
| `profile=router` | 路由器配置，不含广告拦截规则 | [router.ini](config/router.ini) |
| `profile=app-proxy` | Docker 容器、下载软件等应用代理；在路由器配置基础上不包含 Android APP/GAME 直连规则 | [app-proxy.ini](config/app-proxy.ini) |

不填写 `profile` 或填写未知名称时使用 `general`。旧参数 `acl4ssr`、`acl4ssr_mod_mini` 仍映射到 `general`，`router_mod_mini` 映射到 `router`；原来的 INI 文件和 `unified_all.js` 已移除，需要更新链接。

#### 4.2 Sub-Store 调用

**生成完整 Mihomo 配置**：在 Sub-Store 的文件（Mihomo 配置）脚本操作中添加远程脚本，选择需要的链接。此处运行 `main`，生成策略组、规则和 rule-provider。

通用配置：

```text
https://cdn.jsdelivr.net/gh/wuyaos/OpenClash-Rules@main/scripts/unified.js#profile=general&full=true&ipv6=true&threshold=2
```

路由器配置：

```text
https://cdn.jsdelivr.net/gh/wuyaos/OpenClash-Rules@main/scripts/unified.js#profile=router&full=true&ipv6=true&threshold=2
```

应用代理配置：

```text
https://cdn.jsdelivr.net/gh/wuyaos/OpenClash-Rules@main/scripts/unified.js#profile=app-proxy&full=true&ipv6=true&threshold=2
```

如果使用 GitHub 原始地址，将链接的 `https://cdn.jsdelivr.net/gh/wuyaos/OpenClash-Rules@main/` 替换为 `https://raw.githubusercontent.com/wuyaos/OpenClash-Rules/main/`。`#` 后的参数需要由 Sub-Store 等运行环境解析并传给脚本；仅下载脚本文件不会执行或传入这些参数。

**仅处理订阅节点**：在订阅的脚本操作中使用同一个脚本地址，此处运行 `operator`，只过滤信息节点并补充国旗，不生成策略组或规则。`profile` 等配置参数作用于 `main`，不会改变节点处理规则。

#### 4.3 参数说明

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `profile` | `general` | 选择配置；也可用 `name` 传入配置名。 |
| `full` | `true` | 是否合并仓库的基础配置；`false` 不合并基础配置，保留输入配置的其他字段，并生成策略组及规则。 |
| `ipv6` | `false` | 设置顶层和 DNS 的 IPv6 开关；`full=false` 且未指定时保留输入配置的设置。 |
| `threshold` | `0` | 当节点数组可用时，地区自动组匹配节点数低于该值则移除该组及其引用；`0` 不移除。 |
| `groupemoji` | `true` | 设为 `false` 去除策略组名称中的 emoji。 |

多个参数用 `&` 连接。`full=true` 的基础配置依赖运行环境提供 YAML 解析器（例如 Sub-Store 的 `ProxyUtils.yaml`）；解析失败时不会合并基础配置，请查看运行日志。

支持 JavaScript 覆写的客户端也可使用 `unified.js` 的 `main` 入口；切换配置或传递其他参数需要客户端向脚本提供 `$arguments`。不支持参数的环境使用默认的 `general`，不能只把带 `#` 的链接当成通用 JavaScript 参数机制。

#### 4.4 重新生成

修改 INI、基础配置或生成器后，在项目根目录执行：

```bash
node scripts/gen_script.js
node --check scripts/gen_script.js
node --check scripts/unified.js
```

生成器读取 `config/*.ini` 和 `clash/config.yaml`，输出 `scripts/unified.js`。GitHub Actions 会在这些输入或生成器变更时更新生成脚本。
