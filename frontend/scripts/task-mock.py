#!/usr/bin/env python3
"""Phase-two HTTP fixture. Only Python's standard library is required."""
import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit, unquote

records = []
lock = threading.Lock()
SECRET = re.compile(r'authorization|cookie|set-cookie|token|password|secret', re.I)


def scrub(value):
    if isinstance(value, dict):
        return {k: '***' if SECRET.search(k) else scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not write URLs or credentials to access logs.

    def reply(self, status, body, headers=None):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_request(self):
        url = urlsplit(self.path)
        if url.path == '/records':
            with lock:
                if self.command == 'DELETE':
                    records.clear()
                result = list(records)
            return self.reply(200, result)
        query = parse_qs(url.query, keep_blank_values=True)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length > 1024 * 1024:
                return self.reply(413, {'error': 'body too large'})
            raw = self.rfile.read(length)
            body = json.loads(raw) if raw else None
            delay = float(query.get('delay', ['0'])[0])
            status = int(query.get('status', ['200'])[0])
            if not 0 <= delay <= 310 or not 100 <= status <= 599:
                raise ValueError()
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {'error': 'invalid body, delay or status'})
        with lock:
            record = {'sequence': len(records) + 1, 'method': self.command, 'path': unquote(url.path), 'encoded_path': url.path,
                      'query': scrub(query), 'headers': scrub(dict(self.headers)), 'body': scrub(body)}
            records.append(record)
        if url.path == '/mock/disconnect':
            self.close_connection = True
            return
        if url.path == '/mock/redirect':
            return self.reply(302, {'redirect': True}, {'Location': '/mock/finish'})
        time.sleep(delay)
        self.reply(status, {'received': record}, {'Set-Cookie': 'fixture-session=sample'})

    do_GET = handle_request
    do_POST = handle_request
    do_DELETE = handle_request
    do_PUT = handle_request
    do_PATCH = handle_request


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=31013)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    print(f'Task fixture: http://{args.host}:{args.port}/mock (records: /records)', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
