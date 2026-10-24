import { Option, Schema } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import { HostOffice, HostOfficeRequest, hostEnvelope } from "@starter/office-server/native-remote";
import type { OfficeTaskPort } from "@starter/office-pi";
import { officeErrorFromFailure } from "./office-http-model.ts";
import { assertOfficeTaskCommand, assertOfficeTaskReceipt } from "./office-task-command.ts";
import { officeDenied } from "./office-private-authority.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import type { OfficeTaskTransport } from "./chat-office-transport.ts";

type Key = keyof typeof HostOffice;
const ReplyPayload = Schema.Union(Object.values(HostOffice).map((method) => method.response));
const Reply = hostEnvelope(ReplyPayload);
const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) =>
  Option.getOrNull(Schema.decodeUnknownOption(schema, { onExcessProperty: "error" })(input));

/**
 * Finite private Office port. Each typed method maps once to a real HostOffice request; Root
 * independently re-proves the original intent. No synthetic HTTP request/response cycle.
 */
export function officeTaskPort(transport: OfficeTaskTransport): OfficeTaskPort {
  const call = async (key: Key, input: unknown): Promise<unknown> => {
    const request = decodeWireSync(HostOfficeRequest)({ method: HostOffice[key].method, input });
    if (key === "receipt") assertOfficeTaskReceipt(transport.proof, request);
    else assertOfficeTaskCommand(transport.proof, request);
    return transport.request(
      "core",
      { headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      key === "receipt",
      async (response, signal, deadline, invocationId) => {
        if (response.status !== 200) throw officeDenied();
        const raw = await readOfficePrivateJson(response.body, signal, deadline, 256 * 1024);
        const envelope = decode(Reply, raw);
        const payload =
          envelope !== null && envelope.invocationId === invocationId
            ? envelope.payload
            : decode(ReplyPayload, raw);
        if (payload === null || payload.method !== HostOffice[key].method) throw officeDenied();
        if ("error" in payload) throw officeErrorFromFailure(payload.error);
        return payload.value;
      },
    );
  };
  return {
    list: (input) => call("list", input),
    drafts: (input) => call("drafts", input),
    draft: (input) => call("draft", input),
    open: (input) => call("open", input),
    create: (input) => call("create", input),
    createDraft: (input) => call("createDraft", input),
    execute: (input) => call("execute", input),
    importInto: (input) => call("importInto", input),
    inspect: (input) => call("inspect", input),
    render: (input) => call("render", input),
    export: (input) => call("export", input),
    ready: (input) => call("ready", input),
    review: (input) => call("review", input),
    reopen: (input) => call("reopen", input),
    discard: (input) => call("discard", input),
    receipt: (input) => call("receipt", input),
  };
}
