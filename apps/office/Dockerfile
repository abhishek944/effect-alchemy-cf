ARG BASE_IMAGE=node@sha256:650d460b4e6b02411caa0e563838f07fafc9792314d5091859d837d8b070712b
FROM ${BASE_IMAGE} AS dependencies
ARG PNPM_VERSION=10.33.4
RUN npm install --global --ignore-scripts pnpm@${PNPM_VERSION}
WORKDIR /dependencies
COPY dependency-root/ ./
RUN pnpm --filter @starter/office-server... install --prod --frozen-lockfile --ignore-scripts
# Private workspace code is bundled; discard only its staging links, never patch SDK packages.
RUN rm -rf packages/office-server/node_modules/@starter node_modules/.pnpm/node_modules/@starter

FROM ${BASE_IMAGE} AS render-resources
WORKDIR /resources
COPY render-resources.mjs provenance-source.json ./
RUN node render-resources.mjs

FROM ${BASE_IMAGE} AS runtime
ARG CHROMIUM_VERSION=156.0.8078.47-1~deb12u1
ARG DEJAVU_VERSION=2.37-6
ARG LIBERATION_VERSION=1:1.07.4-11
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       chromium=${CHROMIUM_VERSION} fonts-dejavu-core=${DEJAVU_VERSION} \
       fonts-liberation=${LIBERATION_VERSION} ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /dependencies/node_modules /opt/office/dependencies/node_modules
COPY --from=dependencies /dependencies/packages/office-server/node_modules /opt/office/dependencies/packages/office-server/node_modules
COPY node/ /opt/office/dependencies/packages/office-server/
COPY render-page/ /opt/office/render-page/
COPY --from=render-resources /resources/package/pkg/ratex_wasm_bg.wasm /opt/office/render-page/assets/ratex_wasm_bg.wasm
COPY --from=render-resources /resources/package/fonts.css /opt/office/render-page/assets/fonts.css
COPY --from=render-resources /resources/package/fonts /opt/office/render-page/assets/fonts
COPY --from=render-resources /resources/resource-identity.json /opt/office/render-resource-identity.json
COPY provenance-source.json /opt/office/provenance-source.json
COPY image-provenance.mjs /opt/office/dependencies/packages/office-server/image-provenance.mjs
RUN node /opt/office/dependencies/packages/office-server/image-provenance.mjs > /opt/office/provenance.json
USER 65532:65532
WORKDIR /task
ENTRYPOINT ["node", "/opt/office/dependencies/packages/office-server/foundation-smoke.mjs"]
