#!/usr/bin/env php
<?php
/**
 * Google Health MCP Server — PHP implementation (partial, like c/ and zig/).
 * MCP JSON-RPC 2.0 over stdio. 39 data types, 15 core tools.
 *
 * Requires: PHP 8.0+ CLI with ext-curl.
 */

declare(strict_types=1);

const BASE_URL = 'https://health.googleapis.com/v4/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RETRY_COUNT = 3;
const PROTOCOL_VERSION = '2025-11-25';
const VERSION = '0.2.0';

// ─── Data Type Registry (39 types) ──────────────────────────────────────────

/** [id, category, time_field, listable, rollup, daily_rollup, writable, page_cap, rollup_range_days, description] */
const DATA_TYPES = [
    ['steps', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Step counts over time intervals.'],
    ['active-energy-burned', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Active calories burned.'],
    ['distance', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Distance (millimeters).'],
    ['active-minutes', 'activity', 'interval_start', true, true, true, false, 10000, 14, 'Active minutes.'],
    ['active-zone-minutes', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Zone minutes.'],
    ['activity-level', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Activity levels.'],
    ['altitude', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Altitude (meters).'],
    ['sedentary-period', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Sedentary periods.'],
    ['swim-lengths-data', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Swim lengths.'],
    ['time-in-heart-rate-zone', 'activity', 'interval_start', true, true, true, false, 10000, 90, 'Time in HR zones.'],
    ['heart-rate', 'cardiac', 'sample_physical', true, true, true, false, 10000, 14, 'Heart rate (BPM).'],
    ['weight', 'body', 'sample_physical', true, true, true, true, 10000, 90, 'Weight (kg).'],
    ['height', 'body', 'sample_physical', true, false, false, false, 10000, 90, 'Height (meters).'],
    ['body-fat', 'body', 'sample_physical', true, true, true, false, 10000, 90, 'Body fat %.'],
    ['blood-glucose', 'nutrition', 'sample_physical', true, true, true, false, 10000, 90, 'Blood glucose.'],
    ['core-body-temperature', 'temperature', 'sample_physical', true, true, true, false, 10000, 90, 'Core temp (C).'],
    ['heart-rate-variability', 'cardiac', 'sample_physical', true, false, false, false, 10000, 90, 'HRV (RMSSD ms).'],
    ['oxygen-saturation', 'oxygen', 'sample_physical', true, false, false, false, 10000, 90, 'SpO2 %.'],
    ['respiratory-rate-sleep-summary', 'respiratory', 'sample_physical', true, false, false, false, 10000, 90, 'Resp rate sleep.'],
    ['vo2-max', 'activity', 'sample_physical', true, false, false, false, 10000, 90, 'VO2 max.'],
    ['run-vo2-max', 'activity', 'sample_physical', true, true, true, false, 10000, 90, 'Run VO2 max.'],
    ['daily-resting-heart-rate', 'cardiac', 'daily', true, false, false, false, 10000, 90, 'Daily resting HR.'],
    ['daily-heart-rate-variability', 'cardiac', 'daily', true, false, false, false, 10000, 90, 'Daily HRV.'],
    ['daily-heart-rate-zones', 'cardiac', 'daily', true, false, false, false, 10000, 90, 'Daily HR zones.'],
    ['daily-oxygen-saturation', 'oxygen', 'daily', true, false, false, false, 10000, 90, 'Daily SpO2.'],
    ['daily-respiratory-rate', 'respiratory', 'daily', true, false, false, false, 10000, 90, 'Daily resp rate.'],
    ['daily-sleep-temperature-derivations', 'sleep', 'daily', true, false, false, false, 10000, 90, 'Sleep temp.'],
    ['daily-vo2-max', 'activity', 'daily', true, false, false, false, 10000, 90, 'Daily VO2 max.'],
    ['sleep', 'sleep', 'interval_end', true, false, false, true, 25, 90, 'Sleep sessions.'],
    ['exercise', 'activity', 'interval_civil_start', true, false, false, true, 25, 90, 'Exercise sessions.'],
    ['hydration-log', 'nutrition', 'interval_civil_start', true, true, true, true, 10000, 90, 'Hydration events.'],
    ['nutrition-log', 'nutrition', 'interval_civil_start', true, true, true, true, 10000, 90, 'Meal events.'],
    ['irregular-rhythm-notification', 'clinical', 'interval_civil_start', true, false, false, false, 10000, 90, 'AFib notifications.'],
    ['electrocardiogram', 'clinical', 'interval_start', true, false, false, false, 10000, 90, 'ECG recordings.'],
    ['food', 'nutrition', 'none', true, false, false, false, 10000, 90, 'Food catalog.'],
    ['food-measurement-unit', 'nutrition', 'none', true, false, false, false, 10000, 90, 'Food units.'],
    ['floors', 'activity', 'interval_start', false, true, true, false, 10000, 90, 'Floors climbed.'],
    ['total-calories', 'nutrition', 'interval_start', false, true, true, false, 10000, 14, 'Total calories.'],
    ['calories-in-heart-rate-zone', 'cardiac', 'interval_start', false, true, true, false, 10000, 14, 'Calories per zone.'],
];

const TOOLS = [
    ['list_data_types', 'List all 39 supported Google Health API v4 data types.'],
    ['describe_data_type', 'Get detailed info about a data type.'],
    ['list_data_points', 'List data points with AIP-160 filters.'],
    ['get_data_point', 'Get a single data point by ID.'],
    ['get_profile', 'Get user profile.'],
    ['get_settings', 'Get user settings.'],
    ['get_identity', 'Get user identity.'],
    ['list_paired_devices', 'List paired devices.'],
    ['get_irn_profile', 'Get IRN profile.'],
    ['clear_cache', 'Clear response cache.'],
    ['today', 'Full health summary for today.'],
    ['yesterday', 'Full health summary for yesterday.'],
    ['summary', 'Full health summary for a date.'],
    ['add_weight_sample', 'Add weight in kg.'],
    ['export_exercise_tcx', 'Export exercise as TCX.'],
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function filterName(string $id): string
{
    return str_replace('-', '_', $id);
}

function timeFieldSuffix(string $tf): string
{
    return match ($tf) {
        'interval_start' => 'interval.start_time',
        'interval_civil_start' => 'interval.civil_start_time',
        'interval_end' => 'interval.end_time',
        'sample_physical' => 'sample_time.physical_time',
        'daily' => 'date',
        default => '',
    };
}

function isSegment(string $s): bool
{
    return (bool)preg_match('/^[A-Za-z0-9_-]{1,256}$/', $s);
}

// ─── Auth / HTTP ─────────────────────────────────────────────────────────────

final class Auth
{
    public ?string $accessToken = null;
    public int $expiresAt = 0;

    public function __construct(
        private string $clientId,
        private string $clientSecret,
        private string $refreshToken,
    ) {}

    public static function fromEnv(): ?self
    {
        $cid = getenv('GOOGLE_CLIENT_ID');
        $csec = getenv('GOOGLE_CLIENT_SECRET');
        $rtok = getenv('GOOGLE_REFRESH_TOKEN');
        if (!$cid || !$csec || !$rtok) {
            return null;
        }
        return new self($cid, $csec, $rtok);
    }

    private function refresh(): ?string
    {
        $resp = $this->request('POST', TOKEN_URL, [
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'refresh_token' => $this->refreshToken,
            'grant_type' => 'refresh_token',
        ], false);
        if ($resp === null) {
            return null;
        }
        $data = json_decode($resp, true);
        $token = $data['access_token'] ?? null;
        if (!is_string($token)) {
            return null;
        }
        $this->accessToken = $token;
        $this->expiresAt = time() + (int)($data['expires_in'] ?? 3600);
        return $token;
    }

    public function token(): ?string
    {
        if ($this->accessToken !== null && time() + 60 < $this->expiresAt) {
            return $this->accessToken;
        }
        return $this->refresh();
    }

    /** @param array<string,string>|null $fields POST form fields; $json JSON body for API calls */
    private function request(string $method, string $url, ?array $fields = null, bool $apiJson = true): ?string
    {
        $ch = curl_init($url);
        $headers = [];
        if ($apiJson) {
            $headers[] = 'Authorization: Bearer ' . $this->token();
            if ($method !== 'GET') {
                $headers[] = 'Content-Type: application/json';
            }
        } else {
            $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CUSTOMREQUEST => $method,
        ]);
        if ($fields !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $apiJson ? json_encode($fields) : http_build_query($fields));
        }
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_errno($ch);
        curl_close($ch);
        if ($err || !is_string($body)) {
            return null;
        }
        return $code >= 200 && $code < 300 ? $body : null;
    }

    public function apiCall(string $method, string $url, ?string $jsonBody = null): ?string
    {
        $delays = [500_000, 1_500_000, 4_000_000]; // microseconds
        for ($attempt = 0; $attempt <= RETRY_COUNT; $attempt++) {
            if ($this->token() === null) {
                if ($attempt < RETRY_COUNT) {
                    usleep($delays[$attempt]);
                    continue;
                }
                return null;
            }

            $ch = curl_init($url);
            $headers = ['Authorization: Bearer ' . $this->accessToken];
            if ($jsonBody !== null) {
                $headers[] = 'Content-Type: application/json';
            }
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_CUSTOMREQUEST => $method,
            ]);
            if ($jsonBody !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonBody);
            }
            $body = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $err = curl_errno($ch);
            curl_close($ch);

            if ($err || !is_string($body)) {
                if ($attempt < RETRY_COUNT) {
                    usleep($delays[$attempt]);
                    continue;
                }
                return null;
            }
            if ($code === 401) {
                $this->accessToken = null;
                $this->expiresAt = 0;
                if ($this->refresh() === null) {
                    return null;
                }
                continue;
            }
            if ($code >= 200 && $code < 300) {
                return $body;
            }
            if (($code === 429 || $code >= 500) && $attempt < RETRY_COUNT) {
                usleep($delays[$attempt]);
                continue;
            }
            return null;
        }
        return null;
    }
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

function handleListDataTypes(): string
{
    $types = [];
    foreach (DATA_TYPES as [$id, $cat, $tf, $listable, $rollup, $dr, $writable, $cap, $days, $desc]) {
        $types[] = [
            'id' => $id,
            'filter_name' => filterName($id),
            'category' => $cat,
            'listable' => $listable,
            'rollup' => $rollup,
            'daily_rollup' => $dr,
            'writable' => $writable,
            'time_field' => $tf,
            'page_cap' => $cap,
            'rollup_range_days' => $days,
            'description' => $desc,
        ];
    }
    return json_encode(['count' => count(DATA_TYPES), 'total' => count(DATA_TYPES), 'data_types' => $types]);
}

function handleDescribeDataType(string $typeId): string
{
    foreach (DATA_TYPES as [$id, $cat, $tf, $listable, $rollup, $dr, $writable, $cap, $days, $desc]) {
        if ($id === $typeId) {
            $out = [
                'id' => $id,
                'filter_name' => filterName($id),
                'category' => $cat,
                'listable' => $listable,
                'rollup' => $rollup,
                'daily_rollup' => $dr,
                'writable' => $writable,
                'time_field' => $tf,
                'page_cap' => $cap,
                'rollup_range_days' => $days,
                'description' => $desc,
            ];
            $suffix = timeFieldSuffix($tf);
            if ($suffix !== '') {
                $out['filter_field'] = filterName($id) . '.' . $suffix;
            }
            return json_encode($out);
        }
    }
    return '{"error":"Unknown data type. Use list_data_types."}';
}

function apiGet(?Auth $auth, string $path): string
{
    if ($auth === null) {
        return '{"error":"GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not configured"}';
    }
    return $auth->apiCall('GET', BASE_URL . '/' . $path) ?? '{"error":"API request failed"}';
}

function getStr(array $args, string $key): ?string
{
    $v = $args[$key] ?? null;
    return is_string($v) ? $v : null;
}

function handleListDataPoints(?Auth $auth, array $args): string
{
    $dt = getStr($args, 'data_type');
    if ($dt === null) {
        return '{"error":"Missing data_type"}';
    }
    if (!isSegment($dt)) {
        return '{"error":"Invalid data_type"}';
    }
    $url = BASE_URL . '/dataTypes/' . $dt . '/dataPoints';
    $filter = getStr($args, 'filter');
    if ($filter !== null) {
        $url .= '?filter=' . urlencode($filter);
    }
    if ($auth === null) {
        return '{"error":"GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not configured"}';
    }
    return $auth->apiCall('GET', $url) ?? '{"error":"API request failed"}';
}

function handleGetDataPoint(?Auth $auth, array $args): string
{
    $dt = getStr($args, 'data_type');
    $id = getStr($args, 'data_point_id');
    if ($dt === null) {
        return '{"error":"Missing data_type"}';
    }
    if ($id === null) {
        return '{"error":"Missing data_point_id"}';
    }
    if (!isSegment($dt) || !isSegment($id)) {
        return '{"error":"Invalid data_type or data_point_id"}';
    }
    return apiGet($auth, "dataTypes/$dt/dataPoints/$id");
}

function handleExportTcx(?Auth $auth, array $args): string
{
    $id = getStr($args, 'data_point_id');
    if ($id === null) {
        return '{"error":"Missing data_point_id"}';
    }
    if (!isSegment($id)) {
        return '{"error":"Invalid data_point_id"}';
    }
    return apiGet($auth, "dataTypes/exercise/dataPoints/$id:exportExerciseTcx?alt=media");
}

function handleAddWeight(?Auth $auth, array $args): string
{
    $kg = $args['weight_kg'] ?? null;
    if (!is_int($kg) && !is_float($kg)) {
        return '{"error":"Missing weight_kg"}';
    }
    if ($kg <= 0 || $kg > 500) {
        return '{"error":"weight_kg must be between 0 and 500 kg"}';
    }
    $grams = (int)round($kg * 1000);
    $ts = gmdate('Y-m-d\TH:i:s\Z');
    $body = json_encode(['weight' => [
        'sampleTime' => ['physicalTime' => $ts, 'utcOffset' => '0s'],
        'weightGrams' => $grams,
    ]]);
    if ($auth === null) {
        return '{"error":"GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not configured"}';
    }
    return $auth->apiCall('POST', BASE_URL . '/dataTypes/weight/dataPoints', $body)
        ?? '{"error":"API request failed"}';
}

function dispatchTool(?Auth $auth, string $name, array $args): string
{
    return match ($name) {
        'list_data_types' => handleListDataTypes(),
        'describe_data_type' => ($id = getStr($args, 'data_type')) !== null
            ? handleDescribeDataType($id)
            : '{"error":"Missing data_type"}',
        'list_data_points' => handleListDataPoints($auth, $args),
        'get_data_point' => handleGetDataPoint($auth, $args),
        'get_profile' => apiGet($auth, 'profile'),
        'get_settings' => apiGet($auth, 'settings'),
        'get_identity' => apiGet($auth, 'identity'),
        'list_paired_devices' => apiGet($auth, 'pairedDevices'),
        'get_irn_profile' => apiGet($auth, 'irnProfile'),
        'clear_cache' => '{"success":true,"message":"Cache cleared"}',
        'add_weight_sample' => handleAddWeight($auth, $args),
        'export_exercise_tcx' => handleExportTcx($auth, $args),
        'today', 'yesterday', 'summary' => '{"info":"Daily summary requires multiple parallel API calls. Use Rust/Go/Python for full implementation."}',
        default => json_encode(['error' => "Unknown tool: $name"]),
    };
}

// ─── MCP JSON-RPC dispatch ──────────────────────────────────────────────────

/* Build the full JSON-RPC response line for `$line`; null for notifications.
 * Result JSON is emitted verbatim — a decode/re-encode would turn {} into []. */
function buildResponse(?Auth $auth, string $line): ?string
{
    $req = json_decode($line, true);
    if (!is_array($req)) {
        return '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}';
    }
    $idJson = json_encode($req['id'] ?? null);
    $method = $req['method'] ?? null;
    if (!is_string($method)) {
        return '{"jsonrpc":"2.0","id":' . $idJson . ',"error":{"code":-32600,"message":"Missing method"}}';
    }
    $params = is_array($req['params'] ?? null) ? $req['params'] : [];

    switch ($method) {
        case 'initialize':
            $result = json_encode([
                'protocolVersion' => PROTOCOL_VERSION,
                'capabilities' => ['tools' => new stdClass(), 'resources' => new stdClass(), 'prompts' => new stdClass()],
                'serverInfo' => ['name' => 'google-health-mcp', 'version' => VERSION],
            ]);
            break;
        case 'notifications/initialized':
            return null;
        case 'tools/list':
            $tools = [];
            foreach (TOOLS as [$name, $desc]) {
                $tools[] = [
                    'name' => $name,
                    'description' => $desc,
                    'inputSchema' => ['type' => 'object', 'properties' => new stdClass()],
                ];
            }
            $result = json_encode(['tools' => $tools]);
            break;
        case 'tools/call':
            $toolName = $params['name'] ?? '';
            $toolArgs = is_array($params['arguments'] ?? null) ? $params['arguments'] : [];
            $out = dispatchTool($auth, is_string($toolName) ? $toolName : '', $toolArgs);
            $result = json_encode(['content' => [['type' => 'text', 'text' => $out]]]);
            break;
        default:
            return '{"jsonrpc":"2.0","id":' . $idJson . ',"error":{"code":-32601,"message":"Method not found"}}';
    }
    return '{"jsonrpc":"2.0","id":' . $idJson . ',"result":' . $result . '}';
}

// ─── Minimal HTTP transport: POST /mcp, Bearer MCP_API_KEY auth ─────────────
// Single-threaded, one request per connection. No SSE/sessions — partial impl.

function httpReply($conn, int $code, string $status, string $body = ''): void
{
    fwrite($conn, "HTTP/1.1 $code $status\r\nContent-Type: application/json\r\n" .
        'Content-Length: ' . strlen($body) . "\r\nConnection: close\r\n\r\n" . $body);
}

function serveHttp(?Auth $auth, string $host, int $port, string $apiKey): int
{
    $srv = @stream_socket_server("tcp://$host:$port", $errno, $errstr);
    if ($srv === false) {
        fwrite(STDERR, "bind/listen failed: $errstr\n");
        return 1;
    }
    fwrite(STDERR, "google-health-mcp (PHP) — HTTP mode on $host:$port/mcp\n");

    while (($conn = @stream_socket_accept($srv, -1)) !== false) {
        $req = '';
        $bodyStart = 0;
        $wantBody = 0;
        $headersDone = false;
        while (strlen($req) < 1024 * 1024) {
            if (!$headersDone && ($pos = strpos($req, "\r\n\r\n")) !== false) {
                $headersDone = true;
                $bodyStart = $pos + 4;
                if (preg_match('/\nContent-Length:\s*(\d+)/i', substr($req, 0, $pos), $m)) {
                    $wantBody = (int)$m[1];
                }
            }
            if ($headersDone && strlen($req) - $bodyStart >= $wantBody) {
                break;
            }
            $chunk = fread($conn, 65536);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $req .= $chunk;
        }

        if (!preg_match('/^(\S+)\s+(\S+)/', $req, $m)) {
            fclose($conn);
            continue;
        }
        [, $method, $path] = $m;
        if ($method !== 'POST') {
            httpReply($conn, 405, 'Method Not Allowed', '{"error":"POST only"}');
            fclose($conn);
            continue;
        }
        if ($path !== '/mcp' && $path !== '/') {
            httpReply($conn, 404, 'Not Found', '{"error":"not found"}');
            fclose($conn);
            continue;
        }
        $provided = null;
        if (preg_match('/\nAuthorization:\s*Bearer\s+([^\r\n]+)/i', $req, $am)) {
            $provided = rtrim($am[1]);
        }
        if ($provided === null || !hash_equals($apiKey, $provided)) {
            httpReply($conn, 401, 'Unauthorized', '{"error":"unauthorized"}');
            fclose($conn);
            continue;
        }

        $body = $headersDone ? substr($req, $bodyStart) : '';
        $resp = buildResponse($auth, $body);
        if ($resp === null) {
            httpReply($conn, 202, 'Accepted');
        } else {
            httpReply($conn, 200, 'OK', $resp);
        }
        fclose($conn);
    }
    return 0;
}

// ─── Main ───────────────────────────────────────────────────────────────────

$auth = Auth::fromEnv();
if ($auth === null) {
    fwrite(STDERR, "Warning: GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not set. API tools will not work.\n");
}
if (in_array('--http', $argv ?? [], true)) {
    $apiKey = getenv('MCP_API_KEY');
    if (!$apiKey) {
        fwrite(STDERR, "MCP_API_KEY env var required for --http mode\n");
        exit(1);
    }
    $host = getenv('HOST') ?: '127.0.0.1';
    $port = (int)(getenv('PORT') ?: 3000);
    exit(serveHttp($auth, $host, $port > 0 ? $port : 3000, $apiKey));
}

fwrite(STDERR, 'google-health-mcp (PHP) — stdio mode, ' . count(DATA_TYPES) . ' types, ' . count(TOOLS) . " tools\n");

while (($line = fgets(STDIN)) !== false) {
    $line = rtrim($line, "\r\n");
    if ($line === '') {
        continue;
    }
    $resp = buildResponse($auth, $line);
    if ($resp !== null) {
        fwrite(STDOUT, $resp . "\n");
        fflush(STDOUT);
    }
}
