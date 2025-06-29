import { print } from "graphql";
import { createRemoteFileNode } from "gatsby-source-filesystem";
import { Parser } from "commonmark";
import path from "path";
import { Actions, Node, NodePluginArgs, Reporter } from "gatsby";
import { StrapiV5GraphQLPluginOptions } from "./types";

const reader = new Parser();
const excludedTypes = ["GenericMorph"];

function extractExtensionFromUrl(urlString: string) {
  const isRelativeUrl = urlString.startsWith("/");

  if (isRelativeUrl) {
    // For relative URLs, directly use path module to extract the extension
    const extension = path.extname(urlString);
    return extension ? extension.slice(1) : null; // Remove the leading dot from the extension
  }

  try {
    const parsedUrl = new URL(urlString);

    // Check if the URL has a pathname (contains a file path)
    if (!parsedUrl.pathname) {
      return null; // If there's no pathname, there's no extension
    }

    // Use path module to extract the extension
    const extension = path.extname(parsedUrl.pathname);

    return extension ? extension.slice(1) : null; // Remove the leading dot from the extension
  } catch (error) {
    // Handle invalid URL by returning null
    return null;
  }
}

const catchErrors = (
  err:
    | { networkError?: { result: { errors: any[] } }; graphQLErrors?: any[] }
    | {
        name: string;
        networkError?: { result: { errors: any[] } } | undefined;
        graphQLErrors?: any[] | undefined;
        message: any;
      },
  operation: { query: string; variables: object },
  reporter: Reporter,
) => {
  if (err?.networkError?.result?.errors) {
    err.networkError.result.errors.forEach((error) => {
      reportOperationError(reporter, operation, error);
    });
  } else if (err?.graphQLErrors) {
    err.graphQLErrors.forEach((error) => {
      reportOperationError(reporter, operation, error);
    });
  } else {
    //@ts-ignore
    reportOperationError(reporter, operation, err);
  }
};

const filterExcludedTypes = (node: {
  type: { name: string; kind: string; ofType: any };
}): boolean => {
  const type = getTypeName(node.type);
  return !excludedTypes.includes(type);
};

