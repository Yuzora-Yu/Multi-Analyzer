#!/usr/bin/env python3
"""Local static server + restricted Binance public-data proxy.

No API keys, authentication, trading, or order endpoints are implemented.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any

ROOT = Path(__file__).resolve().parent
ALLOWED_MARKETS = {"spot", "futures"}
ALLOWED_SYMBOLS = {"XAUUSDT", "XAGUSDT", "BTCUSDT", "PAXGUSDT"}
ALLOWED_INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w"}
CACHE: dict[str, tuple[float, bytes, str]] = {}
CACHE_LOCK = Lock()
CACHE_TTL_SECONDS = 3.0
MAX_UPSTREAM_BYTES = 8 * 1024 * 1024


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _safe_int(value: str | None, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(value or default)))
    except (TypeError, ValueError):
        return default


def _fetch_upstream(url: str) -> tuple[bytes, str]:
    now = time.monotonic()
    with CACHE_LOCK:
        cached = CACHE.get(url)
        if cached and now - cached[0] <= CACHE_TTL_SECONDS:
            return cached[1], cached[2]

    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Multi-Analyzer-Ultimate/3.0 (public market-data proxy)",
        },
        method="GET",
    )
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=12, context=context) as response:
        content_type = response.headers.get_content_type()
        body = response.read(MAX_UPSTREAM_BYTES + 1)
        if len(body) > MAX_UPSTREAM_BYTES:
            raise ValueError("Upstream response exceeded the safety limit")
        if content_type not in {"application/json", "text/json", "text/plain"}:
            raise ValueError(f"Unexpected upstream content type: {content_type}")
    with CACHE_LOCK:
        CACHE[url] = (now, body, "application/json; charset=utf-8")
    return body, "application/json; charset=utf-8"


class Handler(SimpleHTTPRequestHandler):
    server_version = "MultiAnalyzerLocal/3.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; connect-src 'self' https://api.binance.com https://fapi.binance.com "
            "wss://stream.binance.com:9443 wss://fstream.binance.com; img-src 'self' data:; worker-src 'self'; frame-ancestors 'none'",
        )
        super().end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._send(status, _json_bytes({"error": message}))

    def _handle_api(self, parsed: urllib.parse.ParseResult) -> None:
        try:
            if parsed.path == "/api/health":
                self._send(HTTPStatus.OK, _json_bytes({"ok": True, "version": "3.0.0", "time": int(time.time() * 1000)}))
                return
            query = urllib.parse.parse_qs(parsed.query)
            market = query.get("market", ["futures"])[0].lower()
            symbol = query.get("symbol", [""])[0].upper()
            if market not in ALLOWED_MARKETS:
                self._error(HTTPStatus.BAD_REQUEST, "Unsupported market")
                return
            if symbol not in ALLOWED_SYMBOLS:
                self._error(HTTPStatus.BAD_REQUEST, "Unsupported symbol")
                return

            if parsed.path == "/api/klines":
                interval = query.get("interval", ["15m"])[0]
                limit = _safe_int(query.get("limit", ["500"])[0], 500, 1, 1500)
                if interval not in ALLOWED_INTERVALS:
                    self._error(HTTPStatus.BAD_REQUEST, "Unsupported interval")
                    return
                endpoint = "https://fapi.binance.com/fapi/v1/klines" if market == "futures" else "https://api.binance.com/api/v3/klines"
                upstream = f"{endpoint}?{urllib.parse.urlencode({'symbol': symbol, 'interval': interval, 'limit': limit})}"
            elif parsed.path == "/api/ticker":
                endpoint = "https://fapi.binance.com/fapi/v1/ticker/bookTicker" if market == "futures" else "https://api.binance.com/api/v3/ticker/bookTicker"
                upstream = f"{endpoint}?{urllib.parse.urlencode({'symbol': symbol})}"
            elif parsed.path == "/api/premium-index" and market == "futures":
                upstream = f"https://fapi.binance.com/fapi/v1/premiumIndex?{urllib.parse.urlencode({'symbol': symbol})}"
            else:
                self._error(HTTPStatus.NOT_FOUND, "Unknown API path")
                return

            body, content_type = _fetch_upstream(upstream)
            self._send(HTTPStatus.OK, body, content_type)
        except urllib.error.HTTPError as exc:
            message = f"Upstream returned HTTP {exc.code}"
            self._error(HTTPStatus.BAD_GATEWAY, message)
        except urllib.error.URLError as exc:
            self._error(HTTPStatus.BAD_GATEWAY, f"Upstream connection failed: {exc.reason}")
        except Exception as exc:  # defensive boundary for a local tool
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Multi-Analyzer Ultimate locally")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000)")
    args = parser.parse_args()
    os.chdir(ROOT)
    mimetypes.add_type("application/javascript", ".js")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Multi-Analyzer Ultimate: http://{args.host}:{args.port}/")
    print("Public market data only. No API key and no order endpoint.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
