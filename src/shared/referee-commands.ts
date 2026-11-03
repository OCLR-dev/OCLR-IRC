import { refereeCommands as websiteCommands, type RefereeCommandInput } from './oclr-website/referee-commands.ts'

/** Desktop invitations address saved roster UIDs; the pinned website builder stays unchanged. */
export function refereeCommands(input: RefereeCommandInput) {
  const members = input.teams.flatMap(team => (team.members ?? []).map(player => ({team, player})))
  return websiteCommands(input).map(command => {
    if (command.kind !== 'invite') return command
    const matches = members.filter(({team, player}) => command.id === `invite:${team.id}:${player.osuId}`)
    const player = matches[0]?.player
    if (matches.length !== 1 || !player || !Number.isSafeInteger(player.osuId) || player.osuId <= 0 || members.filter(member => member.player.osuId === player.osuId).length !== 1 || !player.username.trim() || player.username.length > 50 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(player.username)) return {...command, text: null, reason: '隊員資料有缺漏或重複，請在網站核對。'}
    return {...command, text: `!mp invite #${player.osuId}`, reason: null}
  })
}
