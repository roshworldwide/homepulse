import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SigningKeys } from "mcp-streamable-guard";
import type { AgentService } from "./agents/homepulse.js";
import { Bus } from "./bus.js";
import { ControlledClock, SystemClock, type Clock } from "./clock.js";
import type { Config } from "./config.js";
import { Devices } from "./devices/simulated.js";
import { Engram, openDatabase } from "./engram/store.js";
import { createHomeGuard, type HomeGuard } from "./guard/home-guard.js";
import { Ids } from "./ids.js";
import { loadOrCreateKeys } from "./keys.js";
import { ApprovalBroker } from "./mcp/approvals.js";
import { makeProvider } from "./models/index.js";
import type { ModelProvider } from "./models/types.js";
import { RingClient } from "./ring/client.js";
import { RingService } from "./ring/service.js";
import { RuleCompiler } from "./rules/compiler.js";
import { Approvals } from "./state/approvals.js";
import { HomeState } from "./state/home.js";
import { PassStore } from "./state/passes.js";

export interface HomePulse {
  config: Config;
  clock: Clock;
  bus: Bus;
  db: DatabaseSync;
  engram: Engram;
  passes: PassStore;
  approvals: Approvals;
  home: HomeState;
  devices: Devices;
  keys: SigningKeys;
  broker: ApprovalBroker;
  homeGuard: HomeGuard;
  ring: RingService;
  ringClient: RingClient | null;
  compiler: RuleCompiler;
  /** Swappable so DEMO_MODE can route to recorded fixtures per scenario. */
  provider: ModelProvider;
  /** Per-scenario context for fixtures ("nurse", "sign", ...). */
  scenario: string | null;
  ids: Ids;
  /** The HomePulse agent and the naive baseline (set when the agent routes are mounted). */
  agents?: AgentService;
}

export interface CreateOptions {
  clock?: Clock;
  /** Database file; ":memory:" for tests. Defaults to data/homepulse.db. */
  dbFile?: string;
  provider?: ModelProvider;
}

export function createHomePulse(config: Config, opts: CreateOptions = {}): HomePulse {
  const clock = opts.clock ?? (config.demoMode ? new ControlledClock(Date.now()) : new SystemClock());
  const bus = new Bus();
  let dbFile = opts.dbFile;
  if (!dbFile) {
    if (config.dataDir) {
      fs.mkdirSync(config.dataDir, { recursive: true });
      dbFile = path.join(config.dataDir, "homepulse.db");
    } else dbFile = ":memory:";
  }
  const db = openDatabase(dbFile);
  const engram = new Engram(db, clock, bus);
  const passes = new PassStore(db);
  const approvals = new Approvals();
  const home = new HomeState(clock, config.tz, bus);
  const devices = new Devices(clock, bus);
  const keys = loadOrCreateKeys(config.dataDir);
  const broker = new ApprovalBroker(clock, bus);
  const ids = new Ids(config.demoMode);
  const newId = (prefix: string) => ids.next(prefix);
  const ringClient = config.ringAccessToken ? new RingClient(config.ringApiBase, () => config.ringAccessToken) : null;
  const ring = new RingService(engram, clock, ringClient);
  const homeGuard = createHomeGuard({ config, clock, bus, engram, passes, approvals, home, devices, keys, broker, newId });

  const hp = {
    config,
    clock,
    bus,
    db,
    engram,
    passes,
    approvals,
    home,
    devices,
    keys,
    broker,
    homeGuard,
    ring,
    ringClient,
    provider: opts.provider ?? makeProvider(config, () => hp.scenario),
    scenario: null as string | null,
    ids,
  } as Omit<HomePulse, "compiler"> as HomePulse;
  hp.compiler = new RuleCompiler(() => hp.provider, clock, config.tz, keys, config.codeSecret, passes, engram, newId);
  return hp;
}
