import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as GET_PASTE } from "@/app/api/paste/[id]/route";
import { POST } from "@/app/api/paste/route";
import { GET as GET_RAW } from "@/app/text/[id]/route";

// vi.mock factories are hoisted before variable declarations, so shared fixtures
// must be defined with vi.hoisted to be accessible inside the factory.
const MOCK_PASTE_BASE = vi.hoisted(() => ({
	id: "abc123", // 6 characters to match ID_LENGTH
	ciphertext: "encrypted-content",
	iv: "valid-iv-12bytes",
	format: "plain" as const,
	createdAt: 1234567890,
	expiresAt: 1234567890 + 604800,
	burnAfterRead: false,
	viewCount: 0,
	sizeBytes: 13,
	passwordProtected: false,
}));

// Mock dependencies
vi.mock("@/lib/ip", () => ({
	getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/paste", () => ({
	createPaste: vi.fn().mockResolvedValue(MOCK_PASTE_BASE),
	getPaste: vi.fn().mockResolvedValue(MOCK_PASTE_BASE),
}));

vi.mock("@/lib/rate-limit", () => ({
	checkPasteRateLimit: vi.fn().mockResolvedValue({
		allowed: true,
		remaining: 9,
		resetAt: Date.now() / 1000 + 3600,
	}),
	checkReadRateLimit: vi.fn().mockResolvedValue({
		allowed: true,
		remaining: 59,
		resetAt: Date.now() / 1000 + 60,
	}),
}));

/** Build a valid Base64URL-encoded 12-byte IV */
function makeValidIv(): string {
	const ivBytes = new Uint8Array(12);
	for (let i = 0; i < 12; i++) ivBytes[i] = i;
	return Buffer.from(ivBytes)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");
}

/** Minimal valid non-password-protected paste body */
function validPlainBody() {
	return {
		ciphertext: "dGVzdGNvbnRlbnQ",
		iv: makeValidIv(),
		format: "plain" as const,
		expirySeconds: 604800,
		burnAfterRead: false,
		sizeBytes: 13,
		passwordProtected: false,
		key: "test-key-base64url",
	};
}

