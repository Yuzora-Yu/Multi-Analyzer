import io
import os
import unittest
import urllib.error
from unittest.mock import patch, MagicMock
import alert_delivery


class DeliveryTests(unittest.TestCase):
    def test_unconfigured_never_sends(self):
        with patch.dict(os.environ, {}, clear=True), patch('urllib.request.urlopen') as send:
            self.assertEqual(alert_delivery.deliver({'text': 'test'}), {})
            send.assert_not_called()

    def test_discord_mentions_disabled_and_wait_confirmed(self):
        with patch.dict(os.environ, {'MA_DISCORD_WEBHOOK': 'https://discord.com/api/webhooks/123/token'}, clear=True), patch('urllib.request.urlopen') as send:
            self.assertTrue(alert_delivery.deliver({'text': '@everyone test'})['Discord']['ok'])
            req = send.call_args.args[0]
            self.assertTrue(req.full_url.endswith('?wait=true'))
            self.assertIn(b'"parse": []', req.data)

    def test_discord_rate_limit_preserved(self):
        error = urllib.error.HTTPError('https://discord.com', 429, '', {}, io.BytesIO(b'{"retry_after":75}'))
        with patch.dict(os.environ, {'MA_DISCORD_WEBHOOK': 'https://discord.com/api/webhooks/123/token'}, clear=True), patch('urllib.request.urlopen', side_effect=error):
            result = alert_delivery.deliver({'text': 'test'})['Discord']
            self.assertFalse(result['ok'])
            self.assertEqual(result['retryAfter'], 75)

    def test_arbitrary_webhook_host_rejected(self):
        with patch.dict(os.environ, {'MA_DISCORD_WEBHOOK': 'https://example.com/secret'}, clear=True), patch('urllib.request.urlopen') as send:
            self.assertTrue(alert_delivery.deliver({'text': 'test'})['Discord']['permanent'])
            send.assert_not_called()

    def test_smtp_starttls_required(self):
        env = {'MA_SMTP_HOST': 'smtp.example.com', 'MA_SMTP_PORT': '587', 'MA_EMAIL_FROM': 'a@example.com', 'MA_EMAIL_TO': 'b@example.com'}
        with patch.dict(os.environ, env, clear=True), patch('smtplib.SMTP') as smtp:
            self.assertTrue(alert_delivery.deliver({'text': 'test'})['Email']['ok'])
            smtp.return_value.__enter__.return_value.starttls.assert_called_once()

    def test_email_has_subject_plain_text_and_public_link(self):
        env = {'MA_SMTP_HOST': 'smtp.example.com', 'MA_SMTP_PORT': '465', 'MA_EMAIL_FROM': 'a@example.com', 'MA_EMAIL_TO': 'b@example.com'}
        with patch.dict(os.environ, env, clear=True), patch('smtplib.SMTP_SSL') as smtp:
            result = alert_delivery.deliver({'title': 'Gold 買い候補', 'text': 'SL: 100\nTP: 110', 'url': alert_delivery.PUBLIC_PAGE + '?asset=gold&tf=15m'})
            self.assertTrue(result['Email']['ok'])
            msg = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
            self.assertEqual(msg['Subject'], 'Gold 買い候補')
            self.assertIn('SL: 100', msg.get_body(preferencelist=('plain',)).get_content())
            self.assertIn('yuzora-yu.github.io/Multi-Analyzer/', msg.get_body(preferencelist=('html',)).get_content())

    def test_gmail_missing_password_not_ready(self):
        env = {'MA_SMTP_HOST': 'smtp.gmail.com', 'MA_SMTP_USER': 'a@gmail.com', 'MA_EMAIL_FROM': 'a@gmail.com', 'MA_EMAIL_TO': 'b@example.com'}
        with patch.dict(os.environ, env, clear=True):
            self.assertNotIn('Email', alert_delivery.channels())


if __name__ == '__main__':
    unittest.main()
