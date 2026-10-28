import json
import unittest
from production_monitor import check_production, should_notify


def good_response(url):
    if url.endswith('/health'):
        return 200, {}, json.dumps({'status': 'ok', 'db': 'ok', 'driver': 'postgres'}).encode()
    if url.startswith('http:'):
        return 301, {'location': 'https://app.myariahub.com/signin'}, b''
    if url.endswith('/me'):
        return 401, {}, b'{}'
    return 200, {'content-type': 'text/html', 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff'}, b'<html></html>'


class ProductionMonitorTest(unittest.TestCase):
    def test_healthy_end_to_end_probes(self):
        self.assertTrue(all(r['ok'] for r in check_production(good_response)))

    def test_database_or_proxy_html_is_a_failure(self):
        def response(url):
            return (200, {}, b'<html>proxy error</html>') if url.endswith('/health') else good_response(url)
        failures = [r['check'] for r in check_production(response) if not r['ok']]
        self.assertEqual(failures, ['app_database_health', 'api_database_health'])

    def test_authentication_or_https_regressions_are_failures(self):
        def response(url):
            return (200, {}, b'{}') if url.startswith('http:') or url.endswith('/me') else good_response(url)
        failures = [r['check'] for r in check_production(response) if not r['ok']]
        self.assertEqual(failures, ['http_redirect', 'private_api_authentication'])

    def test_deduplicates_failures_and_reports_recovery(self):
        self.assertTrue(should_notify(True, 'success'))
        self.assertFalse(should_notify(True, 'failure'))
        self.assertTrue(should_notify(False, 'failure'))
        self.assertFalse(should_notify(False, 'success'))
        self.assertTrue(should_notify(False, 'success', True))


if __name__ == '__main__':
    unittest.main()
