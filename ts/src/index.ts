import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import pkg from "../package.json";
import { AuthState } from "./auth.ts";
import { tools, toolMeta } from "./tools.ts";

// ─── Env ─────────────────────────────────────────────────────────────────────

const env = (key: string, fallback?: string): string => {
  const v = process.env[key] || fallback;
  if (!v) { console.error(`${key} env var required`); process.exit(1); }
  return v;
};

const auth = new AuthState(
  env("GOOGLE_CLIENT_ID"),
  env("GOOGLE_CLIENT_SECRET"),
  env("GOOGLE_REFRESH_TOKEN"),
);

const BASE = "https://health.googleapis.com/v4/users/me";

// Stateless HTTP mode needs a fresh transport per request, so the server is
// built by a factory rather than kept as a single instance.
function createMcpServer(): Server {
  const server = new Server(
    { name: "google-health-mcp", version: pkg.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  // ─── Tools ─────────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(tools).map(([name, { description, inputSchema }]) => ({
      name,
      ...(toolMeta[name]?.title ? { title: toolMeta[name].title } : {}),
      description,
      inputSchema,
      ...(toolMeta[name]?.annotations ? { annotations: toolMeta[name].annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = tools[name];
    if (!tool) return { content: [{ type: "text", text: `ERROR: Unknown tool: ${name}` }], isError: true };
    return tool.handler(auth, args || {});
  });

  // ─── Resources ─────────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: "health://profile", name: "Health Profile", description: "Google Health user profile", mimeType: "application/json" },
      { uri: "health://settings", name: "Health Settings", description: "Google Health settings", mimeType: "application/json" },
      { uri: "health://devices", name: "Paired Devices", description: "Devices paired with the account", mimeType: "application/json" },
    ],
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      { uriTemplate: "health://summary/{date}", name: "Daily Summary", description: "Full daily health summary for a date (YYYY-MM-DD)", mimeType: "application/json" },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    const pathMap: Record<string, string> = {
      "health://profile": "profile",
      "health://settings": "settings",
      "health://devices": "pairedDevices",
    };
    if (uri.startsWith("health://summary/")) {
      const dateStr = uri.slice("health://summary/".length);
      const summaryTool = tools["summary"];
      const res = await summaryTool.handler(auth, { date: dateStr });
      return { contents: [{ uri, mimeType: "application/json", text: res.content[0].text }] };
    }
    const path = pathMap[uri];
    if (!path) throw new Error(`Unknown resource URI: ${uri}`);
    const data = await auth.apiGet(`${BASE}/${path}`);
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  });

  // ─── Prompts ───────────────────────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      { name: "health_weekly_review", description: "Comprehensive 7-day health, sleep, and workout review", arguments: [{ name: "end_date", description: "End date in YYYY-MM-DD format (defaults to today)", required: false }] },
      { name: "sleep_quality_analysis", description: "Detailed sleep stages, HRV, and recovery analysis", arguments: [{ name: "days", description: "Number of past days to analyze (default 7)", required: false }] },
      { name: "workout_summary", description: "Exercise sessions and heart rate zone breakdown", arguments: [{ name: "days", description: "Number of past days to analyze (default 7)", required: false }] },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const prompts: Record<string, (a: any) => string> = {
      health_weekly_review: (a) => `Please review my health data up to ${a?.end_date || "today"}. Use \`summary\` for the past 7 days to evaluate step trends, sleep duration/stages, resting heart rate, active calories, and overall recovery. Highlight any key trends or anomalies.\n\nAdditional analysis to include:\n- Evaluate sleep stage distribution (deep/REM percentages, sleep efficiency)\n- Analyze HR zone breakdown across activities\n- Check temperature anomalies from daily-sleep-temperature-derivations\n- Review respiratory rate trends from daily-respiratory-rate`,
      sleep_quality_analysis: (a) => `Please analyze my sleep quality for the past ${a?.days || "7"} days. Use \`sync_data_points\` or \`list_data_points\` for \`sleep\`, \`heart-rate-variability\`, and \`daily-resting-heart-rate\`. Detail my sleep efficiency, deep/REM sleep percentages, and HRV trends.\n\nAdditional analysis to include:\n- Analyze sleep efficiency (minutesAsleep / minutesInSleepPeriod)\n- Evaluate deep+REM ratio (normal: 20-40%)\n- Check per-stage respiratory rate from respiratory-rate-sleep-summary (deep/light/REM breathing rates)\n- Correlate HRV with sleep stages`,
      workout_summary: (a) => `Please compile a summary of my workouts over the past ${a?.days || "7"} days. Use \`list_data_points\` for \`exercise\`, \`active-zone-minutes\`, and \`calories-in-heart-rate-zone\`. Show workout types, total durations, calories burned, and intensity zones.\n\nAdditional analysis to include:\n- Analyze heart rate zone durations per workout (lightTime/moderateTime/vigorousTime/peakTime)\n- Track active zone minutes across sessions\n- Compare pace and heart rate trends over time`,
    };
    const fn = prompts[name];
    if (!fn) throw new Error(`Unknown prompt: ${name}`);
    return {
      description: `Health analysis prompt: ${name}`,
      messages: [{ role: "user", content: { type: "text", text: fn(args) } }],
    };
  });

  return server;
}

// ─── Start ───────────────────────────────────────────────────────────────────

if (process.argv.includes("--http")) {
  const host = process.env.HOST || "127.0.0.1";
  const port = parseInt(process.env.PORT || "3000");
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) { console.error("MCP_API_KEY env var required for HTTP mode"); process.exit(1); }
  const apiBuf = Buffer.from(apiKey);

  // DNS-rebinding protection: only loopback hosts plus an explicit PUBLIC_HOST.
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (process.env.PUBLIC_HOST) allowedHosts.add(process.env.PUBLIC_HOST);

  const json = (res: import("node:http").ServerResponse, status: number, body: any) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };

  createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") return json(res, 200, { status: "ok" });

    const hostName = (req.headers.host || "").split(":")[0].replace(/^\[|\]$/g, "");
    if (!allowedHosts.has(hostName)) return json(res, 403, { error: "Forbidden host" });

    const rawAuth = req.headers.authorization ?? "";
    const token = rawAuth.length > 7 && rawAuth.slice(0, 7).toLowerCase() === "bearer " ? rawAuth.slice(7) : rawAuth;
    const tokenBuf = Buffer.from(token);
    if (tokenBuf.length === 0 || tokenBuf.length !== apiBuf.length || !timingSafeEqual(tokenBuf, apiBuf)) {
      return json(res, 401, { error: "Invalid API key" });
    }

    if (url.pathname === "/mcp") {
      // Stateless mode: fresh transport + server per request, matching the Go
      // implementation (mcp-go's StreamableHTTPServer is stateless).
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createMcpServer();
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }
    json(res, 404, { error: "Not found" });
  }).listen(port, host, () => {
    console.error(`MCP HTTP server listening on http://${host}:${port}/mcp`);
  });
} else {
  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
}
