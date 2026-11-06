import {
  createStandardHeadlessUniverFacade,
  createStandardHeadlessUniverFactory,
  type HeadlessUniverFactoryContext,
} from "@univer-cli/headless-univer";
import {
  createUniverCollaborationRuntimeFactory,
  type CollaborationRuntimeBackend,
  type UniverCollaborationRuntimeFactory,
} from "@univer-cli/univer-collaboration-runtime";
import { UniverInstanceType } from "@univerjs/core";
import { constants as bufferConstants } from "node:buffer";

export const OFFICE_NATIVE_TYPES = Object.freeze({
  sheet: UniverInstanceType.UNIVER_SHEET,
  doc: UniverInstanceType.UNIVER_DOC,
  slide: UniverInstanceType.UNIVER_SLIDE,
});

function officeType(type: UniverInstanceType): void {
  if (!Object.values(OFFICE_NATIVE_TYPES).some((native) => native === type)) {
    throw new RangeError("Only native Sheet, Doc and Slide runtimes are supported.");
  }
}

/** Native SDK composition, not a sandbox. Its caller supplies the outer process boundary. */
export async function createOfficeHeadless(
  context: HeadlessUniverFactoryContext,
  runtimeLicense = "",
) {
  officeType(context.unitType);
  const univer = await createStandardHeadlessUniverFactory({ license: runtimeLicense })(context);
  try {
    const api = createStandardHeadlessUniverFacade(univer);
    return { univer, api, close: () => univer.dispose() };
  } catch (error) {
    univer.dispose();
    throw error;
  }
}

/** Backend authority remains caller-owned; jobs must supply a finite, non-submitting backend. */
export function createOfficeRuntimeFactory(
  backend: CollaborationRuntimeBackend,
  options: { readonly runtimeLicense?: string; readonly maxCodeLength?: number } = {},
): UniverCollaborationRuntimeFactory {
  const createUniver = createStandardHeadlessUniverFactory({
    license: options.runtimeLicense ?? "",
  });
  // SDK 1.0.3 requires a positive safe integer; use Node's actual string representation bound.
  const maxCodeLength = options.maxCodeLength ?? bufferConstants.MAX_STRING_LENGTH;
  if (!Number.isSafeInteger(maxCodeLength) || maxCodeLength < 1) {
    throw new RangeError("Facade source exceeds the supported runtime profile.");
  }
  return createUniverCollaborationRuntimeFactory({
    backend,
    maxCodeLength,
    createUniver: (context) => {
      officeType(context.unitType);
      return createUniver(context);
    },
  });
}
