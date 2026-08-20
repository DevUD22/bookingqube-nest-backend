/** Atomic multi-key inventory scripts. KEYS must be sorted ascending by inventory id. */

export const INVENTORY_RESERVE_LUA = `
local mode = ARGV[#ARGV]
local n = #KEYS
for i = 1, n do
  local key = KEYS[i]
  local qty = tonumber(ARGV[i])
  if not qty or qty < 1 then
    return {0, i, 'bad_qty'}
  end
  if redis.call('EXISTS', key) == 0 then
    return {0, i, 'missing'}
  end
  local status = redis.call('HGET', key, 'status') or 'active'
  if status ~= 'active' then
    return {0, i, 'inactive'}
  end
  local totalRaw = redis.call('HGET', key, 'total')
  local total = -1
  if totalRaw then
    local parsed = tonumber(totalRaw)
    if parsed ~= nil then total = parsed end
  end
  local sold = tonumber(redis.call('HGET', key, 'sold') or '0') or 0
  local held = tonumber(redis.call('HGET', key, 'held') or '0') or 0
  if total >= 0 and (total - sold - held) < qty then
    return {0, i, 'sold_out'}
  end
end
for i = 1, n do
  local key = KEYS[i]
  local qty = tonumber(ARGV[i])
  local totalRaw = redis.call('HGET', key, 'total')
  local total = -1
  if totalRaw then
    local parsed = tonumber(totalRaw)
    if parsed ~= nil then total = parsed end
  end
  -- Unlimited inventory (total < 0) is never held/sold — capacity tracking is off.
  if total >= 0 then
    if mode == 'sold' then
      redis.call('HINCRBY', key, 'sold', qty)
    else
      redis.call('HINCRBY', key, 'held', qty)
    end
  end
end
return {1}
`;

export const INVENTORY_RELEASE_LUA = `
local n = #KEYS
for i = 1, n do
  local key = KEYS[i]
  local qty = tonumber(ARGV[i])
  if redis.call('EXISTS', key) == 1 and qty and qty > 0 then
    local totalRaw = redis.call('HGET', key, 'total')
    local total = -1
    if totalRaw then
      local parsed = tonumber(totalRaw)
      if parsed ~= nil then total = parsed end
    end
    if total >= 0 then
      local held = tonumber(redis.call('HGET', key, 'held') or '0') or 0
      local nextHeld = held - qty
      if nextHeld < 0 then nextHeld = 0 end
      redis.call('HSET', key, 'held', nextHeld)
    end
  end
end
return {1}
`;

export const INVENTORY_CONVERT_LUA = `
local n = #KEYS
for i = 1, n do
  local key = KEYS[i]
  local qty = tonumber(ARGV[i])
  if redis.call('EXISTS', key) == 1 and qty and qty > 0 then
    local totalRaw = redis.call('HGET', key, 'total')
    local total = -1
    if totalRaw then
      local parsed = tonumber(totalRaw)
      if parsed ~= nil then total = parsed end
    end
    -- Unlimited inventory: nothing was held/sold for capacity — skip.
    if total >= 0 then
      local held = tonumber(redis.call('HGET', key, 'held') or '0') or 0
      local nextHeld = held - qty
      if nextHeld < 0 then nextHeld = 0 end
      redis.call('HSET', key, 'held', nextHeld)
      redis.call('HINCRBY', key, 'sold', qty)
    end
  end
end
return {1}
`;

export const INVENTORY_RELEASE_SOLD_LUA = `
local n = #KEYS
for i = 1, n do
  local key = KEYS[i]
  local qty = tonumber(ARGV[i])
  if redis.call('EXISTS', key) == 1 and qty and qty > 0 then
    local totalRaw = redis.call('HGET', key, 'total')
    local total = -1
    if totalRaw then
      local parsed = tonumber(totalRaw)
      if parsed ~= nil then total = parsed end
    end
    if total >= 0 then
      local sold = tonumber(redis.call('HGET', key, 'sold') or '0') or 0
      local nextSold = sold - qty
      if nextSold < 0 then nextSold = 0 end
      redis.call('HSET', key, 'sold', nextSold)
    end
  end
end
return {1}
`;

export function inventoryKey(inventoryItemId: string) {
  return `inv:${inventoryItemId}`;
}

export function idempotencyKey(key: string) {
  return `idempotency:book:${key}`;
}

export function holdTtlKey(holdId: string) {
  return `hold:ttl:${holdId}`;
}

export function promoRedeemedKey(promoId: string) {
  return `promo:${promoId}:redeemed`;
}

export function catalogEventKey(slug: string) {
  return `catalog:event:${slug}`;
}
