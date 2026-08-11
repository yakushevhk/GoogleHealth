import http.server
import urllib.parse
import webbrowser
import json
import urllib.request
import ssl

CLIENT_ID = "YOUR_CLIENT_ID"
CLIENT_SECRET = "YOUR_CLIENT_SECRET"
REDIRECT_URI = "http://localhost:8086/callback"
SCOPE = " ".join([
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.writeonly",
    "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
    "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
    "https://www.googleapis.com/auth/googlehealth.location.readonly",
    "https://www.googleapis.com/auth/googlehealth.ecg.readonly",
    "https://www.googleapis.com/auth/googlehealth.irn.readonly",
    "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    "https://www.googleapis.com/auth/googlehealth.profile.writeonly",
    "https://www.googleapis.com/auth/googlehealth.settings.readonly",
    "https://www.googleapis.com/auth/googlehealth.settings.writeonly",
])

auth_url = (
    f"https://accounts.google.com/o/oauth2/v2/auth?"
    f"client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&response_type=code"
    f"&scope={urllib.parse.quote(SCOPE)}&access_type=offline&prompt=consent"
)

code = None

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global code
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        code = params.get("code", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>Done! Close this tab.</h1>")

    def log_message(self, format, *args):
        pass

print("Opening browser for Google Health API authorization...")
webbrowser.open(auth_url)

server = http.server.HTTPServer(("localhost", 8086), Handler)
server.handle_request()

if not code:
    print("ERROR: No code received")
    exit(1)

data = urllib.parse.urlencode({
    "code": code,
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "redirect_uri": REDIRECT_URI,
    "grant_type": "authorization_code",
}).encode()

req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
resp = json.loads(urllib.request.urlopen(req).read())

if "refresh_token" in resp:
    print(f"\nGOOGLE_REFRESH_TOKEN={resp['refresh_token']}")
    with open("health_token.json", "w") as f:
        json.dump(resp, f, indent=2)
    print("Saved to health_token.json")
else:
    print("ERROR:", resp)
