const CHANNEL_PREFIX = 'notify:';

interface RedisConfig {
  url: string;
  token: string;
}

function getRedisConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export function isRedisConfigured(): boolean {
  return getRedisConfig() !== null;
}

async function redisCommand(commands: unknown[][]): Promise<unknown> {
  const config = getRedisConfig();
  if (!config) return null;
  // Upstash Pipeline API: POST /pipeline body: [[cmd1], [cmd2]]
  const res = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  return res.json();
}

export async function enqueueNotification(
  pharmacyId: number,
  event: { type: string; data: unknown },
): Promise<void> {
  const key = `${CHANNEL_PREFIX}${pharmacyId}`;
  await redisCommand([
    ['LPUSH', key, JSON.stringify(event)],
    ['EXPIRE', key, '86400'],
  ]);
}

export async function pollMessages(pharmacyId: number): Promise<string | null> {
  const config = getRedisConfig();
  if (!config) return null;
  const res = await fetch(`${config.url}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['RPOP', `${CHANNEL_PREFIX}${pharmacyId}`]),
  });
  if (!res.ok) return null;
  const data = await res.json() as { result?: string | null };
  return data?.result ?? null;
}
