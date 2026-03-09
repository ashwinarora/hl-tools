import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { useWebData } from "#/hooks/useWebData";
import type { WebData2WsEvent } from "@nktkas/hyperliquid";

export const Route = createFileRoute("/")({ component: App });

function fmt(value: string | number): string {
  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
}: {
  title: string;
  data: WebData2WsEvent | null;
  isLoading: boolean;
}) {
  if (isLoading || !data) {
    return (
      <Card className="gap-2">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
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

  const spotBalances = data.spotState?.balances ?? [];
  const spotTotal = spotBalances.reduce(
    (sum, b) => sum + Number.parseFloat(b.total),
    0,
  );
  const spotHold = spotBalances.reduce(
    (sum, b) => sum + Number.parseFloat(b.hold),
    0,
  );

  return (
    <Card className="gap-2">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <Row label="Perps Withdrawable" value={fmt(withdrawable)} />
        <Row label="Account Value" value={fmt(accountValue)} />
        <Row label="Spot Balance" value={fmt(spotTotal)} />
        <Row label="Spot On Hold" value={fmt(spotHold)} />
      </CardContent>
    </Card>
  );
}

function App() {
  const mainnet = useWebData("mainnet");
  const testnet = useWebData("testnet");

  if (!mainnet.isConnected) {
    return (
      <main className="page-wrap px-4 py-12">
        <p className="text-center text-muted-foreground">
          Connect your wallet to view your Hyperliquid stats.
        </p>
      </main>
    );
  }

  return (
    <main className="page-wrap px-4 py-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatsColumn
          title="Mainnet"
          data={mainnet.data}
          isLoading={mainnet.isLoading}
        />
        <StatsColumn
          title="Testnet"
          data={testnet.data}
          isLoading={testnet.isLoading}
        />
      </div>
    </main>
  );
}