describe("API Routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
	});

	describe("POST /api/paste", () => {
		it("creates a non-password paste successfully", async () => {
			const request = {
				json: vi.fn().mockResolvedValue(validPlainBody()),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;

			const response = await POST(request);
			const data = await response.json();

			expect(response.status).toBe(201);
			expect(data).toMatchObject({
				id: "abc123",
				url: expect.stringContaining("/abc123"),
				sizeBytes: 13,
				passwordProtected: false,
			});
		});

		it("creates a password-protected paste successfully", async () => {
			const { createPaste } = await import("@/lib/paste");
			vi.mocked(createPaste).mockResolvedValueOnce({
				...MOCK_PASTE_BASE,
				passwordProtected: true,
				salt: "salt-base64url",
				wrappedKey: "wrapped-key-b64",
				wrapIv: "wrap-iv-b64",
			});

			const body = {
				ciphertext: "dGVzdA",
				iv: makeValidIv(),
				format: "plain" as const,
				expirySeconds: 604800,
				burnAfterRead: false,
				sizeBytes: 4,
				passwordProtected: true,
				salt: "salt-base64url",
				wrappedKey: "wrapped-key-b64",
				wrapIv: "wrap-iv-b64",
				// intentionally no 'key' field — raw key must not be sent
			};

			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;

			const response = await POST(request);
			expect(response.status).toBe(201);
			const data = await response.json();
			expect(data.passwordProtected).toBe(true);
		});

		it("does not pass raw key to createPaste for password-protected pastes", async () => {
			const { createPaste } = await import("@/lib/paste");

			const body = {
				ciphertext: "dGVzdA",
				iv: makeValidIv(),
				format: "plain" as const,
				expirySeconds: 604800,
				burnAfterRead: false,
				sizeBytes: 4,
				passwordProtected: true,
				salt: "salt-base64url",
				wrappedKey: "wrapped-key-b64",
				wrapIv: "wrap-iv-b64",
				key: "should-be-stripped", // malicious client sends raw key
			};

			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;

			await POST(request);

			// createPaste must be called with key: undefined even if client sent it
			expect(vi.mocked(createPaste)).toHaveBeenCalledWith(
				expect.objectContaining({ key: undefined }),
			);
		});

		it("rejects invalid JSON", async () => {
			const request = {
				json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;

			const response = await POST(request);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.code).toBe("INVALID_JSON");
		});

		it("rejects rate-limited requests with 429 and Retry-After header", async () => {
			const { checkPasteRateLimit } = await import("@/lib/rate-limit");
			vi.mocked(checkPasteRateLimit).mockResolvedValueOnce({
				allowed: false,
				remaining: 0,
				resetAt: Math.floor(Date.now() / 1000) + 3600,
			});

			const request = {
				json: vi.fn().mockResolvedValue({}),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;

			const response = await POST(request);
			expect(response.status).toBe(429);
			expect(response.headers.get("Retry-After")).toBeTruthy();
		});

		it("rejects missing ciphertext", async () => {
			const body = { ...validPlainBody(), ciphertext: "" };
			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;
			const response = await POST(request);
			expect(response.status).toBe(400);
		});

		it("rejects an IV that does not decode to 12 bytes", async () => {
			// 8-byte IV in base64url
			const shortIv = Buffer.from(new Uint8Array(8))
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=/g, "");

			const body = { ...validPlainBody(), iv: shortIv };
			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;
			const response = await POST(request);
			expect(response.status).toBe(400);
		});

		it("rejects a non-password paste that is missing the key field", async () => {
			const body = { ...validPlainBody() };
			// biome-ignore lint/suspicious/noExplicitAny: test override
			delete (body as any).key;
			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;
			const response = await POST(request);
			expect(response.status).toBe(400);
		});

		it("rejects a password-protected paste missing wrappedKey", async () => {
			const body = {
				ciphertext: "dGVzdA",
				iv: makeValidIv(),
				format: "plain" as const,
				expirySeconds: 604800,
				burnAfterRead: false,
				sizeBytes: 4,
				passwordProtected: true,
				salt: "salt-base64url",
				// wrappedKey intentionally missing
				wrapIv: "wrap-iv-b64",
			};
			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;
			const response = await POST(request);
			expect(response.status).toBe(400);
		});

		it("rejects ciphertext that exceeds the size limit", async () => {
			const body = {
				...validPlainBody(),
				ciphertext: "x".repeat(7 * 1024 * 1024 + 1),
			};
			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;
			const response = await POST(request);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.code).toBe("CONTENT_TOO_LARGE");
		});

		it("rejects an invalid format value", async () => {
			const body = { ...validPlainBody(), format: "html" };
			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;
			const response = await POST(request);
			expect(response.status).toBe(400);
		});

		it("rejects an expirySeconds value not in EXPIRY_OPTIONS", async () => {
			const body = { ...validPlainBody(), expirySeconds: 9999 };
			const request = {
				json: vi.fn().mockResolvedValue(body),
				url: "http://localhost:3000/api/paste",
			} as unknown as NextRequest;
			const response = await POST(request);
			expect(response.status).toBe(400);
		});
	});

	describe("GET /api/paste/[id]", () => {
		it("retrieves a paste successfully", async () => {
			const request = {
				url: "http://localhost:3000/api/paste/abc123",
			} as NextRequest;

			const response = await GET_PASTE(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data).toMatchObject({
				id: "abc123",
				format: "plain",
				sizeBytes: 13,
			});
		});

		it("rejects an invalid paste ID with 400", async () => {
			const request = {
				url: "http://localhost:3000/api/paste/invalid!",
			} as NextRequest;

			const response = await GET_PASTE(request, {
				params: Promise.resolve({ id: "invalid!" }),
			});
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.code).toBe("INVALID_ID");
		});

		it("returns 404 for a non-existent paste", async () => {
			const { getPaste } = await import("@/lib/paste");
			vi.mocked(getPaste).mockResolvedValueOnce(null);

			const request = {
				url: "http://localhost:3000/api/paste/abc123",
			} as NextRequest;

			const response = await GET_PASTE(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.status).toBe(404);
		});

		it("returns 429 when read rate limit is exceeded", async () => {
			const { checkReadRateLimit } = await import("@/lib/rate-limit");
			vi.mocked(checkReadRateLimit).mockResolvedValueOnce({
				allowed: false,
				remaining: 0,
				resetAt: Math.floor(Date.now() / 1000) + 60,
			});

			const request = {
				url: "http://localhost:3000/api/paste/abc123",
			} as NextRequest;

			const response = await GET_PASTE(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.status).toBe(429);
			expect(response.headers.get("Retry-After")).toBeTruthy();
		});

		it("sets Cache-Control: public for a normal paste", async () => {
			const request = {
				url: "http://localhost:3000/api/paste/abc123",
			} as NextRequest;

			const response = await GET_PASTE(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
		});

		it("sets Cache-Control: private, no-store for a burn-after-read paste", async () => {
			const { getPaste } = await import("@/lib/paste");
			vi.mocked(getPaste).mockResolvedValueOnce({
				...MOCK_PASTE_BASE,
				burnAfterRead: true,
			});

			const request = {
				url: "http://localhost:3000/api/paste/abc123",
			} as NextRequest;

			const response = await GET_PASTE(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		});
	});

	describe("GET /text/[id]", () => {
		it("returns the raw ciphertext with correct headers", async () => {
			const request = {
				url: "http://localhost:3000/text/abc123",
			} as NextRequest;

			const response = await GET_RAW(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			const text = await response.text();

			expect(response.status).toBe(200);
			expect(text).toBe("encrypted-content");
			expect(response.headers.get("Content-Type")).toBe(
				"text/plain; charset=utf-8",
			);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		});

		it("sets the X-E2EE header", async () => {
			const request = {
				url: "http://localhost:3000/text/abc123",
			} as NextRequest;

			const response = await GET_RAW(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.headers.get("X-E2EE")).toBe(
				"client-encrypted; alg=AES-256-GCM",
			);
		});

		it("rejects an invalid paste ID with 400", async () => {
			const request = {
				url: "http://localhost:3000/text/invalid!",
			} as NextRequest;

			const response = await GET_RAW(request, {
				params: Promise.resolve({ id: "invalid!" }),
			});
			expect(response.status).toBe(400);
		});

		it("returns 404 for a non-existent paste", async () => {
			const { getPaste } = await import("@/lib/paste");
			vi.mocked(getPaste).mockResolvedValueOnce(null);

			const request = {
				url: "http://localhost:3000/text/abc123",
			} as NextRequest;

			const response = await GET_RAW(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.status).toBe(404);
		});

		it("returns 429 when read rate limit is exceeded", async () => {
			const { checkReadRateLimit } = await import("@/lib/rate-limit");
			vi.mocked(checkReadRateLimit).mockResolvedValueOnce({
				allowed: false,
				remaining: 0,
				resetAt: Math.floor(Date.now() / 1000) + 60,
			});

			const request = {
				url: "http://localhost:3000/text/abc123",
			} as NextRequest;

			const response = await GET_RAW(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.status).toBe(429);
		});

		it("sets Cache-Control: private, no-store for a burn-after-read paste", async () => {
			const { getPaste } = await import("@/lib/paste");
			vi.mocked(getPaste).mockResolvedValueOnce({
				...MOCK_PASTE_BASE,
				burnAfterRead: true,
			});

			const request = {
				url: "http://localhost:3000/text/abc123",
			} as NextRequest;

			const response = await GET_RAW(request, {
				params: Promise.resolve({ id: "abc123" }),
			});
			expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		});
	});
});
