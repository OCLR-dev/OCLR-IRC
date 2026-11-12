export function isBpNotice(text: string) {
  return /^\[OCLR BP #\d{1,6}\] (?:WITHDRAW )?(?:BAN|PICK|TB) [A-Z]{2}\d{1,4} \| [^|\p{Cc}\p{Cf}\u2028\u2029]{1,64} \| https:\/\/osu\.ppy\.sh\/b\/[1-9]\d{0,9}$/u.test(text) && new TextEncoder().encode(text).length <= 380;
}

export function isScoreNotice(text: string) {
  return (
    /^\[OCLR SCORE #\d{1,6}\] [A-Z]{2}\d{1,4} \| RED \d+ - \d+ BLUE \| (?:Next: (?:BAN|PICK) (?:RED|BLUE) [^|\p{Cc}\p{Cf}\u2028\u2029]{1,48}|Next: TB|Series complete|No next step|Awaiting referee ruling)$/u.test(
      text,
    ) && new TextEncoder().encode(text).length <= 380
  );
}
