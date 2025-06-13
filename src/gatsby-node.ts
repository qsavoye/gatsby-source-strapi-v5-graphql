import { StrapiV5GraphQLPluginOptions } from "./types";
import { Actions, GatsbyNode, NodeInput, NodePluginArgs } from "gatsby";
import buildTypes from "./build-types";
import { catchErrors, processFieldData, createNodeManifest } from "./helpers";
import buildQueries from "./build-query";
import { getClient, getContentTypes } from "./api";

/**
 * Implementing Gatsby's Node APIs.
 *
 * See: https://www.gatsbyjs.com/docs/node-apis/#createSchemaCustomization
 */
export const createSchemaCustomization: GatsbyNode["createSchemaCustomization"] = async (
  { actions, schema, createNodeId },
  pluginOptions: StrapiV5GraphQLPluginOptions,
) => {
  const { createTypes } = actions;
  const typeDefs = await buildTypes(pluginOptions, schema, createNodeId);
  createTypes(typeDefs);
};

/**
 * Implementing Gatsby's Node APIs.
 *
 * See: https://www.gatsbyjs.com/docs/node-apis/#sourceNodes
 */
export const sourceNodes: GatsbyNode["sourceNodes"] = async (
  {
    actions,
    reporter,
    createContentDigest,
    createNodeId,
    getCache,
    getNode,
    getNodes,
    getNodesByType,
    cache,
  },
  pluginOptions: StrapiV5GraphQLPluginOptions,
) => {
  const uploadFileMap: Record<string, string> = {};
  const lastFetched: number | null =
    pluginOptions.cache !== false ? await cache.get(`timestamp`) : null;
  const { unstable_createNodeManifest, createNode, touchNode, deleteNode } = actions;
  const operations = await buildQueries(pluginOptions);
  if (!operations) return reporter.panic(`No operations found`);
  const contentTypes = await getContentTypes(pluginOptions);
  const client = getClient(pluginOptions);
  const nodesToDelete = new Set(
    getNodes()
      .filter((n) => n.internal.owner === `gatsby-source-strapi-graphql`)
      .map((n) => n.id),
  );

  type OperationType = (typeof operations)[number];

  async function executeOperation(operation: OperationType) {
    const { field, collectionType, singleType, query, syncQuery } = operation;
    try {
      const SOURCE_TYPE = collectionType || singleType;
      const NODE_TYPE = `Strapi${SOURCE_TYPE}`;
      const UID = contentTypes?.[SOURCE_TYPE || ""] || null;
      const variables = {
        ...operation?.variables,
        ...(pluginOptions?.preview &&
          operation?.variables?.publicationState && {
            publicationState: "PREVIEW",
          }),
        ...(lastFetched &&
          operation?.variables?.updatedAt && {
            updatedAt: new Date(lastFetched).toISOString(),
          }),
      };
      operation.variables = variables;
      const result = await client.query({
        query,
        variables,
        fetchPolicy: "network-only",
      });

      await Promise.all([
        (async () => {
          if (lastFetched) {
            const syncResult = await client.query({
              query: syncQuery,
              variables: {
                ...variables,
                updatedAt: "1990-01-01T00:00:00.000Z",
              },
              fetchPolicy: "network-only",
            });
            let nodes = syncResult?.data?.[field.name]?.nodes || [];
            nodes = Array.isArray(nodes) ? nodes : [nodes];
            nodes.forEach((node: { id: string }) => {
              const nodeId = createNodeId(`${NODE_TYPE}-${node.id}`);
              nodesToDelete.delete(nodeId);
              touchNode(getNode(nodeId)!);
            });
          }
        })(),
        (async () => {
          const data = result?.data?.[field.name]?.nodes;
          const items = (data && (data instanceof Array ? data : [data])) || [];
          await Promise.all(
            items.map(async (item: { documentId: string; locale: string }) => {
              const { documentId, locale } = item || {};
              const nodeId = createNodeId(`${NODE_TYPE}-${documentId}-${locale}`);
              nodesToDelete.delete(nodeId);
              const options = {
                nodeId,
                createNode,
                createNodeId,
                pluginOptions,
                getCache,
                getNodesByType,
                uploadFileMap,
              };
              const fields = await processFieldData(item, options);
              if (NODE_TYPE === "StrapiUploadFile" && fields?.url) {
                uploadFileMap[fields.url] = nodeId;
              }
              await createNode({
                ...fields,
                id: nodeId,
                strapiId: documentId,
                parent: fields?.parent?.nodeId || null,
                children: [],
                internal: {
                  type: NODE_TYPE,
                  content: JSON.stringify(fields),
                  contentDigest: createContentDigest(fields),
                },
              });
              if (UID) {
                createNodeManifest(UID, documentId, getNode(nodeId), unstable_createNodeManifest);
              }
            }),
          );
        })(),
      ]);
    } catch (err: any) {
      //@ts-ignore
      catchErrors(err, operation, reporter);
    }
  }

  if (operations) {
    // Get upload files first to build uploadFilesMap.
    await Promise.all(
      operations.filter((o) => o.operationName === "UploadFileQuery").map(executeOperation),
    );
    await Promise.all(
      operations.filter((o) => o.operationName !== "UploadFileQuery").map(executeOperation),
    );
  }

  // Delete nodes not found anymore.
  nodesToDelete.forEach((nodeId) => {
    const node = getNode(nodeId);
    touchNode(node!);
    deleteNode(node!);
  });
};

export const onPostBuild: GatsbyNode["onPostBuild"] = async ({ cache }) => {
  await cache.set(`timestamp`, Date.now());
};
