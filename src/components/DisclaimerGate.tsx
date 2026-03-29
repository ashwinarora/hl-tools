import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "#/components/ui/button";

export default function DisclaimerGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState(false);

  if (accepted) return <>{children}</>;

  return (
    <div className="rounded-lg border border-border bg-muted/50 px-5 py-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Heads up &mdash; hl-tools sends funds directly to Hyperliquid on
            your behalf. We don&apos;t touch or keep any of it. Use at your own
            discretion.
          </p>
          <Button size="sm" onClick={() => setAccepted(true)}>
            Got it, let&apos;s go
          </Button>
        </div>
      </div>
    </div>
  );
}
