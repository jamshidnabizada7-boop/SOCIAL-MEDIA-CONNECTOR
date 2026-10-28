"""Oracle-local component/backup checks with SMTP state-change notifications."""
import datetime
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
from production_monitor import send_alert

ROOT = pathlib.Path('/opt/ariahub-v2')
STATE = pathlib.Path('/var/lib/ariahub-v2-monitor/state.json')


def command(args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=45, cwd=ROOT)
    if result.returncode:
        raise RuntimeError('Component check failed')
    return result.stdout.strip()


def collect():
    results = []

    def check(name, fn):
        try:
            results.append({'check': name, 'ok': bool(fn())})
        except Exception:
            results.append({'check': name, 'ok': False})

    for service in ['ariahub-v2-tunnel.service', 'ariahub-v2-backup.timer']:
        check(service, lambda name=service: command(['systemctl', 'is-active', name]) == 'active')
    check('backup_timer_enabled', lambda: command(['systemctl', 'is-enabled', 'ariahub-v2-backup.timer']) == 'enabled')
    check('last_backup_service', lambda: command(['systemctl', 'show', 'ariahub-v2-backup.service', '-p', 'Result', '--value']) == 'success')

    def fresh_backup():
        snapshots = sorted(p for p in (ROOT / 'backups').iterdir() if p.is_dir() and re.fullmatch(r'backup-\d{8}T\d{6}Z', p.name) and (p / 'SHA256SUMS').is_file())
        stamp = datetime.datetime.strptime(snapshots[-1].name, 'backup-%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
        age = (datetime.datetime.now(datetime.timezone.utc) - stamp).total_seconds()
        return 0 <= age < 36 * 3600

    check('backup_fresh_within_36_hours', fresh_backup)
    check('disk_free_above_2_gib', lambda: shutil.disk_usage(ROOT).free > 2 * 1024**3)
    compose = ['docker', 'compose', '-f', 'deploy/docker-compose.prod.yml', '--env-file', '.env']

    def containers():
        raw = command(compose + ['ps', '--format', 'json'])
        rows = json.loads(raw) if raw.startswith('[') else [json.loads(line) for line in raw.splitlines() if line]
        by_service = {r['Service']: r for r in rows}
        return all(by_service.get(s, {}).get('State') == 'running' and (s == 'caddy' or by_service[s].get('Health') == 'healthy') for s in ['api', 'worker', 'web', 'postgres', 'caddy'])

    check('runtime_containers', containers)

    def publishing_health():
        source = "import {createDatabase} from '/app/packages/db/dist/index.js';import {createOperationsMonitor} from '/app/apps/worker/src/alerts.ts';const h=await createDatabase();try{const alerts=[];await createOperationsMonitor(a=>alerts.push(a))(h.db);console.log(JSON.stringify({healthy:alerts.length===0}));}finally{await h.close();}"
        result = command(compose + ['exec', '-T', 'api', 'node', '--import', 'tsx', '--input-type=module'], source)
        return json.loads(result)['healthy']

    check('provider_circuits_and_publish_failure_rate', publishing_health)
    return results


def failure_codes(results):
    return sorted(r['check'] for r in results if not r['ok'])


def main():
    results = collect()
    previous = []
    try:
        previous = json.loads(STATE.read_text()).get('failureCodes', [])
    except (FileNotFoundError, ValueError):
        pass
    failures = failure_codes(results)
    notify = failures != previous
    if notify:
        for line in (ROOT / '.env').read_text().splitlines():
            if line.startswith('SMTP_URL='):
                os.environ['ARIA_MONITOR_SMTP_URL'] = ' '.join(shlex.split(line.split('=', 1)[1], comments=False))
        send_alert(results)
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = STATE.with_suffix('.new')
    temporary.write_text(json.dumps({'failureCodes': failures, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
    temporary.chmod(0o600)
    temporary.replace(STATE)
    print(json.dumps({'checks': results, 'notificationAccepted': notify}))
    return 1 if failures else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'monitorFailed': True, 'errorClass': type(error).__name__}), file=sys.stderr)
        sys.exit(2)
