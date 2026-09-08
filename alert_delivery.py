"""Server-only notification transports. Secrets come exclusively from environment."""
import json
import html
import os
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from email.message import EmailMessage
from pathlib import Path

PUBLIC_PAGE = 'https://yuzora-yu.github.io/Multi-Analyzer/'


def load_local_config():
    """Read only the ignored local file; never expose its contents through HTTP."""
    config_path = Path(os.getenv('MA_EMAIL_CONFIG', str(Path(__file__).resolve().parent / '.runtime' / 'email-config.json')))
    if not config_path.exists():
        return
    config = json.loads(config_path.read_text(encoding='utf-8-sig'))
    mapping = {'host': 'MA_SMTP_HOST', 'port': 'MA_SMTP_PORT', 'user': 'MA_SMTP_USER', 'appPassword': 'MA_SMTP_PASSWORD', 'from': 'MA_EMAIL_FROM', 'to': 'MA_EMAIL_TO'}
    for field, variable in mapping.items():
        value = config.get(field)
        if value is not None and str(value).strip():
            value = str(value).strip()
            if field == 'appPassword': value = value.replace(' ', '')
            os.environ.setdefault(variable, value)


def channels():
    return [name for name, enabled in [
        ('Discord', bool(os.getenv('MA_DISCORD_WEBHOOK'))),
        ('Email', bool(os.getenv('MA_SMTP_HOST') and os.getenv('MA_EMAIL_TO') and os.getenv('MA_EMAIL_FROM') and (not os.getenv('MA_SMTP_USER') or os.getenv('MA_SMTP_PASSWORD'))))
    ] if enabled]


def deliver(payload):
    text = str(payload['text'])[:1800]
    requested = payload.get('channels', channels())
    result = {}
    if 'Discord' in requested and os.getenv('MA_DISCORD_WEBHOOK'):
        url = os.environ['MA_DISCORD_WEBHOOK']
        if not re.fullmatch(r'https://discord\.com/api(?:/v\d+)?/webhooks/\d+/[\w-]+', url):
            result['Discord'] = {'ok': False, 'error': 'Invalid Discord webhook URL', 'permanent': True}
        else:
            req = urllib.request.Request(url + '?wait=true', data=json.dumps({'content': text, 'allowed_mentions': {'parse': []}}).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'MultiAnalyzer/4'}, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=15) as response:
                    response.read(4096)
                result['Discord'] = {'ok': True}
            except urllib.error.HTTPError as e:
                retry = 60
                if e.code == 429:
                    try: retry = max(1, float(json.loads(e.read(4096)).get('retry_after', 60)))
                    except (ValueError, TypeError): pass
                result['Discord'] = {'ok': False, 'error': f'HTTP {e.code}', 'retryAfter': retry, 'permanent': e.code in (400, 401, 403, 404)}
            except Exception:
                result['Discord'] = {'ok': False, 'error': 'Connection failed', 'retryAfter': 60}
    if 'Email' in requested and 'Email' in channels():
        try:
            message = EmailMessage()
            message['Subject'] = str(payload.get('title', 'Multi-Analyzer | Market signal')).replace('\r', ' ').replace('\n', ' ')[:160]
            message['From'] = os.environ['MA_EMAIL_FROM']
            message['To'] = os.environ['MA_EMAIL_TO']
            message.set_content(text)
            url = str(payload.get('url', PUBLIC_PAGE))
            if not (url == PUBLIC_PAGE or url.startswith(PUBLIC_PAGE + '?')): url = PUBLIC_PAGE
            message.add_alternative(f'<html lang="ja"><body style="font-family:sans-serif;line-height:1.7"><h2>{html.escape(message["Subject"])}</h2><p style="white-space:pre-wrap">{html.escape(text)}</p><p><a href="{html.escape(url, quote=True)}">公開チャートを開く</a></p></body></html>', subtype='html')
            port = int(os.getenv('MA_SMTP_PORT', '465'))
            context = ssl.create_default_context()
            smtp_type = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
            args = {'context': context} if port == 465 else {}
            with smtp_type(os.environ['MA_SMTP_HOST'], port, timeout=15, **args) as client:
                if port != 465: client.starttls(context=context)
                if os.getenv('MA_SMTP_USER'): client.login(os.environ['MA_SMTP_USER'], os.environ['MA_SMTP_PASSWORD'])
                client.send_message(message)
            result['Email'] = {'ok': True}
        except Exception:
            result['Email'] = {'ok': False, 'error': 'SMTP delivery failed', 'retryAfter': 120}
    return result


if __name__ == '__main__':
    try:
        load_local_config()
        if '--test' in sys.argv:
            if 'Email' not in channels():
                print('Email is not configured: fill the local email-config.json first.')
                sys.exit(1)
            payload = {'title': 'Multi-Analyzer｜メール接続テスト', 'text': 'メール通知の接続テストです。これは売買推奨ではありません。\n\n今後の通知には銘柄、売買またはクローズ推奨、SL、利確目標、判定理由が表示されます。\n\n公開チャート:\n' + PUBLIC_PAGE, 'url': PUBLIC_PAGE, 'channels': ['Email']}
        else:
            payload = json.loads(sys.stdin.read(8192))
        print(json.dumps(deliver(payload)))
    except Exception:
        print(json.dumps({'error': 'Invalid notification payload'}))
        sys.exit(1)
