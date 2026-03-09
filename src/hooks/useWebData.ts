import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import type { WebData2WsEvent } from "@nktkas/hyperliquid";
import {
	mainnetSubscriptionClient,
	testnetSubscriptionClient,
} from "#/lib/hlClient";

export function useWebData(network: "mainnet" | "testnet" = "mainnet") {
	const { address, isConnected } = useAccount();
	const [data, setData] = useState<WebData2WsEvent | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const subRef = useRef<{ unsubscribe(): Promise<void> } | null>(null);

	const client =
		network === "testnet"
			? testnetSubscriptionClient
			: mainnetSubscriptionClient;

	useEffect(() => {
		if (!address) {
			setData(null);
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		let cancelled = false;

		client
			.webData2({ user: address }, (event) => {
				if (!cancelled) {
					setData(event);
					setIsLoading(false);
				}
			})
			.then((sub) => {
				if (cancelled) {
					sub.unsubscribe();
				} else {
					subRef.current = sub;
				}
			});

		return () => {
			cancelled = true;
			subRef.current?.unsubscribe();
			subRef.current = null;
		};
	}, [address, client]);

	return { data, isConnected, isLoading };
}
