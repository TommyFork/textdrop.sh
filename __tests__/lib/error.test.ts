import { describe, expect, it, vi } from "vitest";
import {
	createErrorResponse,
	createJsonResponse,
	logApiError,
} from "../../lib/error";

describe("createErrorResponse", () => {
	it("sets the correct HTTP status", async () => {
		const res = createErrorResponse("Not found", 404);
		expect(res.status).toBe(404);
	});

	it("sets Content-Type to application/json", () => {
		const res = createErrorResponse("Bad request", 400);
		expect(res.headers.get("Content-Type")).toBe("application/json");
	});

	it("body contains the error message", async () => {
		const res = createErrorResponse("Something broke", 500);
		const body = await res.json();
		expect(body.error).toBe("Something broke");
	});

	it("includes code in body when provided", async () => {
		const res = createErrorResponse("Rate limited", 429, "RATE_LIMIT_EXCEEDED");
		const body = await res.json();
		expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
	});

	it("omits code from body when not provided", async () => {
		const res = createErrorResponse("Error", 400);
		const body = await res.json();
		expect(body).not.toHaveProperty("code");
	});

	it("merges extra headers", async () => {
		const res = createErrorResponse("Error", 400, undefined, {
			"Access-Control-Allow-Origin": "*",
			"Retry-After": "60",
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(res.headers.get("Retry-After")).toBe("60");
	});

	it("returns a Response instance", () => {
		const res = createErrorResponse("Error", 400);
		expect(res).toBeInstanceOf(Response);
	});
});

describe("createJsonResponse", () => {
	it("defaults to status 200", () => {
		const res = createJsonResponse({ ok: true });
		expect(res.status).toBe(200);
	});

	it("uses provided status", () => {
		const res = createJsonResponse({ id: "abc" }, 201);
		expect(res.status).toBe(201);
	});

	it("serialises the payload as JSON", async () => {
		const payload = { id: "abc123", count: 42 };
		const res = createJsonResponse(payload);
		const body = await res.json();
		expect(body).toEqual(payload);
	});

	it("sets Content-Type to application/json", () => {
		const res = createJsonResponse({});
		expect(res.headers.get("Content-Type")).toBe("application/json");
	});

	it("merges extra headers", () => {
		const res = createJsonResponse({}, 200, {
			"Cache-Control": "public, max-age=300",
		});
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
	});

	it("handles an array payload", async () => {
		const res = createJsonResponse([1, 2, 3]);
		const body = await res.json();
		expect(body).toEqual([1, 2, 3]);
	});
});

describe("logApiError", () => {
	it("logs Error instances with message and stack", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const err = new Error("disk full");
		logApiError("writing file", err);
		expect(spy).toHaveBeenCalledWith(
			"Error writing file:",
			"disk full",
			expect.any(String), // stack
		);
		spy.mockRestore();
	});

	it("logs non-Error values directly", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		logApiError("unknown context", "raw string error");
		expect(spy).toHaveBeenCalledWith(
			"Error unknown context:",
			"raw string error",
		);
		spy.mockRestore();
	});

	it("handles null gracefully", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => logApiError("test", null)).not.toThrow();
		spy.mockRestore();
	});
});