const formatCollectionName = (name: string) => {
  return name
    ?.replace(/([a-z])([A-Z])/, "$1 $2")
    ?.replace(/\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    ?.replace(/\W+/g, "");
};

const getFieldType = (type: { name: string; kind: any; ofType: any }, strapi = false): string => {
  if (type.name === "DateTime") {
    return "Date";
  }
  if (type.name === "Long") {
    return "Float";
  }
  switch (type.kind) {
    case "ENUM":
      return "String";
    case "LIST":
      return `[${getFieldType(type.ofType)}]`;
    case "NON_NULL":
      return `${getFieldType(type.ofType)}!`;
    case "OBJECT":
    case "UNION":
      return `Strapi${type.name}`;
    default:
      return type.name;
  }
};

const getTypeName = (type: { name: string; kind: string; ofType: any }) => {
  if (type.name === "DateTime") {
    return "Date";
  }
  if (type.name === "Long") {
    return "Float";
  }
  switch (type.kind) {
    case "ENUM":
      return "String";
    case "LIST":
      return getTypeName(type.ofType);
    case "NON_NULL":
      return getTypeName(type.ofType);
    default:
      return type.name;
  }
};

const getTypeKind = (type: { kind: any; ofType: any }) => {
  switch (type.kind) {
    case "NON_NULL":
      return getTypeKind(type.ofType);
    default:
      return type.kind;
  }
};

const getEntityType = (name: string) =>
  name.match(/(.*)(?:EntityResponse|EntityResponseCollection|RelationResponseCollection)$/)?.[1];

const isListType = (name: string) => {
  return /(?:EntityResponseCollection|RelationResponseCollection)$/.test(name);
};

const getEntityResponse = (name: string) => name.match(/(.*)(?:EntityResponse)$/)?.[1];

const getEntityResponseCollection = (name: string) =>
  name.match(/(.*)(?:EntityResponseCollection)$/)?.[1];

const getCollectionType = (name: { match: (arg0: RegExp) => any[] }) =>
  name.match(/(.*)(?:EntityResponse|RelationResponseCollection)$/)?.[1];

const getSingleTypes = ({ singleTypes }: { singleTypes: string[] }) =>
  [...(singleTypes || [])].map(formatCollectionName).filter(Boolean);

const getCollectionTypes = ({ collectionTypes }: { collectionTypes: string[] }) =>
  ["UploadFile", ...(collectionTypes || [])].map(formatCollectionName).filter(Boolean);

const getEntityTypes = ({
  collectionTypes,
  singleTypes,
}: {
  collectionTypes: string[];
  singleTypes: string[];
}) =>
  ["UploadFile", ...(collectionTypes || []), ...(singleTypes || [])]
    .map(formatCollectionName)
    .filter(Boolean);

const getTypeMap = (collectionTypes: string[]): Record<string, boolean> =>
  (collectionTypes || []).reduce((ac, a) => ({ ...ac, [a]: true }), {});

const reportOperationError = (
  reporter: Reporter,
  operation: { query: any; variables: any; operationName?: any; field?: any; collectionType?: any },
  error: {
    name: string;
    networkError?: { result: { errors: any[] } } | undefined;
    graphQLErrors?: any[] | undefined;
    message: any;
  },
) => {
  const { operationName, field, collectionType, query, variables } = operation;
  const extra = `
===== QUERY =====
${print(query)}
===== VARIABLES =====
${JSON.stringify(variables, null, 2)}
===== ERROR =====
`;
  reporter.error(`${operationName} failed – ${error.message}\n${extra}`, error);
};

const extractFiles = (text: string, apiURL: any) => {
  const files: (string | null)[] = [];

  if (!text) {
    return files;
  }

  // parse the markdown / richtext content
  const parsed = reader.parse(text);
  const walker = parsed.walker();
  let event, node;

  while ((event = walker.next())) {
    node = event.node;
    // process image nodes
    if (event.entering && node.type === "image") {
      if (/^\//.test(node.destination!)) {
        files.push(`${apiURL}${node.destination}`);
      } else if (/^http/i.test(node.destination!)) {
        files.push(node.destination);
      }
    } else if (event.entering && node.type === "html_block" && node.literal) {
      let match;
      const regex = /<img[^>]+src="?([^"\s]+)"?\s*/gi;

      while ((match = regex.exec(node.literal))) {
        if (/^\//.test(match[1])) {
          files.push(`${apiURL}${match[1]}`);
        } else if (/^http/i.test(match[1])) {
          files.push(match[1]);
        }
      }
    }
  }

  return files.filter(Boolean);
};

const shouldDownloadFile = (
  pluginOptions: { download: Array<string> | null | undefined | boolean },
  url: string,
) => {
  const ext = extractExtensionFromUrl(url);
  // Defaulting to all files
  return (
    //@ts-ignore
    [true, null, undefined].includes(pluginOptions?.download) ||
    //@ts-ignore
    pluginOptions?.download?.includes?.(ext)
  );
};

