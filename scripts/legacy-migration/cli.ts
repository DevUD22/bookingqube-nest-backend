/**
 * Legacy BookingQube (Laravel + MySQL) → V2 (NestJS + PostgreSQL/Prisma)
 *
 * Usage:
 *   npx tsx scripts/legacy-migration/cli.ts list
 *   npx tsx scripts/legacy-migration/cli.ts inspect --old-event=58
 *   npx tsx scripts/legacy-migration/cli.ts migrate --old-event=58 --create-event --dry-run
 *   npx tsx scripts/legacy-migration/cli.ts migrate --old-event=58 --create-event
 *   npx tsx scripts/legacy-migration/cli.ts verify --old-event=58 --new-event=inflatacity-2025
 *
 * Env:
 *   LEGACY_MYSQL_*  + DATABASE_URL
 *
 * Core logic lives in:
 *   src/modules/admin-legacy-migration/legacy/
 */
import { PrismaClient } from '@prisma/client';

import { loadLegacyMysqlConfig, parseLegacyMysqlSource } from '../../src/modules/admin-legacy-migration/legacy/config';
import {
  getLegacyMetrics,
  listLegacyEvents,
  loadLegacyTickets,
  resolveLegacyEventIds,
} from '../../src/modules/admin-legacy-migration/legacy/extract';
import {
  migrateEvent,
  verifyMigratedEvent,
} from '../../src/modules/admin-legacy-migration/legacy/migrate-event';
import {
  closeMysql,
  describeMysqlSource,
  useMysqlSource,
} from '../../src/modules/admin-legacy-migration/legacy/mysql-client';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const [cmd = 'help', ...rest] = argv;
  const args: Args = {};
  for (const token of rest) {
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--create-event') args.createEvent = true;
    else if (token === '--force') args.force = true;
    else if (token === '--skip-rollups') args.skipRollups = true;
    else if (token === '--no-addons') args.noAddons = true;
    else if (token === '--no-separate-addons') args.noSeparateAddons = true;
    else if (token === '--no-cafe') args.noCafe = true;
    else if (token === '--no-e3') args.noE3 = true;
    else if (token === '--no-create-tickets') args.noCreateTickets = true;
    else if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq === -1) args[token.slice(2)] = true;
      else args[token.slice(2, eq)] = token.slice(eq + 1);
    }
  }
  return { cmd, args };
}

function parseTicketMap(raw?: string | boolean): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [oldId, newId] = part.split(':').map((s) => s.trim());
    if (oldId && newId) out[oldId] = newId;
  }
  return out;
}

function printHelp() {
  console.log(`
Legacy MySQL → V2 PostgreSQL migration tool

Commands:
  list                              List legacy events with booking KPIs
  inspect --old-event=<id|slug>     Show old metrics + ticket breakdown
  migrate --old-event=<id|slug>     Migrate one event's bookings/customers
      --source=local|live           MySQL source (default local)
      --new-event=<slug>            Target existing V2 event
      --create-event                Create V2 event from legacy metadata
      --organization=<slug>         Org for --create-event (default bookingqube)
      --ticket-map=177:uuid,178:uuid
      --dry-run                     Plan only (no writes)
      --force                       Delete previously imported legacy orders first
      --skip-rollups                Skip dashboard rollup rebuild
      --no-addons                   Skip linked addons_booking lines
      --no-separate-addons          Skip separate (unlinked) addon orders
      --no-cafe                     Skip pos_cafe_closings EOD sales
      --no-e3                       Skip e3_bookings historical onsite sales
      --no-create-tickets           Fail if tickets cannot be matched
  verify --old-event= --new-event=  Compare old vs imported KPIs

Examples (live Azure):
  npm run legacy:list -- --source=live
  npm run legacy:inspect -- --source=live --old-event=58
  npm run legacy:migrate -- --source=live --old-event=58 --create-event --dry-run

Admin UI: /migration-tool (Local / Live toggle)
`);
}

function pad(s: string, n: number) {
  return (s + ' '.repeat(n)).slice(0, n);
}

async function cmdList() {
  const events = await listLegacyEvents(100);
  console.log('\nLegacy events (MySQL)\n');
  console.log(
    pad('ID', 6) +
      pad('Orders', 8) +
      pad('Tickets', 9) +
      pad('Admits', 9) +
      pad('Revenue', 12) +
      'Title / slug',
  );
  console.log('-'.repeat(90));
  for (const e of events) {
    console.log(
      pad(String(e.id), 6) +
        pad(String(e.orders), 8) +
        pad(String(e.tickets), 9) +
        pad(String(e.admits), 9) +
        pad(e.revenue.toFixed(2), 12) +
        `${e.title}  (${e.slug})` +
        (e.common_event_id ? `  [common=${e.common_event_id}]` : ''),
    );
  }
  console.log(`\n${events.length} events shown. Use inspect/migrate with --old-event=<id|slug>.`);
}

