"""Synthetic regression tests; no connection and no credentials."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('bancho-readonly.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProtocolTests(unittest.TestCase):
    def test_tags_spaces_and_trailing(self):
        self.assertEqual(probe.parse_irc('@time=synthetic :BanchoBot!u@h   PRIVMSG   #mp_9 :Room name: synthetic'),
                         ('BanchoBot!u@h', 'PRIVMSG', ['#mp_9', 'Room name: synthetic']))
        self.assertEqual(probe.parse_irc('PING :value with space'), (None, 'PING', ['value with space']))
        self.assertIsNone(probe.parse_irc('@tags_only'))

    def test_utf8_and_mixed_endings(self):
        data = ':Example PRIVMSG #mp_9 :測試🎵\n:server 366 Example #mp_9 :End\r\n'.encode()
        for split in range(len(data) + 1):
            buf = probe.LineBuffer()
            lines = buf.feed(data[:split]) + buf.feed(data[split:])
            self.assertEqual(len(lines), 2)
            self.assertIn('測試🎵', lines[0])
            self.assertEqual(dict(buf.endings), {'bare_lf': 1, 'crlf': 1})
            self.assertFalse(buf.pending)
        with self.assertRaises(RuntimeError):
            probe.LineBuffer().feed(b'x' * 131073)

    def test_names_not_permission_or_leak(self):
        summary = probe.names_summary('@Example +BanchoBot Other_Player', 'Example')
        self.assertEqual(summary, {'count': 3, 'selfPresent': True, 'selfPrefixes': ['@'], 'banchoBotPresent': True})
        self.assertNotIn('Other_Player', str(summary))

    def test_history_and_referee_redaction(self):
        self.assertEqual(probe.history_ids('History: https://osu.ppy.sh/mp/9'), [9])
        self.assertEqual(probe.history_ids('https://evil.invalid/mp/9'), [])
        self.assertEqual(probe.summarize_bot('Room name: PRIVATE, History: https://osu.ppy.sh/mp/9', 'Example'),
                         {'kind': 'settings-header', 'historyIds': [9]})
        summary = probe.summarize_bot('Match referees: Other_Player, Example', 'Example')
        self.assertTrue(summary['inlineSelfListed'])
        self.assertNotIn('Other_Player', str(summary))
        self.assertEqual(probe.summarize_bot('unknown private content', 'Example')['content'], '<redacted>')

    def test_lf_only_replies_stall_in_legacy_parser(self):
        messages = ['Room name: synthetic, History: https://osu.ppy.sh/mp/9',
                    'Team mode: TeamVs, Win condition: ScoreV2', 'Players: 0', 'Match referees:', 'Example']
        stream = b':server 001 Example :Welcome\r\n' + b''.join(
            (':BanchoBot PRIVMSG #mp_9 :' + text + '\n').encode() for text in messages)
        legacy = stream.split(b'\r\n')[:-1]
        self.assertEqual(sum(b' PRIVMSG ' in line for line in legacy), 0)
        buf = probe.LineBuffer()
        parsed = [probe.parse_irc(line) for line in buf.feed(stream)]
        self.assertEqual(sum(item[1] == 'PRIVMSG' for item in parsed), 5)
        self.assertEqual(buf.endings, {'crlf': 1, 'bare_lf': 5})

    def test_fake_bot_text_is_not_bot_prefix(self):
        prefix, command, params = probe.parse_irc(':Example!u@h PRIVMSG #mp_9 :BanchoBot: Match referees: Example')
        self.assertNotEqual(probe.normalize(prefix.split('!')[0]), 'banchobot')
        self.assertEqual(command, 'PRIVMSG')


if __name__ == '__main__':
    unittest.main()
