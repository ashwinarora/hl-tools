import { ShieldAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Card, CardContent } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";

export default function DisclaimerGate({ children }: { children: ReactNode }) {
	const [accepted, setAccepted] = useState(false);

	if (accepted) return <>{children}</>;

	return (
		<Card className="border-amber-500/40 bg-amber-500/5">
			<CardContent className="flex flex-col gap-4 py-5">
				<div className="flex items-start gap-3">
					<ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
					<div className="space-y-2 text-sm text-muted-foreground">
						<p>
							<strong className="text-foreground">Use at your own risk.</strong>{" "}
							hl-tools is not responsible for any loss of funds. All
							transactions are irreversible and interact directly with
							Hyperliquid.
						</p>
						<p>
							All funds go directly to Hyperliquid &mdash; this platform does
							not hold, custody, or take any portion of your funds.
						</p>
					</div>
				</div>
				<label
					htmlFor="disclaimer-accept"
					className="flex cursor-pointer items-center gap-2 text-sm font-medium"
				>
					<Checkbox
						id="disclaimer-accept"
						checked={accepted}
						onCheckedChange={(v) => setAccepted(v === true)}
					/>
					I understand and accept the risks
				</label>
			</CardContent>
		</Card>
	);
}
