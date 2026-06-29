# Flagship Universe — Open Knowledge File (OKF)

> **Last Updated:** 2026-06-29
> **Owner:** Patrick Gentles (pgpgentles@gmail.com)
> **Wallet:** `0x421C25445d6CF7B292933D743E698ed24dE36270`
> **Network:** Base (eip155:8453), USDC: `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`
> **MCP VPS:** 2.24.30.104 (srv1791950) — Ubuntu Noble, Node 20.20.2
> **Main VPS:** 187.77.202.93 (hermes2) — Render deployments + cron jobs

---

## 1. Portfolio Overview

Flagship Universe is a suite of paid APIs for AI agents, each implementing the x402 payment protocol. Agents discover services via x402scan and pay USDC on Base network per call.

### Services Matrix

| Service | URL | Status | x402scan | Repo |
|---------|-----|--------|----------|------|
| Kronos X402 | kronos-x402.onrender.com | ✅ Live | ✅ Registered | pgentles/kronos-x402 |
| Flagship Law | flagship-law.onrender.com | ✅ Live | ✅ Registered | pgentles/flagship-law |
| Flagship Compliance | flagship-compliance.onrender.com | ✅ Live | ✅ Registered | pgentles/flagship-compliance |
| Flagship Resume ATS | flagship-resume-ats.onrender.com | ✅ Live | ✅ Registered | pgentles/flagship-resume-ats |
| Flagship Infra Monitor | flagship-infra-monitor.onrender.com | ✅ Live | ⚠️ 2/3 registered | pgentles/flagship-infra-monitor |

### MCP Server

| Component | Details |
|-----------|---------|
| URL | ssh root@2.24.30.104 |
| Location | /opt/flagship-mcp-server/ |
| Build | `npm run build` (esbuild, 52ms) |
| Run | `node /opt/flagship-mcp-server/dist/server.js` (stdio JSON-RPC) |
| Tools | 21 tools across all 5 Flagship services |
| Repo | pgentles/flagship-mcp-server |
| Status | ✅ Deployed & Tested (8/8 tests passed) |
| Auto-pay | FALLBACK_PAYMENT header handles x402 |
| Claude Desktop | `"command": "ssh", "args": ["-x", "root@2.24.30.104", "node /opt/flagship-mcp-server/dist/server.js"]` |

---

### Infrastructure

| Host | IP | Purpose | Services |
|------|-------|---------|----------|
| Render (cloud) | — | Paid API deployments | All 5 Flagship APIs |
| VPS (main) | 187.77.202.93 | Cron jobs, DNS | Sales monitors, sales monitor crons |
| VPS (MCP) | 2.24.30.104 | MCP server, future APIs | flagship-mcp-server |

### MCP Server Protocol

```
Claude Desktop → ssh + stdio → MCP Server (2.24.30.104)
                                    ↓
                         Auto-pays x402 (FALLBACK_PAYMENT header)
                                    ↓
                         Flagship APIs (Render, HTTPS + x402)
                                    ↓
                         Returns data to Claude
```

The MCP server acts as a bridge: AI agents discover it via Claude Desktop, call tools, and the server handles x402 payment automatically using the registered FALLBACK_PAYMENT header.

---

## 2. x402 Payment Protocol — Implementation Standard

### 2.1 Architecture Pattern (All Services)

```
Agent → x402scan (discovery) → HTTPS + X402-Payment header → Render Express server
```

Every service follows the same stack:
- **Express + TypeScript** (single-file `server.ts`, CommonJS output)
- **x402 v2 middleware** (payment gate on all paid paths)
- **OpenAPI 3.1.0** at `/openapi.json` (discovery + probe)
- **Render.com** auto-deploy from GitHub main branch
- **x402scan.com** registration for agent discovery

### 2.2 x402 v2 Response Format (Required)

When no `X402-Payment` header is present, paid endpoints return:

```
HTTP/1.1 402 Payment Required
X-Payment-Protocol: x402
X402-Payment: required
Payment-Required: <base64-encoded JSON>
Content-Type: application/json
```

Decoded `Payment-Required` payload:
```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "amount": "<atomic_units>",
    "asset": "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    "payTo": "0x421C25445d6CF7B292933D743E698ed24dE36270",
    "maxTimeoutSeconds": 60,
    "resource": {
      "url": "https://<service>.onrender.com<path>",
      "description": "<endpoint description>",
      "mimeType": "application/json",
      "serviceName": "<Service Name>",
      "tags": ["<tag1>", "<tag2>"]
    },
    "extra": { "name": "USDC", "version": "2" }
  }],
  "wallet": "0x421C25445d6CF7B292933D743E698ed24dE36270"
}
```

### 2.3 Free Endpoint Requirements

Free endpoints (no payment required) MUST have `security: []` in their OpenAPI operation:
```json
"/api/sales": {
  "get": {
    "security": [],
    ...
  }
}
```

### 2.4 Paid Endpoint Requirements

