"""Bounded, interactive, read-only Bancho diagnostic. No raw transcript retained."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import getpass
import json
import re
import socket
import time


class LineBuffer:
    """Accept CRLF and bare LF separately, and expose framing evidence."""
    def __init__(self):
        self.pending = b''
        self.endings = Counter()
        self.last_endings = []

    def feed(self, chunk):
        self.pending += chunk
        if len(self.pending) > 131072:
            raise RuntimeError('Probe receive limit exceeded')
        lines = []
        self.last_endings = []
        while b'\n' in self.pending:
            line, self.pending = self.pending.split(b'\n', 1)
            crlf = line.endswith(b'\r')
            self.endings['crlf' if crlf else 'bare_lf'] += 1
            self.last_endings.append('crlf' if crlf else 'bare_lf')
            lines.append((line[:-1] if crlf else line).decode('utf-8', errors='replace'))
        return lines


def parse_irc(line):
    """Parse framing, not Bancho room semantics; never return raw text to logs."""
    rest = line.strip(' ')
    if rest.startswith('@'):
        _, sep, rest = rest.partition(' ')
        if not sep:
            return None
        rest = rest.lstrip(' ')
    prefix = None
    if rest.startswith(':'):
        prefix, sep, rest = rest[1:].partition(' ')
        if not sep:
            return None
        rest = rest.lstrip(' ')
    head, sep, trailing = rest.partition(' :')
    parts = head.split()
    if not parts or not re.fullmatch(r'[A-Za-z]+|[0-9]{3}', parts[0]):
        return None
    return prefix, parts[0].upper(), parts[1:] + ([trailing] if sep else [])


def normalize(nick):
    return nick.replace(' ', '_').casefold()


def history_ids(text):
    return [int(x) for x in re.findall(r'https://osu\.ppy\.sh/(?:mp|community/matches)/(\d+)(?=$|[^0-9])', text)]


def names_summary(names, nick):
    tokens = names.split()
    stripped = [(x.lstrip('~&@%+'), x[:len(x) - len(x.lstrip('~&@%+'))]) for x in tokens]
    return {'count': len(tokens), 'selfPresent': any(normalize(x) == normalize(nick) for x, _ in stripped),
            'selfPrefixes': [flags for x, flags in stripped if normalize(x) == normalize(nick)],
            'banchoBotPresent': any(normalize(x) == 'banchobot' for x, _ in stripped)}


def summarize_bot(body, nick):
    if body.startswith('Room name:'):
        return {'kind': 'settings-header', 'historyIds': history_ids(body)}
    if body.startswith('Beatmap:'):
        return {'kind': 'beatmap', 'content': '<redacted>'}
    for label in ('Team mode:', 'Active mods:', 'Players:'):
        if body.startswith(label) and re.fullmatch(r'[A-Za-z0-9 :,_()-]+', body):
            return {'kind': 'settings-field', 'text': body}
    if body.startswith('Slot '):
        return {'kind': 'slot', 'content': '<player/status detail redacted>'}
    if body.startswith(('Match referees:', 'Referees:')):
        names = body.partition(':')[2].strip()
        return {'kind': 'referee-header', 'inlineSelfListed': normalize(nick) in [normalize(x.strip()) for x in names.split(',')],
                'hasInlineNames': bool(names)}
    if normalize(body.strip()) == normalize(nick):
        return {'kind': 'self-name-line', 'selfListedCandidate': True}
    if any(x in body.lower() for x in ('not a referee', 'not the referee', 'not authorized', 'permission', 'not allowed')):
        return {'kind': 'permission-related-response', 'content': '<redacted>'}
    return {'kind': 'unclassified-bot-response', 'content': '<redacted>'}


def run(nick, room, password):
    channel = f'#mp_{room}'
    started = time.monotonic()
    report = {'schemaVersion': 2, 'evidence': 'live-readonly-bancho',
              'recordedAt': datetime.now(timezone.utc).isoformat(), 'roomId': room, 'requestedChannel': channel,
              'loginConfirmed': False, 'selfJoinObserved': False, 'namesComplete': False,
              'commandsSent': [], 'observations': [], 'protocolShapes': [],
              'wire': {'receivedBytes': 0, 'parseFailures': 0, 'legacyPrivmsgCount': 0},
              'redaction': 'Only protocol shapes and allowlisted summaries; no credentials, raw transcript, player or referee names.'}
    buffer = LineBuffer()
    legacy_buffer = b''
    commands = Counter()
    sock = None
    scheduled = []
    scheduled_once = False
    query_phase = None
    try:
        sock = socket.create_connection(('irc.ppy.sh', 6667), timeout=10)
        sock.settimeout(0.5)

        def send(line):
            if any(c in line for c in '\r\n\0'):
                raise ValueError('Invalid outbound line')
            sock.sendall((line + '\r\n').encode('utf-8'))

        send('PASS ' + password)
        password = None
        send('NICK ' + nick)
        send(f'USER {nick} 0 * :M0 read-only probe')
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if scheduled and time.monotonic() >= scheduled[0][0]:
                _, query = scheduled.pop(0)
                send(f'PRIVMSG {channel} :{query}')
                query_phase = query
                report['commandsSent'].append({'command': query, 'target': channel, 'elapsedSeconds': round(time.monotonic() - started, 3)})
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                continue
            if not chunk:
                report['peerClosed'] = True
                break
            report['wire']['receivedBytes'] += len(chunk)
            if report['wire']['receivedBytes'] > 1048576:
                raise RuntimeError('Probe total receive limit exceeded')
            legacy_buffer += chunk
            while b'\r\n' in legacy_buffer:
                old_line, legacy_buffer = legacy_buffer.split(b'\r\n', 1)
                old = old_line.decode('utf-8', errors='replace').split(' ', 3)
                if len(old) == 4 and old[1] == 'PRIVMSG':
                    report['wire']['legacyPrivmsgCount'] += 1
            if len(legacy_buffer) > 131072:
                raise RuntimeError('Legacy diagnostic buffer limit exceeded')
            lines = buffer.feed(chunk)
            for line, ending in zip(lines, buffer.last_endings):
                parsed = parse_irc(line)
                if not parsed:
                    report['wire']['parseFailures'] += 1
                    continue
                prefix, command, params = parsed
                commands[command] += 1
                if command == 'PING' and params:
                    send('PONG :' + params[-1])
                    continue
                sender = normalize((prefix or '').split('!')[0])
                own_target = bool(params) and normalize(params[0]) == normalize(nick)
                shape = {'command': command, 'senderIsSelf': sender == normalize(nick),
                         'senderIsBanchoBot': sender == 'banchobot',
                         'roomParameter': channel in params, 'targetIsSelf': own_target,
                         'elapsedSeconds': round(time.monotonic() - started, 3), 'lineEnding': ending}
                if command not in ('372', 'QUIT'):
                    report['protocolShapes'].append(shape)
                if command == '001' and own_target and not report['loginConfirmed']:
                    report['loginConfirmed'] = True
                    send('JOIN ' + channel)
                elif command == 'JOIN' and sender == normalize(nick) and channel in params:
                    report['selfJoinObserved'] = True
                elif command == '353' and own_target and channel in params:
                    report['observations'].append({'kind': 'names', **names_summary(params[-1], nick)})
                elif command == '366' and own_target and channel in params:
                    report['namesComplete'] = True
                elif command in ('332', 'TOPIC') and channel in params:
                    report['observations'].append({'kind': 'topic', 'historyIds': history_ids(params[-1]), 'textBytes': len(params[-1].encode())})
                elif command.isdigit() and int(command) >= 400:
                    report['observations'].append({'kind': 'error-numeric', 'command': command,
                        'targetIsSelf': own_target, 'roomParameter': channel in params})
                elif command in ('NOTICE', 'ERROR'):
                    report['observations'].append({'kind': command.lower(), 'content': '<redacted>', 'historyIds': history_ids(params[-1]) if params else []})
                elif command == 'PRIVMSG' and len(params) >= 2 and sender == 'banchobot' and (params[0] == channel or own_target):
                    report['observations'].append({**summarize_bot(params[-1], nick), 'queryPhase': query_phase,
                        'targetIsRoom': params[0] == channel, 'historyIdsMatchRequested': room in history_ids(params[-1])})
                if report['loginConfirmed'] and (report['selfJoinObserved'] or report['namesComplete']) and not scheduled_once:
                    scheduled_once = True
                    scheduled = [(time.monotonic() + 5, '!mp settings'), (time.monotonic() + 15, '!mp listrefs')]
    except (OSError, RuntimeError, ValueError) as error:
        report['error'] = type(error).__name__
    finally:
        password = None
        if sock:
            sock.close()
        report['wire'].update({'lineEndings': dict(buffer.endings), 'trailingBufferBytes': len(buffer.pending),
                               'legacyTrailingBufferBytes': len(legacy_buffer), 'commandCounts': dict(commands),
                               'shapeDetailExcludes': ['372', 'QUIT']})
        report['durationSeconds'] = round(time.monotonic() - started, 3)
        report['limitation'] = 'Names completion is not room binding or referee permission. Candidate bot sender nick and query phase are observations, not authenticated identity or response transaction IDs. No room mutations.'
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--username', required=True)
    parser.add_argument('--room', required=True, type=int)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    nick = args.username.replace(' ', '_')
    if not re.fullmatch(r'[A-Za-z0-9_\[\]-]+', nick) or args.room <= 0:
        raise SystemExit('Unsupported probe input')
    password = getpass.getpass('IRC dedicated password (not recorded): ')
    if any(c in password for c in '\r\n\0'):
        raise SystemExit('Invalid password input')
    report = run(nick, args.room, password)
    password = None
    with open(args.report, 'w') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
