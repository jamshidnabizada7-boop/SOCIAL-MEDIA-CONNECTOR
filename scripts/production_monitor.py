"""External, credential-free health probes; SMTP notifications on state changes."""
import argparse
import datetime
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from zoneinfo import ZoneInfo

APP = 'https://app.myariahub.com'
API = 'https://api.myariahub.com'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, headers=None):
    opener = urllib.request.build_opener(NoRedirect())
    request_headers = {'User-Agent': 'Mozilla/5.0 (compatible; AriaHubMonitor/1.0; +https://app.myariahub.com)', 'Accept': 'application/json,text/html;q=0.9,*/*;q=0.8'}
    request_headers.update(headers or {})
    req = urllib.request.Request(url, headers=request_headers)
    try:
        response = opener.open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.code, {k.lower(): v for k, v in response.headers.items()}, response.read(1024 * 1024)


def check_production(fetch=request):
    results = []

    def check(name, callback):
        try:
            if not callback():
                raise ValueError('Unexpected response')
            results.append({'check': name, 'ok': True})
        except Exception as error:
            # Do not include response bodies, credentials, or exception URLs.
            results.append({'check': name, 'ok': False, 'error': type(error).__name__})

    def health(base):
        status, _, body = fetch(base + '/health')
        data = json.loads(body)
        return status == 200 and data.get('status') == 'ok' and data.get('db') == 'ok' and data.get('driver') == 'postgres'

    def web():
        status, headers, _ = fetch(APP + '/signin')
        return status == 200 and 'text/html' in headers.get('content-type', '') and 'max-age=' in headers.get('strict-transport-security', '') and headers.get('x-content-type-options') == 'nosniff'

    def redirect():
        status, headers, _ = fetch('http://app.myariahub.com/signin')
        return status in (301, 308) and headers.get('location') == APP + '/signin'

    check('app_database_health', lambda: health(APP))
    check('api_database_health', lambda: health(API))
    check('web_https_and_headers', web)
    check('http_redirect', redirect)
    check('private_api_authentication', lambda: fetch(APP + '/v1/auth/me')[0] == 401)
    return results


def previous_conclusion():
    repository = os.getenv('GITHUB_REPOSITORY')
    token = os.getenv('GITHUB_TOKEN')
    if not repository or not token:
        return None
    url = f'https://api.github.com/repos/{repository}/actions/workflows/production-health.yml/runs?per_page=5&branch=master'
    try:
        status, _, body = request(url, {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
        if status != 200:
            return None
        for run in json.loads(body).get('workflow_runs', []):
            if str(run['id']) != os.getenv('GITHUB_RUN_ID') and run.get('status') == 'completed' and run.get('conclusion') in ('success', 'failure'):
                return run['conclusion']
    except Exception:
        return None
    return None


def should_notify(failed, previous, test_alert=False):
    return test_alert or (failed and previous != 'failure') or (not failed and previous == 'failure')


def send_alert(results, test_alert=False):
    raw = os.environ.get('ARIA_MONITOR_SMTP_URL', '')
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme not in ('smtp', 'smtps') or not parsed.hostname or not parsed.username or not parsed.password:
        raise ValueError('SMTP notification credentials are not configured')
    failed = [result['check'] for result in results if not result['ok']]
    outcome = 'Monitoring test' if test_alert else 'Production failure' if failed else 'Production recovered'
    message = EmailMessage()
    message['From'] = 'ARIA HUB <accounts@myariahub.com>'
    message['To'] = 'info@myariahub.com'
    message['Reply-To'] = 'info@myariahub.com'
    message['Subject'] = '[Aria Hub] ' + outcome
    now = datetime.datetime.now(ZoneInfo('Asia/Karachi')).isoformat(timespec='seconds')
    message.set_content(f'{outcome}\nTime: {now}\n\n' + '\n'.join(f"{r['check']}: {'PASS' if r['ok'] else 'FAIL'}" for r in results) + '\n\nThis monitor sends a notification for a new failure or recovery. It does not publish social content or access private customer data.\n')
    port = parsed.port or (465 if parsed.scheme == 'smtps' else 587)
    context = ssl.create_default_context()
    if parsed.scheme == 'smtps':
        server = smtplib.SMTP_SSL(parsed.hostname, port, timeout=20, context=context)
    else:
        server = smtplib.SMTP(parsed.hostname, port, timeout=20)
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
    with server:
        server.login(urllib.parse.unquote(parsed.username), urllib.parse.unquote(parsed.password))
        rejected = server.send_message(message)
        if rejected:
            raise RuntimeError('SMTP rejected the monitoring notification')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--test-alert', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    results = check_production()
    failed = any(not item['ok'] for item in results)
    notify = not args.check_only and should_notify(failed, previous_conclusion(), args.test_alert)
    alert_accepted = False
    if notify:
        try:
            send_alert(results, args.test_alert)
            alert_accepted = True
        except Exception as error:
            print(json.dumps({'notificationAccepted': False, 'errorClass': type(error).__name__}), file=sys.stderr)
            return 2
    print(json.dumps({'checks': results, 'notificationAccepted': alert_accepted, 'testAlert': args.test_alert}))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
