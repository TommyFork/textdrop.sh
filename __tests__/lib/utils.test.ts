import { describe, expect, it } from "vitest";
import { ID_LENGTH } from "../../lib/constants";
import { formatDate, getBaseUrl, isValidPasteId } from "../../lib/utils";

describe("isValidPasteId", () => {
	it("accepts a valid ID of correct length with all URL-safe character classes", () => {
		// covers uppercase, lowercase, digits, underscore, hyphen
		const id = "aZ0_-b".slice(0, ID_LENGTH);
		expect(isValidPasteId(id)).toBe(true);
	});

	it("accepts an ID composed entirely of letters", () => {
		expect(isValidPasteId("a".repeat(ID_LENGTH))).toBe(true);
	});

	it("accepts an ID composed entirely of digits", () => {
		expect(isValidPasteId("1".repeat(ID_LENGTH))).toBe(true);
	});

	it("accepts an ID with underscores and hyphens", () => {
		expect(isValidPasteId("__--__")).toBe(true);
	});

	it("rejects an ID that is too short", () => {
		expect(isValidPasteId("a".repeat(ID_LENGTH - 1))).toBe(false);
	});

	it("rejects an ID that is too long", () => {
		expect(isValidPasteId("a".repeat(ID_LENGTH + 1))).toBe(false);
	});

	it("rejects an empty string", () => {
		expect(isValidPasteId("")).toBe(false);
	});

	it("rejects an ID with an exclamation mark", () => {
		const id = "abc!23";
		expect(id.length).toBe(ID_LENGTH);
		expect(isValidPasteId(id)).toBe(false);
	});

	it("rejects an ID with a space", () => {
		const id = "abc 23";
		expect(id.length).toBe(ID_LENGTH);
		expect(isValidPasteId(id)).toBe(false);
	});

	it("rejects an ID with a percent sign (URL encoding attempt)", () => {
		const id = "ab%123";
		expect(id.length).toBe(ID_LENGTH);
		expect(isValidPasteId(id)).toBe(false);
	});

	it("rejects an ID with a dot", () => {
		const id = "abc.23";
		expect(id.length).toBe(ID_LENGTH);
		expect(isValidPasteId(id)).toBe(false);
	});

	it("rejects an ID with a slash (path traversal attempt)", () => {
		const id = "abc/23";
		expect(id.length).toBe(ID_LENGTH);
		expect(isValidPasteId(id)).toBe(false);
	});

	it("rejects null coerced to string via type guard", () => {
		// TypeScript signature is string, but test defensive runtime behaviour
		expect(isValidPasteId(null as unknown as string)).toBe(false);
	});

	it("accepts the example valid ID used in tests (abc123)", () => {
		// Ensures the fixture used across the test suite is actually valid
		expect(isValidPasteId("abc123")).toBe(true);
	});
});

describe("formatDate", () => {
	it("formats a Unix timestamp as 'MMM d, yyyy'", () => {
		// 2024-01-15 00:00:00 UTC → Jan 15, 2024
		const ts = new Date("2024-01-15T00:00:00Z").getTime() / 1000;
		const result = formatDate(ts);
		// Allow for timezone variation in CI but require the year and day
		expect(result).toMatch(/Jan\s+\d+,\s+2024/);
	});

	it("returns a non-empty string for any valid timestamp", () => {
		expect(formatDate(0).length).toBeGreaterThan(0);
		expect(formatDate(Date.now() / 1000).length).toBeGreaterThan(0);
	});
});

describe("getBaseUrl", () => {
	it("uses NEXT_PUBLIC_BASE_URL env var when no requestUrl is provided", () => {
		const orig = process.env.NEXT_PUBLIC_BASE_URL;
		process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
		expect(getBaseUrl()).toBe("https://example.com");
		process.env.NEXT_PUBLIC_BASE_URL = orig;
	});

	it("uses the origin of requestUrl when provided", () => {
		expect(getBaseUrl("https://myapp.vercel.app/api/paste")).toBe(
			"https://myapp.vercel.app",
		);
	});

	it("falls back to localhost when no env var and no requestUrl", () => {
		const orig = process.env.NEXT_PUBLIC_BASE_URL;
		delete process.env.NEXT_PUBLIC_BASE_URL;
		expect(getBaseUrl()).toBe("http://localhost:3000");
		process.env.NEXT_PUBLIC_BASE_URL = orig;
	});

	it("requestUrl takes precedence over env var", () => {
		const orig = process.env.NEXT_PUBLIC_BASE_URL;
		process.env.NEXT_PUBLIC_BASE_URL = "https://env.example.com";
		// requestUrl is used when provided — env var is the fallback path
		expect(getBaseUrl("https://request.example.com/foo")).toBe(
			"https://request.example.com",
		);
		process.env.NEXT_PUBLIC_BASE_URL = orig;
	});
});
