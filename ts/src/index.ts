import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { timingSafeEqual } from "crypto";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "google-health-mcp", version: "0.2.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

// ─── Tools ───────────────────────────────────────────────────────────────────

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

// ─── Resources ───────────────────────────────────────────────────────────────

const BASE = "https://health.googleapis.com/v4/users/me";

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

// ─── Prompts ─────────────────────────────────────────────────────────────────

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

// ─── Start ───────────────────────────────────────────────────────────────────

const httpMode = process.argv.includes("--http");

if (httpMode) {
  const host = process.env.HOST || "127.0.0.1";
  const port = parseInt(process.env.PORT || "3000");
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) { console.error("MCP_API_KEY env var required for HTTP mode"); process.exit(1); }
  console.error(`Starting HTTP server on ${host}:${port}`);

  const toolList = Object.entries(tools).map(([name, { description, inputSchema }]) => ({
    name,
    ...(toolMeta[name]?.title ? { title: toolMeta[name].title } : {}),
    description,
    inputSchema,
    ...(toolMeta[name]?.annotations ? { annotations: toolMeta[name].annotations } : {}),
  }));

  Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ status: "ok" });

      const rawAuth = req.headers.get("Authorization") ?? "";
      const token = rawAuth.length > 7 && rawAuth.slice(0, 7).toLowerCase() === "bearer " ? rawAuth.slice(7) : rawAuth;
      const tokenBuf = Buffer.from(token);
      const apiBuf = Buffer.from(apiKey);
      if (tokenBuf.length === 0 || tokenBuf.length !== apiBuf.length || !timingSafeEqual(tokenBuf, apiBuf)) {
        return Response.json({ error: "Invalid API key" }, { status: 401 });
      }

      if (url.pathname === "/mcp" && req.method === "POST") {
        const rpc = await req.json() as any;
        const { id, method, params } = rpc;
        let result: any;

        switch (method) {
          case "initialize":
            result = { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "google-health-mcp", version: "0.2.0" } };
            break;
          case "tools/list":
            result = { tools: toolList };
            break;
          case "tools/call": {
            const tool = tools[params?.name];
            if (!tool) { result = { content: [{ type: "text", text: `ERROR: Unknown tool: ${params?.name}` }], isError: true }; break; }
            result = await tool.handler(auth, params?.arguments || {});
            break;
          }
          case "resources/list":
            result = { resources: [
              { uri: "health://profile", name: "Health Profile", mimeType: "application/json" },
              { uri: "health://settings", name: "Health Settings", mimeType: "application/json" },
              { uri: "health://devices", name: "Paired Devices", mimeType: "application/json" },
            ], resourceTemplates: [
              { uriTemplate: "health://summary/{date}", name: "Daily Summary", description: "Full daily health summary for a date (YYYY-MM-DD)", mimeType: "application/json" },
            ]};
            break;
          case "resources/read": {
            const pathMap: Record<string, string> = { "health://profile": "profile", "health://settings": "settings", "health://devices": "pairedDevices" };
            const uri = params?.uri || "";
            if (uri.startsWith("health://summary/")) {
              const dateStr = uri.slice("health://summary/".length);
              const tool = tools["summary"];
              const res = await tool.handler(auth, { date: dateStr });
              result = { contents: [{ uri, mimeType: "application/json", text: res.content[0].text }] };
              break;
            }
            const p = pathMap[uri];
            if (!p) { result = { contents: [] }; break; }
            const data = await auth.apiGet(`${BASE}/${p}`);
            result = { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
            break;
          }
          case "prompts/list":
            result = { prompts: [
              { name: "health_weekly_review", title: "Weekly Health Review", description: "Comprehensive 7-day health, sleep, and workout review", arguments: [{ name: "end_date", description: "End date in YYYY-MM-DD format (defaults to today)", required: false }] },
              { name: "sleep_quality_analysis", title: "Sleep Quality Analysis", description: "Detailed sleep stages, HRV, and recovery analysis", arguments: [{ name: "days", description: "Number of past days to analyze (default 7)", required: false }] },
              { name: "workout_summary", title: "Workout Summary", description: "Exercise sessions and heart rate zone breakdown", arguments: [{ name: "days", description: "Number of past days to analyze (default 7)", required: false }] },
            ]};
            break;
          case "prompts/get": {
            const promptFns: Record<string, (a: any) => string> = {
              health_weekly_review: (a) => `Please review my health data up to ${a?.end_date || "today"}. Use \`summary\` for the past 7 days to evaluate step trends, sleep duration/stages, resting heart rate, active calories, and overall recovery. Highlight any key trends or anomalies.\n\nAdditional analysis to include:\n- Evaluate sleep stage distribution (deep/REM percentages, sleep efficiency)\n- Analyze HR zone breakdown across activities\n- Check temperature anomalies from daily-sleep-temperature-derivations\n- Review respiratory rate trends from daily-respiratory-rate`,
              sleep_quality_analysis: (a) => `Please analyze my sleep quality for the past ${a?.days || "7"} days. Use \`sync_data_points\` or \`list_data_points\` for \`sleep\`, \`heart-rate-variability\`, and \`daily-resting-heart-rate\`. Detail my sleep efficiency, deep/REM sleep percentages, and HRV trends.\n\nAdditional analysis to include:\n- Analyze sleep efficiency (minutesAsleep / minutesInSleepPeriod)\n- Evaluate deep+REM ratio (normal: 20-40%)\n- Check per-stage respiratory rate from respiratory-rate-sleep-summary (deep/light/REM breathing rates)\n- Correlate HRV with sleep stages`,
              workout_summary: (a) => `Please compile a summary of my workouts over the past ${a?.days || "7"} days. Use \`list_data_points\` for \`exercise\`, \`active-zone-minutes\`, and \`calories-in-heart-rate-zone\`. Show workout types, total durations, calories burned, and intensity zones.\n\nAdditional analysis to include:\n- Analyze heart rate zone durations per workout (lightTime/moderateTime/vigorousTime/peakTime)\n- Track active zone minutes across sessions\n- Compare pace and heart rate trends over time`,
            };
            const fn = promptFns[params?.name];
            if (!fn) { result = { messages: [] }; break; }
            result = { description: `Health analysis prompt: ${params.name}`, messages: [{ role: "user", content: { type: "text", text: fn(params?.arguments) } }] };
            break;
          }
          default:
            return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
        }
        return Response.json({ jsonrpc: "2.0", id, result });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
