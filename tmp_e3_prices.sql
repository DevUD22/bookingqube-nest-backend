-- Compare unit prices distribution for E3 tickets
SELECT oi.unit_price, oi.total_amount / NULLIF(oi.quantity,0) AS effective,
  COUNT(*) lines, SUM(oi.quantity) qty, SUM(oi.total_amount) amount
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN third_party_vendors tpv ON tpv.id = oi.third_party_vendor_id
WHERE o.event_id = 'e07ef15a-288f-4f30-9ba6-8afa9940929c'
  AND o.status NOT IN ('expired','cancelled')
  AND tpv.name = 'E3'
  AND oi.item_type = 'ticket_type'
GROUP BY oi.unit_price, oi.total_amount / NULLIF(oi.quantity,0)
ORDER BY amount DESC
LIMIT 30;

-- Addon breakdown for E3
SELECT oi.display_name, oi.unit_price, COUNT(*) lines, SUM(oi.quantity) qty, SUM(oi.total_amount) amount
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN third_party_vendors tpv ON tpv.id = oi.third_party_vendor_id
WHERE o.event_id = 'e07ef15a-288f-4f30-9ba6-8afa9940929c'
  AND o.status NOT IN ('expired','cancelled')
  AND tpv.name = 'E3'
  AND oi.item_type = 'addon'
GROUP BY oi.display_name, oi.unit_price
ORDER BY amount DESC;

-- Orders metadata source
SELECT o.metadata->>'legacy_source' AS legacy_source,
  COUNT(DISTINCT o.id) orders,
  SUM(CASE WHEN oi.item_type='ticket_type' THEN oi.quantity ELSE 0 END) tickets,
  SUM(CASE WHEN oi.item_type='ticket_type' THEN oi.total_amount ELSE 0 END) ticket_rev,
  SUM(CASE WHEN oi.item_type='addon' THEN oi.total_amount ELSE 0 END) addon_rev
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN third_party_vendors tpv ON tpv.id = oi.third_party_vendor_id AND tpv.name = 'E3'
WHERE o.event_id = 'e07ef15a-288f-4f30-9ba6-8afa9940929c'
  AND o.status NOT IN ('expired','cancelled')
GROUP BY o.metadata->>'legacy_source';
