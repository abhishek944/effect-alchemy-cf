import {
  createPrivateJobHandler,
  makeIsolatedJobs,
  type AuthorizeJobHost,
  type IsolatedJobsOptions,
} from "@starter/office-server/jobs";

/** Injected Node composition. T22 supplies scoped resources; T11 owns authenticated app startup. */
export function createOfficeJobHost(
  options: IsolatedJobsOptions & { readonly authorize: AuthorizeJobHost },
) {
  const jobs = makeIsolatedJobs(options);
  return { jobs, handle: createPrivateJobHandler(jobs, options.authorize) };
}
