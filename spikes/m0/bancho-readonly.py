"""Interactive M0 capture: credentials stay in memory; only read-only room commands.

Never persist raw transcripts. Report deliberately omits player lines and referee names.
Run from a private terminal; the password is read with echo disabled.
"""
import argparse
import getpass
import json
import re
import socket
import time

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
report = {'evidence': 'live-readonly-bancho', 'roomId': args.room,
          'loginConfirmed': False, 'joined': False, 'commandsSent': [],
          'observations': [], 'protocolShapes': [], 'redaction': 'Account, room name, map IDs, player lines and referee names omitted; no raw capture retained.'}
channel = f'#mp_{args.room}'
sock = None
try:
    sock = socket.create_connection(('irc.ppy.sh', 6667), timeout=10)
    sock.settimeout(1)
    def send(line):
        sock.sendall((line + '\r\n').encode('utf-8'))
    send('PASS ' + password)
    password = None
    send('NICK ' + nick)
    send(f'USER {nick} 0 * :M0 read-only probe')
    pending = b''
    scheduled = []
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if scheduled and time.monotonic() >= scheduled[0][0]:
            _, query = scheduled.pop(0)
            send(f'PRIVMSG {channel} :{query}')
            report['commandsSent'].append(query)
        try:
            chunk = sock.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            break
        pending += chunk
        if len(pending) > 131072:
            raise RuntimeError('Probe receive limit exceeded')
        while b'\r\n' in pending:
            raw, pending = pending.split(b'\r\n', 1)
            line = raw.decode('utf-8', errors='replace')
            if line.startswith('PING '):
                send('PONG ' + line[5:]); continue
            parts = line.split(' ', 3)
            if len(parts) < 2:
                continue
            command = parts[1]
            if command == 'PRIVMSG' and len(parts) == 4:
                report['protocolShapes'].append({'command': command,
                    'targetIsRoom': parts[2] == channel,
                    'targetIsSelf': parts[2].casefold() == nick.casefold(),
                    'senderIsBanchoBot': parts[0].split('!')[0][1:].casefold() == 'banchobot'})
            if command in ('001', 'JOIN', '353', '366', '403', '473', '475', '464', 'NOTICE'):
                report['protocolShapes'].append({'command': command,
                    'roomMentioned': channel in line,
                    'senderIsSelf': parts[0].split('!')[0][1:].casefold() == nick.casefold()})
            if command == '001' and not report['loginConfirmed']:
                report['loginConfirmed'] = True
                report['observations'].append({'kind': 'numeric', 'command': '001'})
                send('JOIN ' + channel)
            elif command in ('464', '433', '475', '473', '403', '401'):
                report['observations'].append({'kind': 'error-numeric', 'command': command})
            elif (command == 'JOIN' and parts[0].split('!')[0][1:].casefold() == nick.casefold() or command == '366') and channel in line and report['loginConfirmed'] and not report['joined']:
                report['joined'] = True
                scheduled = [(time.monotonic() + 1, '!mp settings'), (time.monotonic() + 3, '!mp listrefs')]
            elif command == 'PRIVMSG' and len(parts) == 4 and parts[0].split('!')[0][1:].casefold() == 'banchobot' and parts[2].casefold() in (channel, nick.casefold()):
                body = parts[3].removeprefix(':')
                # Strict allowlist: never echo arbitrary chat, names, passwords or map names.
                if body.startswith('Room name:'):
                    safe = 'Room name: <redacted>; history URL omitted'
                elif body.startswith('Beatmap:'):
                    safe = 'Beatmap: <redacted>'
                elif body.startswith(('Team mode:', 'Active mods:', 'Players:')) and re.fullmatch(r'[A-Za-z0-9 :,_()-]+', body):
                    safe = body
                elif body.startswith('Slot '):
                    match = re.match(r'Slot\s+(\d+)\s+(.+)', body)
                    safe = f'Slot {match.group(1)} <player/status detail redacted>' if match else 'Slot <redacted>'
                elif body.startswith(('Match referees:', 'Referees:')):
                    safe = '<referee-list header; names redacted>'
                else:
                    safe = '<unclassified BanchoBot response omitted>'
                report['observations'].append({'kind': 'room-response', 'senderNick': 'BanchoBot', 'text': safe})
    report['limitation'] = 'Membership observations do not prove referee permission or trusted bot-prefix policy. No mutation, make, reconnect, UID identity proof or complete parser grammar tested.'
except (OSError, RuntimeError) as error:
    report['error'] = type(error).__name__
finally:
    password = None
    if sock:
        sock.close()
    with open(args.report, 'w') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
