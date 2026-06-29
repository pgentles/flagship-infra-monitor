import express, { Request, Response } from "express";
import crypto from "crypto";

// ============================================================
//  Types
// ============================================================

interface Monitor {
  id: string;
  url: string;
  agent: string;
  keyword?: string;
  status: "up" | "down" | "unknown";
  statusCode: number;
  responseTime: number;
  sslDaysRemaining: number | null;
  lastChecked: string;
  totalChecks: number;
  failedChecks: number;
  addedAt: string;
}

interface HealthCheck {
  url: string;
  statusCode: number;
  statusText: string;
  responseTime: number;
  sslDaysRemaining: number | null;
  contentType: string;
  contentLength: number;
  timestamp: string;
  healthy: boolean;
  keywordFound?: boolean;
}

// ============================================================
//  In-Memory Storage
// ============================================================

const monitors: Map<string, Monitor> = new Map();
const agentMonitors: Map<string, Set<string>> = new Map();
const MAX_MONITORS_PER_AGENT = 10;

// ============================================================
//  X402 Sales Tracking
// ============================================================

const x402SalesData = {
  total: 0,
  revenue_usdc: 0,
  timestamp: new Date().toISOString(),
  endpoint: "",
};

// ============================================================
//  Health Check Function
// ============================================================

async function checkHealth(
  url: string,
  timeoutMs: number = 10000,
  keyword?: string
): Promise<HealthCheck> {
  const start = Date.now();

  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";

      if (!isHttps && parsedUrl.protocol !== "http:") {
        resolve({
          url,
          statusCode: 0,
          statusText: "Only http/https supported",
          responseTime: Date.now() - start,
          sslDaysRemaining: null,
          contentType: "unknown",
          contentLength: 0,
          timestamp: new Date().toISOString(),
          healthy: false,
        });
        return;
      }

      const options = {
        headers: { "User-Agent": "Flagship-Infra-Monitor/1.0" },
        rejectUnauthorized: false,
        timeout: timeoutMs,
      };

      const req = (isHttps ? require("https") : require("http")).get(url, options, (res: any) => {
        const responseTime = Date.now() - start;
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk; });
        res.on("end", () => {
          let keywordFound: boolean | undefined = undefined;
          if (keyword !== undefined) {
            keywordFound = data.toLowerCase().includes(keyword.toLowerCase());
          }

          let sslDaysRemaining: number | null = null;
          if (res.socket && (res.socket as any).getPeerCertificate) {
            const cert = (res.socket as any).getPeerCertificate();
            if (cert && cert.valid_to) {
              const expiry = new Date(cert.valid_to).getTime();
              sslDaysRemaining = Math.floor((expiry - Date.now()) / (1000 * 60 * 60 * 24));
            }
          }

          resolve({
            url,
            statusCode: res.statusCode,
            statusText: res.statusMessage || "OK",
            responseTime,
            sslDaysRemaining,
            contentType: res.headers["content-type"] || "unknown",
            contentLength: data.length,
            timestamp: new Date().toISOString(),
            healthy: res.statusCode >= 200 && res.statusCode < 400,
            keywordFound,
          });
        });
      });

      req.on("error", () => {
        resolve({
          url,
          statusCode: 0,
          statusText: "Connection Failed",
          responseTime: Date.now() - start,
          sslDaysRemaining: null,
          contentType: "unknown",
          contentLength: 0,
          timestamp: new Date().toISOString(),
          healthy: false,
        });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({
          url,
          statusCode: 0,
          statusText: "Timeout",
          responseTime: Date.now() - start,
          sslDaysRemaining: null,
          contentType: "unknown",
          contentLength: 0,
          timestamp: new Date().toISOString(),
          healthy: false,
        });
      });
    } catch {
      resolve({
        url,
        statusCode: 0,
        statusText: "Invalid Request",
        responseTime: Date.now() - start,
        sslDaysRemaining: null,
        contentType: "unknown",
        contentLength: 0,
        timestamp: new Date().toISOString(),
        healthy: false,
      });
    }
  });
}

// ============================================================
//  x402 Payment Middleware (V2 Spec)
// ============================================================

const FREE_PATHS: string[] = ["/api/monitors", "/api/health", "/api/status", "/api/sales", "/openapi.json", "/health"];

const BASE_NETWORK_CAIP2 = "eip155:8453";
const USDC_BASE_MAINNET = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";
const WALLET = "0x421C25445d6CF7B292933D743E698ed24dE36270";

function generatePaymentChallenge(req: Request, res: Response) {
  const resourceUrl = `https://${req.headers.host}${req.path}`;
  const endpointName = req.path.replace(/\/\{.*\}/, "").split("/").filter(Boolean).pop() || "unknown";

  const priceMap: Record<string, string> = {
    "api/add": "20000",
    "api/remove": "50000",
    "api/status": "30000",
  };
  const amount = priceMap[endpointName] || "20000";

  const accepts = [{
    scheme: "exact",
    network: BASE_NETWORK_CAIP2,
    amount,
    asset: USDC_BASE_MAINNET,
    payTo: WALLET,
    maxTimeoutSeconds: 60,
    resource: {
      url: resourceUrl,
      description: `Uptime monitoring and health checks — ${endpointName}`,
      mimeType: "application/json",
      serviceName: "Flagship Infra Monitor",
      tags: ["monitoring", "uptime", "health-check", "infra"],
    },
    extra: { name: "USDC", version: "2" },
  }];

  const body = { x402Version: 2, accepts, wallet: WALLET };
  const b64 = Buffer.from(JSON.stringify(body)).toString("base64");

  res.set("X-Payment-Protocol", "x402");
  res.set("X402-Payment", "required");
  res.set("Payment-Required", b64);
  return res.status(402).json(body);
}

