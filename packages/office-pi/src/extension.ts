import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { executeOfficeTool } from "./execute.ts";
import { OFFICE_GUIDANCE } from "./guidance.ts";
import { officeToolParameters } from "./parameters.ts";
import { OFFICE_TOOL_RESULT_BYTES } from "./results.ts";
import type { OfficePiHost } from "./types.ts";

export const OFFICE_EXTENSION_NAME = "office";
export const OFFICE_TOOL_NAME = "office";

/** Host installs this alongside existing extensions before opening/resuming its harness. */
export const makeOfficeExtension = (host: OfficePiHost): Extension =>
  defineExtension({
    name: OFFICE_EXTENSION_NAME,
    tools: [
      defineTool({
        name: OFFICE_TOOL_NAME,
        description:
          "Manage authorized Sheets, Docs and Slides drafts through one finite Office command. " +
          "Stage accepted file/code bytes, execute only the exact authorized draft, inspect/render/export, " +
          "Ready/review/reopen/discard, or observe the exact operation receipt. Never approve, merge or write main.",
        parameters: officeToolParameters,
        replay: "unsafe",
        executionMode: "sequential",
        outputLimits: { maxBytes: OFFICE_TOOL_RESULT_BYTES, maxLines: 256, retain: "head" },
        execute: (args, api, context) => executeOfficeTool(args, api, context, host),
      }),
    ],
    sections: [{ key: "office_workflow", render: () => OFFICE_GUIDANCE }],
  });
