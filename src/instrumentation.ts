import type { Instrumentation } from "next";
import { describeRequestError } from "@/lib/observability";

/** Every unhandled server error (render, route handler, server action, proxy) becomes one structured log line. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  console.error(JSON.stringify(describeRequestError(error, request, context)));
};
