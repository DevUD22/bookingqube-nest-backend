export function durationToMs(value: string) {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  return amount * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
}
