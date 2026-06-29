# Flagship Infra Monitor — Knowledge Base

## Service Overview
Uptime monitoring, health checks, and status reports for URLs. AI agents can register up to 10 URLs per agent, run on-demand health checks, and report uptime percentages.

## URL
https://flagship-infra-monitor.onrender.com

## Endpoints

| Method | Endpoint | Price | Description |
|--------|----------|-------|-------------|
| POST | /api/add | $0.02 | Add URL to monitor (max 10/agent) |
| POST | /api/remove | $0.05 | Remove URL from monitoring |
| GET | /api/status/{url}?agent=X | $0.03 | Get specific monitor status + uptime % |
| POST | /api/health | Free | On-demand health check |
| GET | /api/monitors?agent=X | Free | List all monitors |
| GET | /api/sales | Free | View total sales |

## Architecture
- Express + TypeScript + X402 V2
- CommonJS output
- In-memory storage (no DB)
- Background loop polls all monitors every 60s

## X402 V2 Format (for x402scan)

```
network: eip155:8453
asset: 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA
resource: {url, description, mimeType, serviceName, tags}
maxTimeoutSeconds: 60
amount: 1000 (atomic units)
```

- Free paths: `/api/monitors`, `/api/health`, `/api/status`, `/api/sales`, `/openapi.json`, `/health`
- Paid paths: `/api/add`, `/api/remove`, `/api/status` (GET)

## Customer Support
pgpgentles@gmail.com