Paid endpoints MUST have:
- `requestBody` with JSON schema (x402scan probes these)
- `POST` method (x402scan requires requestBody input schemas)
- `responses.402` with content schema
- Required parameters defined in `parameters`

### 2.5 Pricing (Atomic Units)

| Service | Endpoint | Price (USDC) | Atomic Units |
|---------|----------|-------------|--------------|
| Kronos X402 | /api/signals | 0.02 | 20000 |
| Kronos X402 | /api/risk | 0.02 | 20000 |
| Kronos X402 | /api/forecast | 0.02 | 20000 |
| Kronos X402 | /api/decision | 0.10 | 100000 |
| Kronos X402 | /api/preflight | 0.03 | 30000 |
| Kronos X402 | /api/audit | 0.05 | 50000 |
| Flagship Law | /api/analyze | 0.05 | 50000 |
| Flagship Law | /api/detailed | 0.15 | 150000 |
| Flagship Compliance | /api/analyze | 0.07 | 70000 |
| Flagship Compliance | /api/detailed | 0.15 | 150000 |
| Flagship Resume ATS | /api/analyze | 0.05 | 50000 |
| Flagship Resume ATS | /api/tailor | 0.10 | 100000 |
| Flagship Resume ATS | /api/score | 0.03 | 30000 |
| Flagship Infra Monitor | /api/add | 0.02 | 20000 |
| Flagship Infra Monitor | /api/remove | 0.05 | 50000 |
| Flagship Infra Monitor | /api/status/{url} | 0.03 | 30000 |

---

## 3. MCP (Model Context Protocol) Integration

### 3.1 What is MCP?

Model Context Protocol (MCP) is a protocol for passing context between LLMs and other AI agents. The x402 MCP server acts as a bridge between Claude Desktop (or any MCP-compatible client) and paid APIs.

### 3.2 How MCP + x402 Works

```
Claude Desktop → MCP tool call → MCP Server → Paid API (x402) → Response
```

When Claude calls a tool:
1. MCP server detects if API requires payment (HTTP 402 with `PAYMENT-REQUIRED` header)
2. Automatically handles payment using your wallet via registered x402 scheme
3. Returns paid data to Claude

### 3.3 MCP Server Implementation (Kronos X402)

Kronos X402 exposes a free MCP endpoint at `/mcp` (POST, JSON-RPC 2.0). Tools:
- `check_trade_preflight` — Pre-trade risk check
- `get_crypto_decision` — Full buy/sell/hold decision
- `audit_trade_decision` — Post-decision audit
- `get_signals` — Raw signal data
- `get_risk` — Risk assessment
- `get_forecast` — Price forecast

