import {
	type ChannelState,
	isAckFor,
	isSnapshotMessage,
	type Network,
	networkConfig,
	reduceChannel,
	SessionRecorder,
	summarizeMessage,
	type WsChannelSpec,
	type WsSessionFile,
	wsChannel,
} from "@hl-tools/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface StreamItem {
	id: number;
	/** Receipt time (ms since epoch). */
	at: number;
	dir: "in" | "out" | "event";
	channel: string;
	size: number;
	summary: string;
	text: string;
}

export type WsStatus =
	| "idle"
	| "connecting"
	| "open"
	| "closed"
	| "error"
	| "replaying"
	| "replayed";

export interface DisconnectInfo {
	at: number;
	stateBefore: ChannelState;
	messagesBefore: number;
}

export interface ReconnectInfo {
	at: number;
	settledAt: number | null;
	stateAfter: ChannelState | null;
}

const MAX_ITEMS = 300;
const HEARTBEAT_MS = 30_000;

export function useWsWorkbench() {
	const socketRef = useRef<WebSocket | null>(null);
	const itemsRef = useRef<StreamItem[]>([]);
	const stateRef = useRef<ChannelState>({});
	const idRef = useRef(0);
	const statsRef = useRef({
		total: 0,
		bytes: 0,
		lastDataAt: null as number | null,
		startedAt: null as number | null,
		dataCount: 0,
	});
	const specRef = useRef<WsChannelSpec | null>(null);
	const subRef = useRef<Record<string, unknown> | null>(null);
	const recorderRef = useRef<SessionRecorder | null>(null);
	const replayTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
	const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
	const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [, setTick] = useState(0);
	const [status, setStatus] = useState<WsStatus>("idle");
	const [statusDetail, setStatusDetail] = useState<string | null>(null);
	const [session, setSession] = useState<{
		network: Network;
		url: string;
		channel: WsChannelSpec;
		subscription: Record<string, unknown>;
		mode: "live" | "replay";
	} | null>(null);
	const [ack, setAck] = useState<StreamItem | null>(null);
	const [firstSnapshot, setFirstSnapshot] = useState<StreamItem | null>(null);
	const [disconnect, setDisconnect] = useState<DisconnectInfo | null>(null);
	const [reconnect, setReconnect] = useState<ReconnectInfo | null>(null);
	const [recording, setRecording] = useState(false);
	const reconnectRef = useRef<ReconnectInfo | null>(null);
	const firstSeenRef = useRef(false);

	const schedule = useCallback(() => {
		if (renderTimer.current) return;
		renderTimer.current = setTimeout(() => {
			renderTimer.current = null;
			setTick((t) => t + 1);
		}, 150);
	}, []);

	const push = useCallback(
		(
			dir: StreamItem["dir"],
			channel: string,
			text: string,
			summary: string,
			at = Date.now(),
		) => {
			const item: StreamItem = {
				id: ++idRef.current,
				at,
				dir,
				channel,
				size: text.length,
				summary,
				text,
			};
			itemsRef.current = [item, ...itemsRef.current].slice(0, MAX_ITEMS);
			statsRef.current.total++;
			statsRef.current.bytes += text.length;
			recorderRef.current?.push(dir, dir === "event" ? summary : text, at);
			if (recorderRef.current?.truncated) setRecording(false);
			schedule();
			return item;
		},
		[schedule],
	);

	const handleIncoming = useCallback(
		(text: string, at = Date.now()) => {
			let msg: { channel?: string; data?: unknown };
			try {
				msg = JSON.parse(text);
			} catch {
				push("in", "?", text, "unparseable message", at);
				return;
			}
			const channel = String(msg.channel ?? "?");
			const spec = specRef.current;
			const item = push(
				"in",
				channel,
				text,
				summarizeMessage(channel, msg.data),
				at,
			);
			if (
				channel === "subscriptionResponse" &&
				subRef.current &&
				isAckFor(msg, subRef.current)
			) {
				setAck((a) => a ?? item);
				return;
			}
			if (
				!spec ||
				(channel !== spec.channel &&
					!(spec.type === "activeAssetCtx" && channel === "activeSpotAssetCtx"))
			)
				return;
			statsRef.current.lastDataAt = at;
			statsRef.current.dataCount++;
			const first = !firstSeenRef.current;
			firstSeenRef.current = true;
			if (first && isSnapshotMessage(spec, msg.data, true))
				setFirstSnapshot(item);
			else if (first) setFirstSnapshot(item);
			stateRef.current = reduceChannel(spec, stateRef.current, msg.data);
			const rc = reconnectRef.current;
			if (rc && rc.settledAt === null) {
				// The first data message after re-subscribing is the fresh snapshot (or replay).
				const settled = { ...rc, settledAt: at, stateAfter: stateRef.current };
				reconnectRef.current = settled;
				setReconnect(settled);
			}
		},
		[push],
	);

	const stopHeartbeat = useCallback(() => {
		if (heartbeat.current) clearInterval(heartbeat.current);
		heartbeat.current = null;
	}, []);

	const openSocket = useCallback(
		(url: string, subscription: Record<string, unknown>) => {
			setStatus("connecting");
			setStatusDetail(null);
			let ws: WebSocket;
			try {
				ws = new WebSocket(url);
			} catch (e) {
				setStatus("error");
				setStatusDetail((e as Error).message);
				return;
			}
			socketRef.current = ws;
			ws.onopen = () => {
				if (socketRef.current !== ws) return;
				setStatus("open");
				push("event", "open", "", "connection open");
				const msg = JSON.stringify({ method: "subscribe", subscription });
				push("out", "subscribe", msg, "subscribe");
				ws.send(msg);
				stopHeartbeat();
				heartbeat.current = setInterval(() => {
					if (ws.readyState === WebSocket.OPEN) {
						const ping = JSON.stringify({ method: "ping" });
						push("out", "ping", ping, "ping (keep-alive)");
						ws.send(ping);
					}
				}, HEARTBEAT_MS);
			};
			ws.onmessage = (e) => {
				if (socketRef.current !== ws) return;
				handleIncoming(String(e.data));
			};
			ws.onerror = () => {
				if (socketRef.current !== ws) return;
				setStatus("error");
				setStatusDetail(
					"The WebSocket reported an error (network failure, blocked origin or server rejection).",
				);
			};
			ws.onclose = (e) => {
				if (socketRef.current !== ws) return;
				stopHeartbeat();
				setStatus("closed");
				setStatusDetail(
					`Closed by ${e.wasClean ? "server" : "network"} (code ${e.code}${e.reason ? `: ${e.reason}` : ""}).`,
				);
				push(
					"event",
					"close",
					"",
					`closed · code ${e.code}${e.reason ? ` · ${e.reason}` : ""}`,
				);
			};
		},
		[handleIncoming, push, stopHeartbeat],
	);

	const reset = useCallback(() => {
		for (const t of replayTimers.current) clearTimeout(t);
		replayTimers.current = [];
		itemsRef.current = [];
		stateRef.current = {};
		statsRef.current = {
			total: 0,
			bytes: 0,
			lastDataAt: null,
			startedAt: Date.now(),
			dataCount: 0,
		};
		firstSeenRef.current = false;
		reconnectRef.current = null;
		setAck(null);
		setFirstSnapshot(null);
		setDisconnect(null);
		setReconnect(null);
	}, []);

	const closeSocket = useCallback(
		(code = 1000, reason = "closed by user") => {
			stopHeartbeat();
			const ws = socketRef.current;
			socketRef.current = null;
			if (
				ws &&
				(ws.readyState === WebSocket.OPEN ||
					ws.readyState === WebSocket.CONNECTING)
			)
				ws.close(code, reason);
		},
		[stopHeartbeat],
	);

	const connect = useCallback(
		(
			network: Network,
			channelType: string,
			subscription: Record<string, unknown>,
		) => {
			const spec = wsChannel(channelType);
			if (!spec) return;
			closeSocket();
			reset();
			specRef.current = spec;
			subRef.current = subscription;
			const url = networkConfig(network).wsUrl;
			setSession({ network, url, channel: spec, subscription, mode: "live" });
			if (recorderRef.current)
				recorderRef.current = new SessionRecorder(
					network,
					url,
					spec.type,
					subscription,
				);
			openSocket(url, subscription);
		},
		[closeSocket, openSocket, reset],
	);

	const unsubscribe = useCallback(() => {
		const ws = socketRef.current;
		if (ws?.readyState === WebSocket.OPEN && subRef.current) {
			const msg = JSON.stringify({
				method: "unsubscribe",
				subscription: subRef.current,
			});
			push("out", "unsubscribe", msg, "unsubscribe");
			ws.send(msg);
		}
		closeSocket();
		setStatus("closed");
		setStatusDetail("Unsubscribed and closed by you.");
	}, [closeSocket, push]);

	const simulateDisconnect = useCallback(() => {
		const before = JSON.parse(JSON.stringify(stateRef.current)) as ChannelState;
		const info = {
			at: Date.now(),
			stateBefore: before,
			messagesBefore: statsRef.current.dataCount,
		};
		setDisconnect(info);
		setReconnect(null);
		reconnectRef.current = null;
		push(
			"event",
			"simulated-disconnect",
			"",
			"simulated disconnect — socket closed locally, state kept",
		);
		closeSocket(4000, "simulated disconnect");
		setStatus("closed");
		setStatusDetail(
			"Simulated disconnect: the socket was closed in this browser. Messages the server sends now are lost.",
		);
	}, [closeSocket, push]);

	const reconnectNow = useCallback(() => {
		if (!session || session.mode !== "live") return;
		const info: ReconnectInfo = {
			at: Date.now(),
			settledAt: null,
			stateAfter: null,
		};
		reconnectRef.current = info;
		setReconnect(info);
		push("event", "reconnect", "", "reconnecting and re-subscribing");
		openSocket(session.url, session.subscription);
	}, [openSocket, push, session]);

	const startRecording = useCallback(() => {
		if (!session) return;
		recorderRef.current = new SessionRecorder(
			session.network,
			session.url,
			session.channel.type,
			session.subscription,
		);
		setRecording(true);
	}, [session]);

	const stopRecording = useCallback((): WsSessionFile | null => {
		const rec = recorderRef.current;
		recorderRef.current = null;
		setRecording(false);
		return rec ? rec.toFile() : null;
	}, []);

	const replay = useCallback(
		(file: WsSessionFile, speed: number) => {
			const spec = wsChannel(file.channel);
			if (!spec) return;
			closeSocket();
			reset();
			specRef.current = spec;
			subRef.current = file.subscription;
			setSession({
				network: file.network,
				url: file.url,
				channel: spec,
				subscription: file.subscription,
				mode: "replay",
			});
			setStatus("replaying");
			setStatusDetail(
				`Replaying ${file.messages.length} recorded messages at ${speed === 0 ? "maximum speed" : `${speed}×`}.`,
			);
			const base = Date.now();
			const last = file.messages.at(-1)?.t ?? 0;
			for (const m of file.messages) {
				const delay = speed === 0 ? 0 : m.t / speed;
				replayTimers.current.push(
					setTimeout(() => {
						const at = base + (speed === 0 ? m.t : delay);
						if (m.dir === "in") handleIncoming(m.text, at);
						else if (m.dir === "out")
							push("out", "out", m.text, "sent (recorded)", at);
						else push("event", "event", "", m.text, at);
					}, delay),
				);
			}
			replayTimers.current.push(
				setTimeout(
					() => {
						setStatus("replayed");
						setStatusDetail(
							`Replay finished (${file.messages.length} messages, ${(last / 1000).toFixed(1)} s recorded).`,
						);
					},
					speed === 0 ? 10 : last / speed + 20,
				),
			);
		},
		[closeSocket, handleIncoming, push, reset],
	);

	useEffect(
		() => () => {
			closeSocket();
			for (const t of replayTimers.current) clearTimeout(t);
			if (renderTimer.current) clearTimeout(renderTimer.current);
		},
		[closeSocket],
	);

	return {
		status,
		statusDetail,
		session,
		ack,
		firstSnapshot,
		items: itemsRef.current,
		stats: statsRef.current,
		state: stateRef.current,
		disconnect,
		reconnect,
		recording,
		recordSize: recorderRef.current?.size ?? null,
		connect,
		unsubscribe,
		simulateDisconnect,
		reconnectNow,
		startRecording,
		stopRecording,
		replay,
	};
}