const processFieldData = async (
  data: { [x: string]: any; documentId?: string; locale?: string; __typename?: any; url?: any },
  options: {
    nodeId: string;
    createNode: Actions["createNode"];
    createNodeId: NodePluginArgs["createNodeId"];
    pluginOptions: StrapiV5GraphQLPluginOptions;
    getCache: NodePluginArgs["getCache"];
    getNodesByType: NodePluginArgs["getNodesByType"];
    uploadFileMap: Record<string, string>;
  },
) => {
  const { pluginOptions, nodeId, createNode, createNodeId, getCache, uploadFileMap } =
    options || {};
  const apiURL = pluginOptions?.apiURL;
  const inlineImages = pluginOptions?.inlineImages?.typesToParse;
  const __typename = data?.__typename;
  const output = JSON.parse(JSON.stringify(data));

  // Extract files and download.
  if (__typename === "UploadFile" && data.url) {
    if (shouldDownloadFile(pluginOptions, data.url)) {
      const url = /^\//.test(data.url) ? `${apiURL}${data.url}` : data.url;
      const fileNode = await createRemoteFileNode({
        url,
        parentNodeId: nodeId,
        createNode,
        createNodeId,
        getCache,
        httpHeaders: pluginOptions.headers || {},
      });
      if (fileNode) {
        output.file = fileNode.id;
      }
    }
  }
  // Extract markdown / richtext files and download.
  if (inlineImages?.[__typename]) {
    await Promise.all(
      (inlineImages[__typename] || []).map(async (field: string | number) => {
        const files = extractFiles(data[field], apiURL);
        if (files?.length) {
          await Promise.all(
            files.map(async (uri, index) => {
              const url = uri?.replace(apiURL, "").split("#")[0].split("?")[0] || ""; // lookup can only find file nodes without applied styles (#xxx).
              const nodeId = uploadFileMap[url];
              let file;
              if (!nodeId) {
                if (shouldDownloadFile(pluginOptions, uri || "")) {
                  const fileNode = await createRemoteFileNode({
                    url: uri || "",
                    parentNodeId: nodeId,
                    createNode,
                    createNodeId,
                    getCache,
                    httpHeaders: pluginOptions.headers || {},
                  });
                  if (fileNode) {
                    file = fileNode.id;
                  }
                }
              }
              if (!output?.[`${field}_images`]) {
                output[`${field}_images`] = [];
              }
              output[`${field}_images`][index] = { uri, url, nodeId, ...(file && { file }) };
            }),
          );
        }
      }),
    );
  }

  await Promise.all(
    Object.keys(data).map(async (key) => {
      const value = data?.[key];
      if (value?.__typename) {
        const entityType = getEntityType(value.__typename);
        if (entityType && value?.data) {
          if (value.data.length) {
            output[key].nodeIds = value.data.map((item: { id: any }) =>
              createNodeId(`Strapi${entityType}-${item.id}`),
            );
          } else if (value.data.id) {
            output[key].nodeId = createNodeId(`Strapi${entityType}-${value.data.id}`);
          } else {
            output[key] = null;
          }
        } else {
          output[key] = await processFieldData(value, options);
        }
      } else if (value instanceof Array) {
        output[key] = await Promise.all(value.map((item) => processFieldData(item, options)));
      }
    }),
  );

  return output;
};

let warnOnceForNoSupport = false;
const createNodeManifest = (
  uid: string,
  id: string,
  node: Node | undefined,
  unstable_createNodeManifest: Actions["unstable_createNodeManifest"],
) => {
  // This env variable is provided automatically on Gatsby Cloud hosting
  const isPreview = process.env.GATSBY_IS_PREVIEW === "true";
  const createNodeManifestIsSupported = typeof unstable_createNodeManifest === "function";
  const shouldCreateNodeManifest = isPreview && createNodeManifestIsSupported;
  if (shouldCreateNodeManifest) {
    if (uid && id && node?.updatedAt) {
      const updatedAt = node.updatedAt;
      const manifestId = `${uid}-${id}-${updatedAt}`;
      unstable_createNodeManifest({
        manifestId,
        node,
        updatedAtUTC: updatedAt as number,
      });
    }
  } else if (
    // it's helpful to let users know if they're using an outdated Gatsby version so they'll upgrade for the best experience
    isPreview &&
    !createNodeManifestIsSupported &&
    !warnOnceForNoSupport
  ) {
    console.warn(
      `[gatsby-source-strapi-v5-graphql]: Your version of Gatsby core doesn't support Content Sync (via the unstable_createNodeManifest action). Please upgrade to the latest version to use Content Sync in your site.`,
    );
    // This is getting called for every entry node so we don't want the console logs to get cluttered
    warnOnceForNoSupport = true;
  }
};

export {
  catchErrors,
  createNodeManifest,
  filterExcludedTypes,
  getEntityResponse,
  getEntityResponseCollection,
  getEntityType,
  getEntityTypes,
  getCollectionType,
  getCollectionTypes,
  getSingleTypes,
  getTypeKind,
  getTypeMap,
  getTypeName,
  getFieldType,
  isListType,
  processFieldData,
};
