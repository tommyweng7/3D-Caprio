import { NextResponse } from "next/server";
import { errorPayload, errorStatus } from "@/caprio/errors";

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(error: unknown) {
  return NextResponse.json(errorPayload(error), { status: errorStatus(error) });
}

export async function readBody<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}