function x402Middleware(req: Request, res: Response, next: () => void) {
  if (FREE_PATHS.includes(req.path)) {
    return next();
  }

  const payment = req.headers["x402-payment"] || req.headers["X402-Payment"];
  if (!payment) {
    return generatePaymentChallenge(req, res);
  }

  // Payment received → record sale
  x402SalesData.total += 1;
  x402SalesData.timestamp = new Date().toISOString();
  x402SalesData.endpoint = req.path;

  next();
}

// ============================================================
//  Express App + Middleware
// ============================================================

const app = express();
app.use(express.json());
app.use(x402Middleware);

// Health info
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    service: "Flagship Infra Monitor",
    status: "live",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
//  OpenAPI Spec
// ============================================================

app.get("/openapi.json", (_req: Request, res: Response) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "Flagship Infra Monitor API",
      version: "1.0.0",
      description: "Uptime monitoring, health checks, and status reports for URLs",
      contact: { email: "pgpgentles@gmail.com" },
      "x-guidance": "Add URLs to monitor, check their health, and receive uptime reports",
      "x-payment-info": {
        endpoints: {
          "POST /api/add": { price_usdc: 0.02, description: "Add URL to monitor (max 10/agent)" },
          "POST /api/remove": { price_usdc: 0.05, description: "Remove URL from monitoring" },
          "GET /api/status/{url}": { price_usdc: 0.03, description: "Get specific monitor status" },
          "POST /api/health": { price_usdc: 0, description: "On-demand health check (free)" },
          "GET /api/monitors": { price_usdc: 0, description: "List all monitors (free)" },
          "GET /api/sales": { price_usdc: 0, description: "View total sales (free)" },
        },
        network: "eip155:8453",
        asset: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        facilitator: "https://x402scan.com/facilitator",
        protocols: ["x402"],
      },
    },
    servers: [{ url: "https://flagship-infra-monitor.onrender.com" }],
    paths: {
      "/api/add": {
        post: {
          summary: "Add URL to monitor",
          operationId: "addMonitor",
          tags: ["Monitoring"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url", "agent"],
                  properties: {
                    url: { type: "string", description: "URL to monitor (must be https)" },
                    agent: { type: "string", description: "Agent identifier" },
                    keyword: { type: "string", description: "Optional keyword that must appear on page" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Monitor added successfully" },
            "402": {
              description: "Payment required",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } },
            },
            "409": { description: "Already exists or max limit" },
            "422": { description: "Invalid URL" },
          },
        },
      },
      "/api/remove": {
        post: {
          summary: "Remove URL from monitoring",
          operationId: "removeMonitor",
          tags: ["Monitoring"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url", "agent"],
                  properties: { url: { type: "string" }, agent: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Monitor removed" },
            "404": { description: "Not found" },
            "402": {
              description: "Payment required",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } },
            },
          },
        },
      },
      "/api/status/{url}": {
        get: {
          summary: "Get monitor status for URL",
          operationId: "getStatus",
          tags: ["Status"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "url", in: "path", required: true, schema: { type: "string" }, description: "Monitored URL (encode special chars)" },
            { name: "agent", in: "query", required: true, schema: { type: "string" }, description: "Agent identifier" },
          ],
          responses: {
            "200": { description: "Monitor status" },
            "402": {
              description: "Payment required",
              content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } },
            },
            "404": { description: "Not found" },
          },
        },
      },
      "/api/health": {
        post: {
          summary: "On-demand health check",
          operationId: "checkHealth",
          tags: ["Health"],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string" },
                    keyword: { type: "string", description: "Check if keyword appears" },
                    timeout: { type: "integer", default: 10000, description: "Timeout in ms" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Health check results" } },
        },
      },
      "/api/monitors": {
        get: {
          summary: "List all monitors",
          operationId: "listMonitors",
          tags: ["Monitoring"],
          security: [],
          parameters: [{ name: "agent", in: "query", required: false, schema: { type: "string" } }],
          responses: { "200": { description: "List of monitors" } },
        },
      },
      "/api/sales": {
        get: {
          summary: "View total sales",
          operationId: "getSales",
          tags: ["Sales"],
          security: [],
          responses: { "200": { description: "Sales data" } },
        },
      },
    },
    components: {
      schemas: {
        PaymentRequired: {
          type: "object",
          properties: {
            error: { type: "string", example: "payment_required" },
            description: { type: "string" },
            "x-guidance": { type: "string" },
            "x-network": { type: "string" },
            methods: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  });
});

