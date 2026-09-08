export function canReuse(cached, interval, now, duration) {
  return Boolean(cached && interval !== '15min' && now < cached.rows.at(-1).time + duration);
}
