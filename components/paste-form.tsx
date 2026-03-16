"use client";

import {
	ArrowRight,
	CaretDown,
	Code,
	Fire,
	MarkdownLogo,
	TextT,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_EXPIRY_VALUE,
	EXPIRY_OPTIONS,
	FORMAT_OPTIONS,
	MAX_PASTE_SIZE_BYTES,
	type PasteFormat,
	POPULAR_LANGUAGES,
} from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { ShareModal } from "./share-modal";

interface PasteResult {
	id: string;
	expiresAt: number | null;
	sizeBytes: number;
}

const FORMAT_ICONS = {
	plain: TextT,
	markdown: MarkdownLogo,
	code: Code,
} as const;

const FORMAT_SHORT_LABELS = {
	plain: "Text",
	markdown: "Markdown",
	code: "Code",
} as const;

export function PasteForm() {
	const [content, setContent] = useState("");
	const [format, setFormat] = useState<PasteFormat>("plain");
	const [language, setLanguage] = useState("typescript");
	const [expirySeconds, setExpirySeconds] = useState(DEFAULT_EXPIRY_VALUE);
	const [burnAfterRead, setBurnAfterRead] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<PasteResult | null>(null);
	const [isMac, setIsMac] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		textareaRef.current?.focus();
		setIsMac(/Mac/.test(navigator.userAgent));
	}, []);

	const sizeBytes = new Blob([content]).size;
	const sizeOverLimit = sizeBytes > MAX_PASTE_SIZE_BYTES;

	const handleSubmit = useCallback(async () => {
		if (!content.trim() || loading || sizeOverLimit) return;

		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/paste", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content,
					format,
					language: format === "code" ? language : undefined,
					expirySeconds,
					burnAfterRead,
				}),
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? "Failed to create paste");
			}

			const data = await res.json();
			setResult({
				id: data.id,
				expiresAt: data.expiresAt,
				sizeBytes: data.sizeBytes,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setLoading(false);
		}
	}, [
		content,
		format,
		language,
		expirySeconds,
		burnAfterRead,
		loading,
		sizeOverLimit,
	]);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				handleSubmit();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleSubmit]);

	if (result) {
		return (
			<ShareModal
				id={result.id}
				expiresAt={result.expiresAt}
				sizeBytes={result.sizeBytes}
				onCreateAnother={() => {
					setResult(null);
					setContent("");
					setTimeout(() => textareaRef.current?.focus(), 0);
				}}
			/>
		);
	}

	return (
		<div className="mx-auto w-full max-w-3xl">
			{/* Editor window */}
			<div className="overflow-hidden rounded-xl border border-white/[0.07] bg-card shadow-[0_0_0_1px_oklch(1_0_0/0.03),0_32px_64px_-16px_oklch(0_0_0/0.7),0_0_0_1px_oklch(0_0_0/0.3)inset]">
				{/* Titlebar */}
				<div className="flex h-10 items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4">
					{/* Left spacer — mirrors language picker width to keep format picker truly centered */}
					<div className="w-28 shrink-0" />

					{/* Format picker — centered */}
					<div className="flex flex-1 items-center justify-center">
						<div className="flex rounded-md bg-white/[0.06] p-0.5">
							{FORMAT_OPTIONS.map((opt) => {
								const Icon = FORMAT_ICONS[opt.value as PasteFormat];
								const isActive = format === opt.value;
								return (
									<button
										key={opt.value}
										onClick={() => setFormat(opt.value as PasteFormat)}
										className={`inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-all ${
											isActive
												? "bg-white/[0.1] text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground/70"
										}`}
									>
										<Icon size={12} />
										{FORMAT_SHORT_LABELS[opt.value as PasteFormat]}
									</button>
								);
							})}
						</div>
					</div>

					{/* Language picker (right side, only for code) */}
					<div className="flex w-28 shrink-0 justify-end">
						{format === "code" && (
							<div className="relative flex items-center">
								<select
									value={language}
									onChange={(e) => setLanguage(e.target.value)}
									className="h-6 appearance-none rounded bg-white/[0.06] pl-2.5 pr-6 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
								>
									{POPULAR_LANGUAGES.map((lang) => (
										<option key={lang} value={lang}>
											{lang}
										</option>
									))}
								</select>
								<CaretDown
									size={10}
									className="pointer-events-none absolute right-1.5 text-muted-foreground"
								/>
							</div>
						)}
					</div>
				</div>

				{/* Textarea */}
				<div className="relative">
					<textarea
						ref={textareaRef}
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="Paste or type your text here..."
						className="min-h-[380px] w-full resize-y bg-transparent px-5 py-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/25 focus:outline-none"
						spellCheck={false}
					/>
					{content.length > 0 && (
						<div className="pointer-events-none absolute right-3 bottom-3 text-xs text-muted-foreground/35">
							<span className={sizeOverLimit ? "text-destructive" : ""}>
								{formatBytes(sizeBytes)}
							</span>
							{" / 5 MB"}
						</div>
					)}
				</div>
			</div>

			{/* Controls */}
			<div className="mt-3 flex items-center gap-2">
				{/* Expiry picker */}
				<div className="relative flex items-center">
					<select
						value={expirySeconds}
						onChange={(e) => setExpirySeconds(Number(e.target.value))}
						className="h-8 appearance-none rounded-lg border border-white/[0.08] bg-white/[0.04] pl-3 pr-7 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-white/20"
					>
						{EXPIRY_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
					<CaretDown
						size={10}
						className="pointer-events-none absolute right-2.5 text-muted-foreground/50"
					/>
				</div>

				{/* Burn after read */}
				<button
					onClick={() => setBurnAfterRead(!burnAfterRead)}
					className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all ${
						burnAfterRead
							? "border-orange-500/40 bg-orange-500/10 text-orange-400"
							: "border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:text-foreground"
					}`}
				>
					<Fire size={13} weight={burnAfterRead ? "fill" : "regular"} />
					Burn after read
				</button>

				<div className="flex-1" />

				{/* Keyboard hint */}
				<div className="text-xs text-muted-foreground/30">
					<kbd className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px]">
						{isMac ? "⌘" : "Ctrl"}
					</kbd>
					<span className="mx-1 opacity-50">+</span>
					<kbd className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px]">
						↵
					</kbd>
				</div>

				{/* Submit */}
				<button
					onClick={handleSubmit}
					disabled={!content.trim() || loading || sizeOverLimit}
					className="inline-flex h-8 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 hover:shadow-[0_0_20px_-4px_oklch(0.56_0.23_264/0.65)] disabled:opacity-35 disabled:shadow-none disabled:hover:brightness-100"
				>
					{loading ? (
						"Sharing..."
					) : (
						<>
							Share
							<ArrowRight size={13} weight="bold" />
						</>
					)}
				</button>
			</div>

			{/* Error */}
			{error && (
				<div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
					{error}
				</div>
			)}
		</div>
	);
}
