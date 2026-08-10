import { createFileRoute } from "@tanstack/react-router";
import { MousePointerClick, Zap } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useAnimate,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import AutoMode from "#/components/AutoMode";
import DisclaimerGate from "#/components/DisclaimerGate";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import WalletTable from "#/components/WalletTable";
import { useAutoChain } from "#/hooks/useAutoChain";
import { useWebData, type WebDataSnapshot } from "#/hooks/useWebData";
import type { AbstractionMode } from "#/lib/hlActions";
import { cn } from "#/lib/utils";

const ABSTRACTION_LABEL: Record<AbstractionMode, string> = {
  unifiedAccount: "Unified",
  portfolioMargin: "Portfolio margin",
  disabled: "Standard",
};

export const Route = createFileRoute("/")({ component: App });

function fmt(value: string | number): string {
  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ── Animated number row for mining mode ── */
function AnimatedRow({ label, value }: { label: string; value: number }) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 40, damping: 15 });
  const [display, setDisplay] = useState(value);
  const [scope, animateZoom] = useAnimate();
  const prevRef = useRef(value);

  useEffect(() => {
    mv.set(value);
    if (prevRef.current !== value) {
      animateZoom(
        scope.current,
        { scale: [1, 1.08, 1] },
        { duration: 0.4, ease: "easeOut" },
      );
      prevRef.current = value;
    }
  }, [value, mv, animateZoom, scope]);

  useMotionValueEvent(spring, "change", (latest) => {
    setDisplay(latest);
  });

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span ref={scope} className="text-sm font-semibold tabular-nums">
        {fmt(display)}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function StatsColumn({
  title,
  data,
  isLoading,
  delay,
  isMining,
}: {
  title: string;
  data: WebDataSnapshot | null;
  isLoading: boolean;
  delay: number;
  isMining?: boolean;
}) {
  if (isLoading || !data) {
    return (
      <Card className="gap-2">
        <CardHeader className="pb-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{title}</CardTitle>
            {data && (
              <Badge variant="secondary" className="text-[10px]">
                {ABSTRACTION_LABEL[data.abstraction]}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {["a", "b", "c", "d"].map((id) => (
            <div key={id} className="flex items-center justify-between">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const { marginSummary } = data.clearinghouseState;
  const withdrawable = Number.parseFloat(data.clearinghouseState.withdrawable);
  const accountValue = Number.parseFloat(marginSummary.accountValue);

  const usdc = data.spotState?.balances.find((b) => b.coin === "USDC");
  const spotTotal = usdc ? Number.parseFloat(usdc.total) : 0;
  const spotHold = usdc ? Number.parseFloat(usdc.hold) : 0;

  const card = (
    <Card className="gap-2">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            {ABSTRACTION_LABEL[data.abstraction]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isMining ? (
          <>
            <AnimatedRow label="Perps Withdrawable" value={withdrawable} />
            <AnimatedRow label="Account Value" value={accountValue} />
            <AnimatedRow label="Spot Balance" value={spotTotal} />
            <AnimatedRow label="Spot On Hold" value={spotHold} />
          </>
        ) : (
          <>
            <Row label="Perps Withdrawable" value={fmt(withdrawable)} />
            <Row label="Account Value" value={fmt(accountValue)} />
            <Row label="Spot Balance" value={fmt(spotTotal)} />
            <Row label="Spot On Hold" value={fmt(spotHold)} />
          </>
        )}
      </CardContent>
    </Card>
  );

  if (isMining) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay }}
      >
        <div className="mining-glow-wrapper rounded-xl p-[2px]">{card}</div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut", delay }}
    >
      {card}
    </motion.div>
  );
}

type Mode = "auto" | "manual";

const triggerBase =
  "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-6 py-5 transition-all";
const triggerActive = "border-primary bg-card shadow-md";
const triggerInactive =
  "border-border bg-transparent hover:border-muted-foreground/30 hover:shadow-sm";

function App() {
  const mainnet = useWebData("mainnet");
  const testnet = useWebData("testnet");
  const [mode, setMode] = useState<Mode>("auto");
  const chain = useAutoChain();
  const isMining =
    chain.state.status === "seeding" || chain.state.status === "running";

  if (!mainnet.isConnected) {
    return (
      <main className="page-wrap px-4 py-12">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="text-center text-muted-foreground"
        >
          Connect your wallet to view your Hyperliquid stats.
        </motion.p>
      </main>
    );
  }

  return (
    <main className="page-wrap px-4 py-8 space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatsColumn
          title="Mainnet"
          data={mainnet.data}
          isLoading={mainnet.isLoading}
          delay={0}
        />
        <StatsColumn
          title="Testnet"
          data={testnet.data}
          isLoading={testnet.isLoading}
          delay={0.075}
          isMining={isMining}
        />
      </div>

      <div className="space-y-6">
        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-4">
          <motion.button
            type="button"
            onClick={() => setMode("auto")}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.1 }}
            className={cn(
              triggerBase,
              mode === "auto" ? triggerActive : triggerInactive,
            )}
          >
            <Zap className="h-6 w-6" />
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">Auto Mode</span>
              <Badge variant="secondary" className="text-[10px]">
                Recommended
              </Badge>
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              Automated chain mining
            </span>
          </motion.button>
          <motion.button
            type="button"
            onClick={() => setMode("manual")}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.1 }}
            className={cn(
              triggerBase,
              mode === "manual" ? triggerActive : triggerInactive,
            )}
          >
            <MousePointerClick className="h-6 w-6" />
            <span className="text-lg font-semibold">Manual Mode</span>
            <span className="text-xs font-normal text-muted-foreground">
              Step-by-step control
            </span>
          </motion.button>
        </div>

        {/* Content */}
        <DisclaimerGate>
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              {mode === "auto" ? (
                <AutoMode
                  state={chain.state}
                  start={chain.start}
                  abort={chain.abort}
                  reset={chain.reset}
                />
              ) : (
                <WalletTable />
              )}
            </motion.div>
          </AnimatePresence>
        </DisclaimerGate>
      </div>
    </main>
  );
}
