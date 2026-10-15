import re
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import Handler


class PublicAssetsTests(unittest.TestCase):
    def test_page_dependencies_are_served_but_private_paths_stay_blocked(self):
        class QuietHandler(Handler):
            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        root = Path(__file__).resolve().parent.parent
        try:
            page = (root / 'index.html').read_text(encoding='utf-8')
            scripts = [s for s in re.findall(r'<script[^>]+src="([^"]+)"', page) if not s.startswith('https:')]
            self.assertIn('market-brief.js?v=1', scripts)
            for script in scripts:
                with self.subTest(script=script), urllib.request.urlopen(base + '/' + script) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), (root / script.split('?')[0]).read_bytes())
            for private in ['/.runtime/test.json', '/.git/config', '/AGENTS.md', '/%2e%2e/AGENTS.md']:
                with self.subTest(private=private), self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(base + private)
                self.assertEqual(error.exception.code, 404)
                error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
