import { gql } from "@apollo/client";
import { getTypesMap, getLocales } from "./api";
import {
  getEntityResponse,
  getEntityResponseCollection,
  getCollectionTypes,
  getSingleTypes,
  getTypeMap,
  filterExcludedTypes,
} from "./helpers";
import {
  StrapiGraphQLSchemaFieldResult,
  StrapiGraphQLSchemaTypeResult,
  StrapiV5GraphQLPluginOptions,
} from "./types";

const buildArgs = (node: StrapiGraphQLSchemaTypeResult) => {
  const args = [];
  // Get all data for paginated fields.
  if (node?.args?.find((arg: { name: string }) => arg.name === "pagination")) {
    args.push("pagination:{limit:1000}");
  }
  if (node?.args?.find((arg: { name: string }) => arg.name === "publicationState")) {
    args.push("publicationState: $publicationState");
  }
  return args.length ? `(${args.join(",")})` : "";
};

const getNodeFields = (
  node: StrapiGraphQLSchemaTypeResult,
  typesMap: Record<string, StrapiGraphQLSchemaTypeResult>,
  n = 0,
  root = false,
): string | Array<string> | null => {
  const max = 16;
  if (n > max) {
    return null;
  }

  const flatten = true;
  const sep = flatten ? " " : "\n";
  const dep = (i: number) => Array.from(new Array(i), () => (flatten ? "" : "  ")).join("");

  switch (node.__typename) {
    case "__Type":
      switch (node.kind) {
        case "OBJECT":
          // Prevent circular propagation.
          if (/Entity$/.test(node?.name)) {
            return [`${dep(n)}id`];
          } else if (/RelationResponseCollection$/.test(node?.name)) {
            return [`${dep(n)}nodes { __typename documentId }`];
          }
          if (node?.fields) {
            if (root) {
              return (
                node.fields
                  //@ts-ignore
                  .filter(filterExcludedTypes)
                  //@ts-ignore
                  .map((child) => getNodeFields(child, typesMap, n))
                  .join(sep)
              );
            }
            //@ts-ignore
            return (
              node.fields
                //@ts-ignore
                .filter(filterExcludedTypes)
                //@ts-ignore
                .map((child) => getNodeFields(child, typesMap, n))
            );
          }
          const child = typesMap?.[node?.name];
          if (child) {
            return getNodeFields(child, typesMap, n);
          }
          return null;
        case "UNION": {
          const child = typesMap?.[node?.name];
          if (child) {
            return [
              `${dep(n)}__typename`,
              //@ts-ignore
              ...child.possibleTypes.map((possibleType) => {
                //@ts-ignore
                const grandchild = typesMap?.[possibleType?.name];
                if (grandchild) {
                  // Prevent circular propagation.
                  if (/Entity$/.test(node?.name)) {
                    return [`${dep(n)}id`];
                  } else if (/RelationResponseCollection$/.test(node?.name)) {
                    return [`${dep(n)}nodes { __typename documentId }`];
                  }
                  const fields = getNodeFields(grandchild, typesMap, n + 1);
                  if (fields) {
                    return `${dep(n)}... on ${possibleType.name} {${sep}${[
                      `${dep(n + 1)}__typename`,
                      ...fields,
                    ].join(sep)}${sep + dep(n)}}`;
                  }
                }
              }),
            ];
          }
          return null;
        }
        case "ENUM": {
          const child = typesMap?.[node?.name];
          if (child) {
            return [
              `${dep(n + 1)}__typename`,
              ...child.enumValues?.map(({ name }) => `${dep(n + 1)}${name}`)!,
            ].join(sep);
          }
          break;
        }
        default:
          return null;
      }
    case "__Field": {
      switch (node.type.kind) {
        case "SCALAR":
        case "ENUM":
          return `${dep(n)}${node.name}`;
        case "NON_NULL":
          return getNodeFields({ ...node, type: node.type?.ofType }, typesMap, n);
        case "OBJECT": {
          const fields = getNodeFields(node.type, typesMap, n + 1);
          if (fields) {
            const args = buildArgs(node);
            return `${dep(n)}${node.name}${args} {${sep}${[
              `${dep(n + 1)}__typename`,
              ...fields,
            ].join(sep)}${sep + dep(n)}}`;
          }
          break;
        }
        case "LIST":
          const fields = getNodeFields(node.type?.ofType, typesMap, n + 1);
          const args = buildArgs(node);
          if (typeof fields === "string") {
            return `${dep(n)}${node.name}${args} {${sep}${fields}${sep + dep(n)}}`;
          } else if (fields?.length) {
            return `${dep(n)}${node.name}${args} {${sep}${fields.join(sep)}${sep + dep(n)}}`;
          }
          break;
        default:
          return null;
      }
    }
  }
  return null;
};

