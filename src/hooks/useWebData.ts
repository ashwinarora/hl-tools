import type {
	ClearinghouseStateWsEvent,
	SpotStateWsEvent,
} from "@nktkas/hyperliquid";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { type AbstractionMode, fetchUserProfile } from "#/lib/hlActions";
import {
	mainnetSubscriptionClient,
	testnetSubscriptionClient,
} from "#/lib/hlClient";

export type WebDataSnapshot = {
	clearinghouseState: ClearinghouseStateWsEvent["clearinghouseState"];
	spotState: SpotStateWsEvent["spotState"];
	abstraction: AbstractionMode;
};

export function useWebData(network: "mainnet" | "testnet" = "mainnet") {
	const { address, isConnected } = useAccount();
	const [data, setData] = useState<WebDataSnapshot | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const subsRef = useRef<{ unsubscribe(): Promise<void> }[]>([]);

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
		const partial: Partial<WebDataSnapshot> = {};

		const emit = () => {
			if (cancelled) return;
			if (
				partial.clearinghouseState &&
				partial.spotState &&
				partial.abstraction
			) {
				setData(partial as WebDataSnapshot);
				setIsLoading(false);
			}
		};

		const isTestnet = network === "testnet";
		fetchUserProfile(address, isTestnet)
			.then((profile) => {
				if (cancelled) return;
				partial.abstraction = profile.abstraction;
				emit();
			})
			.catch(() => {
				if (cancelled) return;
				partial.abstraction = "disabled";
				emit();
			});

		const subscribeAll = async () => {
			const [chSub, spotSub] = await Promise.all([
				client.clearinghouseState({ user: address, dex: "" }, (event) => {
					partial.clearinghouseState = event.clearinghouseState;
					emit();
				}),
				client.spotState({ user: address }, (event) => {
					partial.spotState = event.spotState;
					emit();
				}),
			]);
			if (cancelled) {
				chSub.unsubscribe();
				spotSub.unsubscribe();
			} else {
				subsRef.current = [chSub, spotSub];
			}
		};

		subscribeAll();

		return () => {
			cancelled = true;
			for (const sub of subsRef.current) sub.unsubscribe();
			subsRef.current = [];
		};
	}, [address, client, network]);

	return { data, isConnected, isLoading };
}