// ============================================================
//  Routes
// ============================================================

// POST /api/add - Add monitor
app.post("/api/add", async (req: Request, res: Response) => {
  const { url, agent, keyword } = req.body;

  if (!url || !agent) {
    return res.status(422).json({ error: "missing_fields", message: "url and agent are required" });
  }

  try {
    new URL(url);
  } catch {
    return res.status(422).json({ error: "invalid_url", message: "URL must be valid" });
  }

  const monitorId = crypto.createHash("md5").update(`${agent}:${url}`).digest("hex");

  if (!agentMonitors.has(agent)) {
    agentMonitors.set(agent, new Set());
  }
  const agentSet = agentMonitors.get(agent)!;

  if (!monitors.has(monitorId) && agentSet.size >= MAX_MONITORS_PER_AGENT) {
    return res.status(409).json({ error: "max_limit_reached", message: "Maximum 10 monitors per agent" });
  }

  if (monitors.has(monitorId)) {
    return res.status(409).json({ error: "already_exists", message: "Already monitoring this URL" });
  }

  const health = await checkHealth(url, 10000, keyword);

  const monitor: Monitor = {
    id: monitorId,
    url,
    agent,
    keyword,
    status: health.healthy ? "up" : "down",
    statusCode: health.statusCode,
    responseTime: health.responseTime,
    sslDaysRemaining: health.sslDaysRemaining,
    lastChecked: health.timestamp,
    totalChecks: 1,
    failedChecks: health.healthy ? 0 : 1,
    addedAt: new Date().toISOString(),
  };

  monitors.set(monitorId, monitor);
  agentSet.add(monitorId);

  res.status(200).json({ message: "Monitor added successfully", monitor });
});

// POST /api/remove - Remove monitor
app.post("/api/remove", (req: Request, res: Response) => {
  const { url, agent } = req.body;

  if (!url || !agent) {
    return res.status(422).json({ error: "missing_fields", message: "url and agent required" });
  }

  const monitorId = crypto.createHash("md5").update(`${agent}:${url}`).digest("hex");

  if (!monitors.has(monitorId)) {
    return res.status(404).json({ error: "not_found", message: "Monitor not found" });
  }

  const monitor = monitors.get(monitorId)!;
  monitors.delete(monitorId);
  const agentSet = agentMonitors.get(agent);
  if (agentSet) agentSet.delete(monitorId);

  res.status(200).json({ message: "Monitor removed", monitor });
});

// GET /api/status/:url
app.get("/api/status/:url", (req: Request, res: Response) => {
  const url = decodeURIComponent(req.params.url);
  const agent = (req.query.agent as string) || "";

  const monitorId = crypto.createHash("md5").update(`${agent}:${url}`).digest("hex");

  if (!monitors.has(monitorId)) {
    return res.status(404).json({ error: "not_found", message: "Monitor not found" });
  }

  const m = monitors.get(monitorId)!;
  const uptimePercent =
    m.totalChecks > 0
      ? (((m.totalChecks - m.failedChecks) / m.totalChecks) * 100).toFixed(2) + "%"
      : "100%";

  res.status(200).json({ ...m, uptimePercent });
});

// POST /api/health - On-demand health check (FREE)
app.post("/api/health", async (req: Request, res: Response) => {
  const { url, keyword, timeout } = req.body;

  if (!url) {
    return res.status(422).json({ error: "missing_fields", message: "url is required" });
  }

  const health = await checkHealth(url, timeout || 10000, keyword);
  res.status(200).json(health);
});

// GET /api/monitors - List monitors (FREE)
app.get("/api/monitors", (req: Request, res: Response) => {
  const agent = req.query.agent as string;
  let allMonitors = Array.from(monitors.values());

  if (agent) {
    const agentSet = agentMonitors.get(agent);
    if (!agentSet) {
      return res.json({ monitors: [], count: 0 });
    }
    allMonitors = allMonitors.filter((m: Monitor) => agentSet.has(m.id));
  }

  res.json({ monitors: allMonitors, count: allMonitors.length });
});

// GET /api/sales - View sales (FREE)
app.get("/api/sales", (_req: Request, res: Response) => {
  res.json(x402SalesData);
});

// ============================================================
//  Background Monitoring Loop (every 60s)
// ============================================================

const monitorList: Monitor[] = [];

setInterval(async () => {
  monitorList.length = 0;
  monitors.forEach((m) => { monitorList.push(m); });

  for (let i = 0; i < monitorList.length; i++) {
    const m = monitorList[i];
    const health = await checkHealth(m.url, 10000, m.keyword);
    const updated = {
      ...m,
      totalChecks: m.totalChecks + 1,
      failedChecks: m.failedChecks + (health.healthy ? 0 : 1),
      status: health.healthy ? ("up" as const) : ("down" as const),
      statusCode: health.statusCode,
      responseTime: health.responseTime,
      sslDaysRemaining: health.sslDaysRemaining,
      lastChecked: health.timestamp,
    };
    monitors.set(m.id, updated);
  }
}, 60000);

// ============================================================
//  Start Server
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Flagship Infra Monitor running on port ${PORT}`);
});
