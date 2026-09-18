import http.server
import json
import os
import sys
import urllib.parse
import urllib.request
import webbrowser

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # Fallback: parse .env manually (KEY=VALUE lines).
    if os.path.exists(".env"):
        with open(".env") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "YOUR_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "YOUR_CLIENT_SECRET")
if CLIENT_ID == "YOUR_CLIENT_ID" or CLIENT_SECRET == "YOUR_CLIENT_SECRET":
    print("ERROR: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (see .env.example)")
    sys.exit(1)
REDIRECT_URI = "http://localhost:8086/callback"
SCOPE = " ".join([  # noqa: FLY002 - 16 items stay readable as a list
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
    sys.exit(1)

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
    # Token file contains a refresh token — owner-read/write only.
    fd = os.open("health_token.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(resp, f, indent=2)
    print("Saved to health_token.json (mode 0600)")
else:
    print("ERROR:", resp)
