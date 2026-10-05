import {
	buildSubscription,
	type Network,
	parseSessionFile,
	resolveAsset,
	sanitizeSession,
	serializeSession,
	WS_CHANNELS,
	WS_LIMITS,
	type WsSessionFile,
	wsChannel,
} from "@hl-tools/core";
import sampleTrades from "@hl-tools/core/fixtures/ws/mainnet-btc-trades.json?raw";
import { createFileRoute } from "@tanstack/react-router";
import {
	CirclePause,
	Download,
	Play,
	PlugZap,
	Radio,
	RotateCw,
	Square,
	Trash2,
	Unplug,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import {
	Field,
	Panel,
	Segmented,
	Select,
	TextInput,
	ToolPage,
} from "#/components/hub/layout";
import {
	Callout,
	formatTimestamp,
	IssueList,
	NetworkBadge,
	Pill,
} from "#/components/hub/status";
import {
	ChannelTable,
	DisconnectDiff,
	Freshness,
	MessageBlock,
	SemanticsCard,
	StreamList,
} from "#/components/tools/websocket/panels";
import { useWsWorkbench } from "#/components/tools/websocket/useWsWorkbench";
import { Button } from "#/components/ui/button";
import { useUniverse } from "#/hooks/useHyperliquid";
import {
	deleteSession,
	listSessions,
	type StoredSession,
	saveSession,
} from "#/lib/idb";
import { tool } from "#/lib/tools";
import { useHandoffStore } from "#/store/handoffStore";
import { useNetwork, useNetworkHydrated } from "#/store/networkStore";

export const Route = createFileRoute("/tools/websocket")({
	validateSearch: (s: Record<string, unknown>): { sample?: string } => ({
		sample: typeof s.sample === "string" ? s.sample : undefined,
	}),
	head: () => ({ meta: [{ title: "WebSocket Workbench — hl-tools" }] }),
	component: WebSocketTool,
});

const SAMPLE_USER: Record<Network, string> = {
	mainnet: "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
	testnet: "0x4418ed2e9cccc6e32ffbd803b507dd3e4243aa15",
};

const SAMPLES: Record<
	string,
	{ channel: string; params: Record<string, string> }
> = {
	l2book: { channel: "l2Book", params: { coin: "BTC" } },
	trades: { channel: "trades", params: { coin: "BTC" } },
};

function download(filename: string, text: string) {
	const url = URL.createObjectURL(
		new Blob([text], { type: "application/json" }),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WebSocketTool() {
	const search = Route.useSearch();
	const network = useNetwork();
	const universe = useUniverse(network);
	const take = useHandoffStore((s) => s.take);
	const sample = search.sample ? SAMPLES[search.sample] : undefined;
	const [channelType, setChannelType] = useState(sample?.channel ?? "l2Book");
	const [params, setParams] = useState<Record<string, string>>(
		sample?.params ?? { coin: "BTC" },
	);
	const [speed, setSpeed] = useState("1");
	const [sessions, setSessions] = useState<StoredSession[]>([]);
	const [idbError, setIdbError] = useState<string | null>(null);
	const [importError, setImportError] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const wb = useWsWorkbench();
	const spec = wsChannel(channelType);
	const built = useMemo(
		() => (spec ? buildSubscription(spec, params) : null),
		[spec, params],
	);

	useEffect(() => {
		const handed = take("websocket");
		if (!handed) return;
		try {
			const msg = JSON.parse(handed) as {
				subscription?: Record<string, unknown>;
			};
			const sub = msg.subscription;
			if (sub && typeof sub.type === "string" && wsChannel(sub.type)) {
				setChannelType(sub.type);
				setParams(
					Object.fromEntries(
						Object.entries(sub)
							.filter(([k]) => k !== "type")
							.map(([k, v]) => [k, String(v)]),
					),
				);
			}
		} catch {
			// Not a subscription message; ignore.
		}
	}, [take]);

	// "Try with a sample" connects straight away (a public market channel,
	// nothing to send but the subscription) once the stored network is known.
	const hydrated = useNetworkHydrated();
	const autoStarted = useRef(false);
	useEffect(() => {
		if (!sample || !hydrated || autoStarted.current || !built?.subscription)
			return;
		autoStarted.current = true;
		wb.connect(network, channelType, built.subscription);
	}, [sample, hydrated, built, wb, network, channelType]);

	const refreshSessions = useCallback(async () => {
		try {
			setSessions(await listSessions());
			setIdbError(null);
		} catch (e) {
			setIdbError((e as Error).message);
		}
	}, []);
	useEffect(() => {
		void refreshSessions();
	}, [refreshSessions]);

	// Coin hint through the resolver: WS expects coin strings like "@107", not "HYPE/USDC".
	const coinHint = useMemo(() => {
		const coin = params.coin?.trim();
		if (!coin || !universe.data || !spec?.params.some((p) => p.kind === "coin"))
			return null;
		const direct = universe.data.byCoin.get(coin);
		if (direct)
			return {
				ok: true,
				text: `${direct.displaySymbol} · ${direct.venue.kind} on ${network}`,
			};
		const r = resolveAsset(universe.data, coin, { limit: 3 }).matches.filter(
			(m) => m.kind === "asset",
		);
		const first = r[0];
		return {
			ok: false,
			text:
				first && first.kind === "asset"
					? `"${coin}" is not a coin string on ${network}. Did you mean ${first.asset.coin} (${first.asset.displaySymbol})?`
					: `"${coin}" is not a coin on ${network}.`,
		};
	}, [params.coin, universe.data, spec, network]);

	const live = wb.status === "open" || wb.status === "replaying";
	const sessionNetworkMismatch =
		wb.session && wb.session.mode === "live" && wb.session.network !== network;

	const stopAndSave = async () => {
		const file = wb.stopRecording();
		if (!file) return;
		try {
			await saveSession(file);
			await refreshSessions();
		} catch (e) {
			setIdbError((e as Error).message);
		}
	};

	return (
		<ToolPage tool={tool("websocket")}>
			<div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
				<Panel
					title="Subscription"
					description={`Channels on ${network}. Parameters are validated before anything is sent.`}
				>
					<div className="space-y-4">
						<Field label="Channel" htmlFor="ws-channel">
							<Select
								id="ws-channel"
								value={channelType}
								onChange={(e) => {
									const next = wsChannel(e.target.value);
									setChannelType(e.target.value);
									setParams(
										Object.fromEntries(
											(next?.params ?? [])
												.filter(
													(p) =>
														p.required ||
														p.kind === "coin" ||
														p.kind === "user",
												)
												.map((p) => [
													p.name,
													p.kind === "coin"
														? (params.coin ?? "BTC")
														: p.kind === "user"
															? (params.user ?? SAMPLE_USER[network])
															: p.kind === "interval"
																? "1m"
																: "",
												]),
										),
									);
								}}
							>
								{WS_CHANNELS.map((c) => (
									<option key={c.type} value={c.type}>
										{c.type} — {c.label}
									</option>
								))}
							</Select>
						</Field>
						{spec?.params.map((p) => (
							<Field
								key={p.name}
								htmlFor={`ws-${p.name}`}
								label={
									<span>
										<span className="font-mono">{p.name}</span>
										{!p.required && (
											<span className="font-normal text-muted-foreground">
												{" "}
												(optional)
											</span>
										)}
									</span>
								}
								hint={p.kind === "coin" && coinHint ? undefined : p.description}
								error={
									p.kind === "coin" && coinHint && !coinHint.ok
										? coinHint.text
										: undefined
								}
							>
								{p.kind === "interval" ? (
									<Select
										id={`ws-${p.name}`}
										value={params[p.name] ?? ""}
										onChange={(e) =>
											setParams({ ...params, [p.name]: e.target.value })
										}
									>
										{[
											"1m",
											"3m",
											"5m",
											"15m",
											"30m",
											"1h",
											"2h",
											"4h",
											"8h",
											"12h",
											"1d",
											"3d",
											"1w",
											"1M",
										].map((i) => (
											<option key={i}>{i}</option>
										))}
									</Select>
								) : p.kind === "bool" ? (
									<Segmented
										label={p.name}
										value={params[p.name] === "true" ? "true" : "false"}
										onChange={(v) => setParams({ ...params, [p.name]: v })}
										options={[
											{ value: "false", label: "false" },
											{ value: "true", label: "true" },
										]}
									/>
								) : (
									<TextInput
										id={`ws-${p.name}`}
										mono
										value={params[p.name] ?? ""}
										onChange={(e) =>
											setParams({ ...params, [p.name]: e.target.value })
										}
										placeholder={
											p.kind === "user"
												? SAMPLE_USER[network]
												: p.kind === "coin"
													? "BTC · @107 · xyz:TSLA"
													: ""
										}
									/>
								)}
								{p.kind === "coin" && coinHint?.ok && (
									<p className="text-xs text-success">{coinHint.text}</p>
								)}
							</Field>
						))}
						{built && built.issues.length > 0 && (
							<IssueList issues={built.issues} />
						)}
						{built?.message && (
							<CodeBlock
								title="Subscription message"
								content={JSON.stringify(built.message, null, 2)}
								maxHeight="10rem"
							/>
						)}
						<div className="flex flex-wrap gap-2">
							<Button
								variant="brand"
								onClick={() =>
									built?.subscription &&
									wb.connect(network, channelType, built.subscription)
								}
								disabled={!built?.subscription}
							>
								<PlugZap className="size-4" />{" "}
								{wb.session ? "Resubscribe" : "Connect & subscribe"}
							</Button>
							<Button
								variant="outline"
								onClick={wb.unsubscribe}
								disabled={wb.status !== "open"}
							>
								<Square className="size-4" /> Unsubscribe
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							One connection at a time. Limits: {WS_LIMITS.maxConnections}{" "}
							connections, {WS_LIMITS.maxSubscriptions} subscriptions and{" "}
							{WS_LIMITS.maxUniqueUsersInUserSubscriptions} distinct users per
							IP; idle connections close after {WS_LIMITS.idleTimeoutMs / 1000}{" "}
							s, so the workbench pings every 30 s.
						</p>
					</div>
				</Panel>

				<div className="min-w-0 space-y-5">
					<Panel
						title={
							<span className="flex flex-wrap items-center gap-2">
								Connection
								{wb.session && <NetworkBadge network={wb.session.network} />}
								<Pill
									tone={
										wb.status === "open"
											? "success"
											: wb.status === "error"
												? "danger"
												: wb.status === "replaying" || wb.status === "replayed"
													? "info"
													: "neutral"
									}
								>
									{wb.status}
								</Pill>
								{wb.session?.mode === "replay" && (
									<Pill tone="info">replay</Pill>
								)}
							</span>
						}
						description={
							wb.session ? (
								<span className="break-all font-mono">{wb.session.url}</span>
							) : (
								"Not connected."
							)
						}
						actions={
							<>
								<Button
									size="sm"
									variant="outline"
									onClick={wb.simulateDisconnect}
									disabled={wb.status !== "open"}
									title="Close the socket in this browser only"
								>
									<Unplug className="size-3.5" /> Simulate disconnect
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={wb.reconnectNow}
									disabled={
										!wb.session ||
										wb.session.mode !== "live" ||
										wb.status === "open" ||
										wb.status === "connecting"
									}
								>
									<RotateCw className="size-3.5" /> Reconnect
								</Button>
							</>
						}
					>
						<div className="space-y-3">
							{wb.statusDetail && (
								<p className="text-sm text-muted-foreground">
									{wb.statusDetail}
								</p>
							)}
							{sessionNetworkMismatch && (
								<Callout
									tone="warning"
									title={`This connection is on ${wb.session?.network}; the global network is now ${network}`}
								>
									The stream stays on {wb.session?.network}. Resubscribe to
									switch.
								</Callout>
							)}
							<div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
								<Freshness
									lastDataAt={wb.stats.lastDataAt}
									spec={wb.session?.channel ?? null}
									live={live}
								/>
								<span className="font-mono">{wb.stats.total} messages</span>
								<span className="font-mono">
									{(wb.stats.bytes / 1024).toFixed(1)} KB
								</span>
								{wb.stats.startedAt && wb.session && (
									<span className="font-mono">
										since {formatTimestamp(wb.stats.startedAt).slice(11)}
									</span>
								)}
							</div>
						</div>
					</Panel>
					<div className="grid min-w-0 gap-4 md:grid-cols-2">
						<MessageBlock
							title="Acknowledgement"
							item={wb.ack}
							empty="The subscriptionResponse ack appears here."
						/>
						<MessageBlock
							title="First data message"
							item={wb.firstSnapshot}
							empty="The first message on the channel (the snapshot, where the channel has one) appears here."
						/>
					</div>
					{spec && <SemanticsCard spec={wb.session?.channel ?? spec} />}
				</div>
			</div>

			<Panel
				className="mt-5"
				title="Live stream"
				description="Newest first; last 300 messages kept in memory. Click a row to expand it."
				bodyClassName="p-0"
			>
				<StreamList items={wb.items} />
			</Panel>

			<div className="mt-5">
				<DisconnectDiff
					network={wb.session?.network ?? null}
					spec={wb.session?.channel ?? null}
					subscription={wb.session?.subscription ?? null}
					disconnect={wb.disconnect}
					reconnect={wb.reconnect}
				/>
			</div>

			<Panel
				className="mt-5"
				title="Record & replay"
				description="Recordings are stored in this browser (IndexedDB), bounded to 5,000 messages / 8 MB / 30 minutes. Exports are sanitised: every address is replaced with a stable pseudonym."
				actions={
					<>
						{wb.recording ? (
							<Button size="sm" variant="outline" onClick={stopAndSave}>
								<CirclePause className="size-3.5 text-danger" /> Stop & save
							</Button>
						) : (
							<Button
								size="sm"
								variant="outline"
								onClick={wb.startRecording}
								disabled={wb.status !== "open"}
							>
								<Radio className="size-3.5" /> Record
							</Button>
						)}
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								const parsed = parseSessionFile(sampleTrades);
								if (parsed.ok) wb.replay(parsed.file, Number(speed));
							}}
							title="A sanitised 8-second recording of mainnet BTC trades bundled with hl-core's fixtures"
						>
							<Play className="size-3.5" /> Replay bundled sample
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => fileRef.current?.click()}
						>
							<Upload className="size-3.5" /> Import session
						</Button>
						<input
							ref={fileRef}
							type="file"
							accept="application/json,.json"
							className="hidden"
							onChange={async (e) => {
								const f = e.target.files?.[0];
								e.target.value = "";
								if (!f) return;
								const parsed = parseSessionFile(await f.text());
								if (!parsed.ok) {
									setImportError(parsed.error);
									return;
								}
								setImportError(null);
								await saveSession(parsed.file).catch((err: Error) =>
									setIdbError(err.message),
								);
								await refreshSessions();
								wb.replay(parsed.file, Number(speed));
							}}
						/>
					</>
				}
			>
				<div className="space-y-4">
					{wb.recording && wb.recordSize && (
						<p className="flex items-center gap-2 text-sm">
							<span
								className="size-2 animate-pulse rounded-full bg-danger"
								aria-hidden
							/>{" "}
							Recording · {wb.recordSize.messages} messages ·{" "}
							{(wb.recordSize.bytes / 1024).toFixed(1)} KB
						</p>
					)}
					{importError && (
						<Callout tone="danger" title="Could not import that file">
							{importError}
						</Callout>
					)}
					{idbError && (
						<Callout tone="warning" title="Local storage unavailable">
							{idbError}
						</Callout>
					)}
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<span className="text-muted-foreground">Replay speed</span>
						<Segmented
							size="sm"
							label="Replay speed"
							value={speed}
							onChange={setSpeed}
							options={[
								{ value: "1", label: "1×" },
								{ value: "10", label: "10×" },
								{ value: "0", label: "instant" },
							]}
						/>
					</div>
					{sessions.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No recordings yet. Connect, press Record, then Stop & save — or
							import a session file.
						</p>
					) : (
						<ul className="divide-y divide-border rounded-md border border-border">
							{sessions.map((s) => (
								<li
									key={s.id}
									className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
								>
									<div className="min-w-0 text-sm">
										<span className="font-mono">{s.file.channel}</span>{" "}
										<span className="text-muted-foreground">
											{String(s.file.subscription.coin ?? "")} ·{" "}
											{s.file.messages.length} msgs ·{" "}
											{((s.file.endedAt - s.file.startedAt) / 1000).toFixed(1)}{" "}
											s · saved {formatTimestamp(s.savedAt).slice(0, 19)}
										</span>{" "}
										<NetworkBadge network={s.file.network} />
										{s.file.truncated && (
											<Pill tone="warning" className="ml-1">
												truncated
											</Pill>
										)}
									</div>
									<div className="flex gap-1">
										<Button
											size="xs"
											variant="ghost"
											onClick={() => wb.replay(s.file, Number(speed))}
										>
											<Play className="size-3" /> Replay
										</Button>
										<Button
											size="xs"
											variant="ghost"
											onClick={() =>
												download(
													`hl-ws-${s.file.channel}-${s.id}.json`,
													serializeSession(
														sanitizeSession(s.file as WsSessionFile),
													),
												)
											}
										>
											<Download className="size-3" /> Export
										</Button>
										<Button
											size="xs"
											variant="ghost"
											onClick={async () => {
												if (s.id !== undefined) await deleteSession(s.id);
												await refreshSessions();
											}}
											aria-label="Delete recording"
										>
											<Trash2 className="size-3" />
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</Panel>

			<section className="mt-8 space-y-3" aria-labelledby="ws-semantics">
				<h2 id="ws-semantics" className="text-base font-semibold">
					Ordering and recovery by channel
				</h2>
				<p className="max-w-3xl text-sm text-muted-foreground">
					No Hyperliquid WebSocket channel has a sequence number or resume
					cursor. What a client can do after a reconnect depends on whether the
					channel sends full snapshots, a snapshot followed by deltas, or bare
					events.
				</p>
				<ChannelTable />
			</section>
		</ToolPage>
	);
}
