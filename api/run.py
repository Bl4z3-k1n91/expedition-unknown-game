import json
from http.server import BaseHTTPRequestHandler

from api.ml_pipeline import run_request


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            status, payload = run_request(body)
        except Exception as error:
            status, payload = 500, {"error": f"Forecast pipeline failed: {error}"}
        encoded = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