async function cmdInspect(args: Args) {
  const selector = String(args['old-event'] || args.oldEvent || '');
  if (!selector) throw new Error('--old-event is required');
  const { primary, eventIds, commonEventId } = await resolveLegacyEventIds(selector);
  const metrics = await getLegacyMetrics(eventIds, commonEventId);
  const tickets = await loadLegacyTickets(eventIds);

  console.log('\n=== Legacy event ===');
  console.log({
    id: primary.id,
    title: primary.title,
    slug: primary.slug,
    common_event_id: commonEventId,
    event_ids_in_scope: eventIds,
    start_date: primary.start_date,
    end_date: primary.end_date,
  });
  console.log('\n=== Bookings KPIs ===');
  console.log({
    booking_rows: metrics.booking_rows,
    orders: metrics.orders,
    tickets: metrics.tickets,
    admits: metrics.admits,
    ticket_revenue: Number(metrics.revenue.toFixed(3)),
  });
  console.log('\n=== Dashboard parity (bookings + addons + cafe + e3) ===');
  console.log({
    linked_addons: Number(metrics.addon_revenue.toFixed(3)),
    separate_addons: Number(metrics.separate_addon_revenue.toFixed(3)),
    cafe_sales: Number(metrics.cafe_sales.toFixed(3)),
    cafe_transactions: metrics.cafe_transactions,
    e3_tickets: metrics.e3_tickets,
    e3_admits: metrics.e3_admits,
    e3_revenue: Number(metrics.e3_revenue.toFixed(3)),
    parity_tickets: metrics.parity.tickets,
    parity_admits: metrics.parity.admits,
    parity_revenue: Number(metrics.parity.revenue.toFixed(3)),
  });
  console.log('\n=== By ticket ===');
  console.table(metrics.by_ticket);
  console.log('\n=== By payment ===');
  console.table(metrics.by_payment);
  console.log('\n=== Catalog tickets (with sales) ===');
  console.table(
    tickets
      .filter((t) => t.sold_qty > 0)
      .map((t) => ({
        id: t.id,
        title: t.title,
        price: t.price,
        sold_qty: t.sold_qty,
        sold_admits: t.sold_admits,
        sold_revenue: Number(t.sold_revenue.toFixed(2)),
        is_pos_only: t.is_pos_only,
      })),
  );
}

async function cmdMigrate(args: Args, prisma: PrismaClient) {
  const selector = String(args['old-event'] || args.oldEvent || '');
  if (!selector) throw new Error('--old-event is required');

  const result = await migrateEvent(prisma, {
    oldEvent: selector,
    newEventSlug: args['new-event'] ? String(args['new-event']) : undefined,
    createEvent: !!args.createEvent,
    organizationSlug: args.organization ? String(args.organization) : undefined,
    dryRun: !!args.dryRun,
    force: !!args.force,
    skipRollups: !!args.skipRollups,
    includeAddons: !args.noAddons,
    includeSeparateAddons: !args.noSeparateAddons,
    includeCafeClosings: !args.noCafe,
    includeE3: !args.noE3,
    createMissingTickets: !args.noCreateTickets,
    ticketMap: parseTicketMap(args['ticket-map']),
  });

  console.log('\n=== Migration result ===');
  console.log(
    JSON.stringify(
      {
        dryRun: !!args.dryRun,
        legacy: {
          title: result.legacy.title,
          slug: result.legacy.slug,
          eventIds: result.legacy.eventIds,
          metrics: {
            orders: result.legacy.metrics.orders,
            tickets: result.legacy.metrics.tickets,
            admits: result.legacy.metrics.admits,
            revenue: Number(result.legacy.metrics.revenue.toFixed(3)),
            addon_revenue: Number(result.legacy.metrics.addon_revenue.toFixed(3)),
            separate_addon_revenue: Number(
              result.legacy.metrics.separate_addon_revenue.toFixed(3),
            ),
            cafe_sales: Number(result.legacy.metrics.cafe_sales.toFixed(3)),
            e3_revenue: Number(result.legacy.metrics.e3_revenue.toFixed(3)),
            parity: result.legacy.metrics.parity,
          },
        },
        target: result.target,
        organiser: result.organiser,
        posAgents: result.posAgents,
        thirdPartyVendors: result.thirdPartyVendors,
        ticketMap: result.ticketMap,
        planned: result.planned,
        written: result.written,
        warnings: result.warnings,
        verify: result.verify,
      },
      null,
      2,
    ),
  );

  if (result.verify && !result.verify.match && !args.dryRun) {
    console.error('\nWARNING: parity check did not fully match. Re-run verify for details.');
    process.exitCode = 2;
  } else if (args.dryRun) {
    console.log('\nDry-run only — no data written. Re-run without --dry-run to migrate.');
  } else {
    console.log('\nDone. Run verify to double-check, then open the V2 admin dashboard for this event.');
  }
}

async function cmdVerify(args: Args, prisma: PrismaClient) {
  const oldEvent = String(args['old-event'] || '');
  const newEvent = String(args['new-event'] || '');
  if (!oldEvent || !newEvent) throw new Error('--old-event and --new-event are required');
  const result = await verifyMigratedEvent(prisma, oldEvent, newEvent);
  console.log(JSON.stringify(result, null, 2));
  const ok = Object.values(result.match).every(Boolean);
  if (!ok) {
    console.error('\nParity mismatch.');
    process.exitCode = 2;
  } else {
    console.log('\nParity OK — orders, tickets, admits, ticket revenue match.');
  }
}

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  const source = parseLegacyMysqlSource(
    typeof args.source === 'string' ? args.source : undefined,
  );
  await useMysqlSource(source);
  const mysqlCfg = loadLegacyMysqlConfig(source);
  const desc = describeMysqlSource(source);
  console.log(
    `Legacy MySQL [${source}]: ${mysqlCfg.user}@${mysqlCfg.host}:${mysqlCfg.port}/${mysqlCfg.database}${desc.ssl ? ' (SSL)' : ''}`,
  );

  const prisma = new PrismaClient();
  try {
    switch (cmd) {
      case 'list':
        await cmdList();
        break;
      case 'inspect':
        await cmdInspect(args);
        break;
      case 'migrate':
        await cmdMigrate(args, prisma);
        break;
      case 'verify':
        await cmdVerify(args, prisma);
        break;
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      default:
        printHelp();
        throw new Error(`Unknown command: ${cmd}`);
    }
  } finally {
    await closeMysql();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