const buildQueries = (
  operations:
    | {
        field: StrapiGraphQLSchemaFieldResult;
        query: string | string[] | null;
        collectionType?: string;
        singleType?: string;
        locale: string;
      }[]
    | undefined,
  typesMap: Record<string, StrapiGraphQLSchemaTypeResult>,
) => {
  return operations?.map((operation) => {
    const isCollectionType = operation?.collectionType;
    const operationName = `${operation.collectionType || operation.singleType}Query`;
    const publicationState = Boolean(
      operation.field.args?.find((arg) => arg.name === "publicationState"),
    );
    const publicationStateDef = operation.query?.includes("$publicationState");
    const locale = Boolean(operation.field.args?.find((arg) => arg.name === "locale"));
    const localeDef = operation.query?.includes("$locale");
    const filterInputType =
      typesMap?.[operation.field.args?.find((arg) => arg.name === "filters")?.type?.name || ""];
    const updatedAt = Boolean(
      (filterInputType?.inputFields || []).find((input) => input.name === "updatedAt"),
    );
    const updatedAtDef = operation.query?.includes("$updatedAt");
    const varDef = [
      isCollectionType && "$pagination: PaginationArg",
      (publicationState || publicationStateDef) && "$publicationState: PublicationState",
      (locale || localeDef) && "$locale: I18NLocaleCode",
      (updatedAt || updatedAtDef) && "$updatedAt: DateTime",
    ]
      .filter((n) => Boolean(n))
      .join(" ")
      .replace(/(.+)/, "($1)");
    const varSet = [
      isCollectionType && "pagination: $pagination",
      publicationState && "publicationState: $publicationState",
      locale && "locale: $locale",
      updatedAt && "filters: { updatedAt: { gt: $updatedAt } }",
    ]
      .filter((n) => Boolean(n))
      .join(" ")
      .replace(/(.+)/, "($1)");
    const variables = {
      ...(isCollectionType && { pagination: { start: 0, limit: 1000 } }),
      ...((publicationState || publicationStateDef) && { publicationState: "LIVE" }),
      ...((locale || localeDef) && { locale: operation.locale }),
      ...((updatedAt || updatedAtDef) && { updatedAt: "1990-01-01T00:00:00.000Z" }),
    };
    const meta = isCollectionType ? ` pageInfo { total } ` : "";
    const data = `__typename nodes { __typename ${operation.query} }${meta}`;
    const query = gql`query ${operationName}${varDef} { ${operation.field.name}${varSet} { ${data} } }`;
    const syncQuery = gql`query ${operationName}${varDef} { ${operation.field.name}${varSet} nodes { documentId }${meta} }`;
    return {
      ...operation,
      operationName,
      variables,
      query,
      syncQuery,
    };
  });
};

const getQueryFields = (
  singleTypes: Record<string, boolean>,
  collectionTypeMap: Record<string, boolean>,
  typesMap: Record<string, StrapiGraphQLSchemaTypeResult>,
  locales: string[],
) => {
  const Query = typesMap?.Query;
  return Query.fields?.reduce(
    (
      acc: Array<{
        field: StrapiGraphQLSchemaFieldResult;
        query: string | string[] | null;
        collectionType?: string;
        singleType?: string;
        locale: string;
      }>,
      field,
    ) => {
      const singleType = getEntityResponse(field.type.name == null ? "" : field.type.name);
      const collectionType = getEntityResponseCollection(
        field.type.name == null ? "" : field.type.name,
      );
      if (collectionType != undefined && collectionTypeMap?.[collectionType]) {
        const type = typesMap?.[collectionType];
        locales.forEach((locale) => {
          return acc.push({
            field,
            query: getNodeFields(type, typesMap, 4, true),
            collectionType,
            locale,
          });
        });
      }
      if (singleType != undefined && singleTypes?.[singleType]) {
        const type = typesMap?.[singleType];
        locales.forEach((locale) => {
          return acc.push({
            field,
            query: getNodeFields(type, typesMap, 4, true),
            singleType,
            locale,
          });
        });
      }
      return acc;
    },
    [],
  );
};

export default async (pluginOptions: StrapiV5GraphQLPluginOptions) => {
  const collectionTypes = getCollectionTypes(pluginOptions);
  const collectionTypeMap = getTypeMap(collectionTypes);
  const singleTypes = getSingleTypes(pluginOptions);
  const singleTypeMap = getTypeMap(singleTypes);
  const typesMap = await getTypesMap(pluginOptions);
  const locales = await getLocales(pluginOptions);
  const fields = getQueryFields(singleTypeMap, collectionTypeMap, typesMap, locales);
  return buildQueries(fields, typesMap);
};
