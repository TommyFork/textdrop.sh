"use client";

import { Fire } from "@phosphor-icons/react";
import { useState } from "react";
import type { PasteFormat } from "@/lib/constants";
import {
	base64urlDecode,
	base64urlEncode,
	deriveKeyFromPassword,
	unwrapDataKey,
} from "@/lib/crypto";
import type { RenderRequest, RenderResponse } from "@/workers/render.worker";
import { PasteView } from "./paste-view";

interface BurnGateProps {
	id: string;
	/** Passed from server metadata so we can collect the password BEFORE consuming the paste. */
	passwordProtected?: boolean;
}

interface FetchedPaste {
	id: string;
	ciphertext: string;
	iv: string;
	format: PasteFormat;
	language?: string;
	createdAt: number;
	expiresAt: number | null;
	burnAfterRead: boolean;
	viewCount: number;
	sizeBytes: number;
	passwordProtected: boolean;
	key?: string;
	salt?: string;
	wrappedKey?: string;
	wrapIv?: string;
}

type State =
	| "confirm"
	| "loading"
	| {
			status: "done";
			paste: FetchedPaste;
			html: string;
			plaintext: string;
			keyB64url: string;
	  }
	| "error";

export function BurnGate({ id, passwordProtected }: BurnGateProps) {
	const [state, setState] = useState<State>("confirm");
	const [error, setError] = useState<string | null>(null);
	const [passwordInput, setPasswordInput] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);

	// Fetch (consuming) the paste, then decrypt it with the given key.
	async function handleReveal(keyOverride?: string) {
		if (passwordProtected && !keyOverride && !passwordInput) return;
		setState("loading");

		try {
			const res = await fetch(`/api/paste/${id}`);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error ?? "Paste not found or already viewed");
			}
			const paste: FetchedPaste = await res.json();

			let keyB64url: string;

			if (paste.passwordProtected) {
				// Password was collected before this fetch — derive the key now.
				const saltBytes = base64urlDecode(paste.salt!);
				const wrappingKey = await deriveKeyFromPassword(
					passwordInput,
					saltBytes,
				);
				let dataKey: CryptoKey;
				try {
					dataKey = await unwrapDataKey(
						paste.wrappedKey!,
						paste.wrapIv!,
						wrappingKey,
					);
				} catch {
					// Wrong password — paste is already consumed (burn-after-read).
					throw new Error(
						"Incorrect password. This paste has been permanently deleted.",
					);
				}
				keyB64url = base64urlEncode(
					await crypto.subtle.exportKey("raw", dataKey),
				);
			} else {
				keyB64url = keyOverride ?? paste.key!;
			}

			await decryptPaste(paste, keyB64url);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Something went wrong";
			setError(message);
			if (passwordProtected && message.includes("password")) {
				setPasswordError(message);
			}
			setState("error");
		}
	}

	async function decryptPaste(paste: FetchedPaste, keyB64url: string) {
		await new Promise<void>((resolve, reject) => {
			let worker: Worker | null = null;
			let cleanupTimeout: NodeJS.Timeout | null = null;

			const cleanup = () => {
				if (worker) {
					worker.terminate();
					worker = null;
				}
				if (cleanupTimeout) {
					clearTimeout(cleanupTimeout);
					cleanupTimeout = null;
				}
			};

			try {
				worker = new Worker(
					new URL("../workers/render.worker.ts", import.meta.url),
					{ type: "module" },
				);

				cleanupTimeout = setTimeout(() => {
					cleanup();
					reject(new Error("Worker timeout"));
				}, 10000);

				worker.onmessage = (event: MessageEvent<RenderResponse>) => {
					cleanup();
					if (event.data.type === "success") {
						history.replaceState(null, "", window.location.pathname);
						setState({
							status: "done",
							paste,
							html: event.data.html,
							plaintext: event.data.plaintext,
							keyB64url,
						});
						resolve();
					} else {
						reject(new Error(event.data.message));
					}
				};

				worker.onerror = (err) => {
					cleanup();
					reject(new Error(err.message || "Worker error"));
				};

				const req: RenderRequest = {
					type: "render",
					ciphertext: paste.ciphertext,
					iv: paste.iv,
					keyB64url,
					format: paste.format,
					language: paste.language,
				};
				worker.postMessage(req);
			} catch (err) {
				cleanup();
				throw err;
			}
		});
	}

	if (typeof state === "object" && state.status === "done") {
		return (
			<PasteView
				paste={state.paste}
				html={state.html}
				plaintext={state.plaintext}
				keyB64url={state.keyB64url}
			/>
		);
	}

	return (
		<div className="mx-auto w-full max-w-4xl">
			{/* Toolbar */}
			<div className="mb-3 flex items-center gap-2">
				<a
					href="/"
					className="text-sm font-bold tracking-tighter transition-colors hover:opacity-70 bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent"
				>
					textdrop.sh
				</a>
			</div>

			{/* Gate */}
			<div className="overflow-hidden rounded-xl border border-orange-500/20 bg-orange-500/[0.03] shadow-[0_0_0_1px_oklch(1_0_0/0.03),0_32px_64px_-16px_oklch(0_0_0/0.7)]">
				<div className="flex flex-col items-center gap-5 px-6 py-16 text-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full border border-orange-500/20 bg-orange-500/10">
						<Fire size={28} weight="fill" className="text-orange-400" />
					</div>
					<div>
						<h2 className="text-base font-semibold text-foreground">
							Burn after read
						</h2>
						<p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground/60">
							This paste will be{" "}
							<span className="text-orange-400/80">permanently deleted</span>{" "}
							the moment you view it. This cannot be undone.
						</p>
					</div>

					{state === "error" ? (
						<p className="text-sm text-destructive">{error}</p>
					) : passwordProtected && state === "confirm" ? (
						<div className="flex flex-col items-center gap-2">
							<p className="text-xs text-muted-foreground/60">
								This paste is password-protected. Enter the password to view and
								burn it.
							</p>
							<input
								type="password"
								value={passwordInput}
								onChange={(e) => setPasswordInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && passwordInput) {
										e.preventDefault();
										handleReveal();
									}
								}}
								placeholder="Enter password..."
								className="w-full max-w-xs rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/25 focus:border-orange-500/40 focus:outline-none focus:ring-1 focus:ring-orange-500/20"
								autoFocus
							/>
							{passwordError && (
								<p className="text-xs text-destructive">{passwordError}</p>
							)}
							<button
								type="button"
								onClick={() => handleReveal()}
								disabled={!passwordInput}
								className="mt-1 inline-flex h-9 items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-5 text-sm font-medium text-orange-400 transition-all hover:bg-orange-500/20 disabled:pointer-events-none disabled:opacity-50"
							>
								<Fire size={14} weight="fill" />
								Decrypt & burn
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => handleReveal()}
							disabled={state === "loading"}
							className="mt-1 inline-flex h-9 items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-5 text-sm font-medium text-orange-400 transition-all hover:bg-orange-500/20 disabled:pointer-events-none disabled:opacity-50"
						>
							<Fire size={14} weight="fill" />
							{state === "loading" ? "Decrypting..." : "View & burn"}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
