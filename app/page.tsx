import { Metadata } from "next";
import { PasteForm } from "@/components/paste-form";

export const metadata: Metadata = {
	title: "just-text — Share text. Nothing else.",
	description:
		"Paste text, get a link. Up to 5MB. Syntax highlighting, markdown rendering, raw text access. No account needed.",
	openGraph: {
		title: "just-text — Share text. Nothing else.",
		description:
			"Paste text, get a link. Up to 5MB. Syntax highlighting, markdown rendering, raw text access. No account needed.",
		type: "website",
	},
};

export default function Home() {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center px-4 py-16">
			<header className="mb-10 text-center">
				<h1 className="mb-3 bg-gradient-to-b from-foreground to-foreground/55 bg-clip-text text-2xl font-bold tracking-tighter text-transparent">
					just-text
				</h1>
				<p className="text-xs tracking-widest text-muted-foreground/40 uppercase">
					Share text. Nothing else.
				</p>
			</header>

			<PasteForm />

			<footer className="mt-16 text-center text-xs leading-relaxed text-muted-foreground/25">
				<p>
					No account needed &middot; Up to 5 MB &middot; Syntax highlighting
					&middot; Markdown
				</p>
				<p className="mt-1">
					Raw access via{" "}
					<code className="rounded bg-white/[0.06] px-1 py-0.5 text-muted-foreground/50">
						/text/
					</code>{" "}
					&middot; Keyboard-first
				</p>
			</footer>
		</div>
	);
}