### 3.4 Connecting Claude Desktop

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "kronos": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/sdk", ...],
      "env": {
        "RESOURCE_SERVER_URL": "https://kronos-x402.onrender.com"
      }
    }
  }
}
```

### 3.5 Bazaar Discovery (MCP)

MCP servers can make tools discoverable via x402 Bazaar:
```typescript
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const paid = createPaymentWrapper(resourceServer, {
  accepts,
  resource: { url: "mcp://tool/get_weather", description: "..." },
  extensions: declareDiscoveryExtension({
    toolName: "get_weather",
    description: "Get current weather for a city",
    transport: "sse",
    inputSchema: {
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  }),
});
```

Buyers discover tools: `await client.extensions.bazaar.listResources({ type: "mcp" })`

---

## 4. Service Details

### 4.1 Kronos X402 — Crypto Market Intelligence

**Endpoints (Paid):**
- `POST /api/signals` — Trading signals for a symbol
- `POST /api/risk` — Risk assessment (volatility, drawdown, etc.)
- `POST /api/forecast` — Price forecast (supports `hours` param)
- `POST /api/decision` — Full buy/sell/hold decision
- `POST /api/preflight` — Pre-trade risk check
- `POST /api/audit` — Post-decision audit

**Endpoints (Free):**
- `POST /mcp` — MCP JSON-RPC tools
- `GET /openapi.json` — Discovery
- `GET /health` — Health + wallet status
- `GET /api/sales` — Transaction count
- `GET /api/wallet` — Wallet address

### 4.2 Flagship Law — FDCPA/FCRA Violation Analysis

**Endpoints (Paid):**
- `POST /api/analyze` — Quick violation scan (FDCPA/FCRA)
- `POST /api/detailed` — Full analysis with demand letter draft

**Endpoints (Free):**
- `GET /api/regulations` — List all tracked statutes
- `GET /api/categories` — Violation categories
- `GET /api/sales` — Transaction count
- `GET /openapi.json` — Discovery

**Statutes Covered:** FDCPA (15 U.S.C. §1692), FCRA (15 U.S.C. §1681), CROA (15 U.S.C. §1678)

### 4.3 Flagship Compliance — Regulatory Compliance Analysis

**Endpoints (Paid):**
- `POST /api/analyze` — Compliance check (GLBA/SOX/PCI-DSS/CCPA/HIPAA)
- `POST /api/detailed` — Full compliance report with gap analysis

**Endpoints (Free):**
- `GET /api/regulations` — List regulations
- `GET /api/categories` — Compliance categories
- `GET /api/sales` — Transaction count
- `GET /openapi.json` — Discovery

**Checks:** 16 compliance checks across GLBA, SOX, PCI-DSS, CCPA, HIPAA

### 4.4 Flagship Resume ATS — Resume Optimization

**Endpoints (Paid):**
- `POST /api/analyze` — ATS compatibility analysis
- `POST /api/tailor` — Tailor resume to job description
- `POST /api/score` — Quick keyword match score

**Endpoints (Free):**
- `GET /api/formats` — ATS-safe formatting rules
- `GET /api/keywords` — Industry keyword database (70+ per industry)
- `GET /api/sales` — Transaction count
- `GET /openapi.json` — Discovery

**Industries:** Technology, Finance, Healthcare, Marketing, Sales, Education

### 4.5 Flagship Infra Monitor — Uptime Monitoring

**Endpoints (Paid):**
- `POST /api/add` — Add URL to monitor (max 10/agent)
- `POST /api/remove` — Remove URL from monitoring
- `GET /api/status/{url}` — Get monitor status + uptime %

**Endpoints (Free):**
- `POST /api/health` — On-demand health check (HTTP status, response time, SSL, keyword)
- `GET /api/monitors` — List all monitors
- `GET /api/sales` — Transaction count
- `GET /openapi.json` — Discovery

**Features:** HTTP status, response time (ms), SSL days remaining, keyword presence, 60s background polling

---

## 5. Deployment & Operations

### 5.1 Render Configuration (All Services)

- **Build Command:** `npm run build` (or `npm install && tsc` if deps missing)
- **Start Command:** `node dist/server.js`
- **Auto-deploy:** Yes, on push to main
- **HTTPS:** Render-managed certificate (required for x402scan)

### 5.2 x402scan Registration Checklist

For each new service:
1. Deploy to Render (HTTPS)
2. Verify `/openapi.json` returns correct spec
3. Verify 402 challenge works: `curl -s -D - https://<url>/api/<paid-endpoint>`
4. Go to x402scan.com → Add API → enter URL
5. Fill in: network, asset, receiver, methods + amounts
6. Wait ~30 min if re-registering (cache)

### 5.3 Common Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| "Missing input schema" | GET endpoint without requestBody | Use POST with JSON body |
| "No valid x402 response" | Wrong Payment-Required format | Use exact v2 format with `x402Version: 2` |
| "Unprotected endpoints skipped" | Free endpoints lack `security: []` | Add `"security": []` to OpenAPI operation |
| Build fails on Render | `npm install` not run before `tsc` | Use `"build": "npm install && tsc"` |
| x402scan cache stale | Previous failed registration | Wait 30 min or use cache-buster |

### 5.3 Sales Monitoring

**Cron Jobs (Currently Paused):**
- `278da0e7396c` — Kronos X402 Sales Monitor (every 10m)
- `fb0e9817ebad` — Flagship Sales Monitor (every 10m, all services)

Both crons only send notifications when `total > 0` on any service. Currently paused to avoid spam.

**Manual Check:**
```bash
curl -s https://kronos-x402.onrender.com/api/sales
curl -s https://flagship-law.onrender.com/api/sales
curl -s https://flagship-compliance.onrender.com/api/sales
curl -s https://flagship-resume-ats.onrender.com/api/sales
curl -s https://flagship-infra-monitor.onrender.com/api/sales
```

---

## 6. Project File Structure (Per Service)

```
<service>/
├── server.ts              # Main Express server (single-file, all code)
├── package.json           # Dependencies: express, @types/express, @types/node, typescript
├── tsconfig.json          # CommonJS output, ES2020 target
├── knowledge-base/
│   └── project-knowledge-base.md
├── dist/                  # Compiled JS (auto-generated)
└── node_modules/          # Dependencies (auto-generated)
```

---

## 7. Owner & Contact

- **Name:** Patrick Gentles
- **Email:** pgpgentles@gmail.com
- **Wallet:** `0x421C25445d6CF7B292933D743E698ed24dE36270`
- **Network:** Base (chain_id: 8453)
- **USDC Contract:** `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`
- **x402scan Facilitator:** `https://x402scan.com/facilitator`
- **Portfolio Site:** flagshipuniverse.com
- **MCP Server SSH:** `ssh root@2.24.30.104`

---

## 8. Build Commands Quick Reference

| Service | Build | Start |
|---------|-------|-------|
| kronos-x402 | `npm run build` (tsc) | `npm start` |
| flagship-*, infra-monitor | `npm run build` (npm install && tsc) | `npm start` |
| flagship-mcp-server | `npm run build` (esbuild) | `node dist/server.js` |
