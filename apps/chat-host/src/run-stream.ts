import type { ServerResponse } from "node:http";
import { encodeNdjsonLine, type RunEvent } from "@highchat/chat-runtime";
import type { Run } from "./run.ts";

/**
 * Writes run events to the `POST /runs` response.
 *
 * A detached browser is not a lost run: the Worker owns this stream and keeps
 * consuming it. Only losing this socket means the Worker can no longer deliver
 * provider or tool replies, so the run is failed and disposed instead of waiting
 * for a reply that can never arrive.
 */
export class RunStream {
  readonly #response: ServerResponse;
  #run: Run | undefined;
  #closed = false;

  constructor(response: ServerResponse) {
    this.#response = response;
    response.on("close", () => {
      this.#closed = true;
      this.#run?.detach();
    });
  }

  attach(run: Run): void {
    this.#run = run;
    if (this.#closed) run.detach();
  }

  emit = (event: RunEvent): void => {
    if (this.#closed || this.#response.destroyed || this.#response.writableEnded) {
      this.#run?.detach();
      return;
    }
    this.#response.write(encodeNdjsonLine(event));
  };

  end(): void {
    if (!this.#response.destroyed && !this.#response.writableEnded) this.#response.end();
  }
}
