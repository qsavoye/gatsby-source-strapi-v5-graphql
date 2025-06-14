import {
  GatsbyGraphQLObjectType,
  GatsbyGraphQLUnionType,
  NodePluginArgs,
  NodePluginSchema,
} from "gatsby";
import { getTypesMap } from "./api";
import {
  filterExcludedTypes,
  getFieldType,
  getTypeMap,
  getTypeName,
  getTypeKind,
  getEntityType,
  getEntityTypes,
  isListType,
} from "./helpers";
import { StrapiGraphQLSchemaTypeResult, StrapiV5GraphQLPluginOptions } from "./types";

const getTypeDefs = (
  typeNames: string[],
  typeMap: Record<string, StrapiGraphQLSchemaTypeResult>,
  schema: NodePluginSchema,
  entityTypeMap: Record<string, boolean>,
  inlineImages: Record<string, string[]>,
) => {
  const typeDefs: Record<string, GatsbyGraphQLObjectType | GatsbyGraphQLUnionType> = {};
  const foundTypes = [];
  for (let typeName of typeNames) {
    if (typeMap?.[typeName]) {
      foundTypes.push(typeName);
    } else {
      console.warn("Could not find type: ", typeName);
    }
  }
  for (let i = 0; i < foundTypes.length; i += 1) {
    const name = foundTypes[i];
    const type = typeMap?.[name];

    switch (type.kind) {
      case "OBJECT":
        typeDefs[type.name] = schema.buildObjectType({
          name: `Strapi${type.name}`,
          ...(entityTypeMap[type.name] && { interfaces: ["Node"] }),
          //@ts-ignore
          fields: type.fields?.filter(filterExcludedTypes).reduce(
            (acc, field) => {
              //@ts-ignore
              const fieldTypeName = getTypeName(field.type);
              // Add relationship resolver referenced collections.
              const entityType = getEntityType(fieldTypeName);
              if (entityType) {
                if (entityTypeMap?.[entityType]) {
                  const typeName = `Strapi${entityType}`;
                  return Object.assign(acc, {
                    [field.name]: {
                      type: isListType(fieldTypeName) ? `[${typeName}]` : typeName,
                      resolve: (source: any, _: any, context: any) => {
                        const nodeId = source?.[field.name]?.nodeId;
                        if (nodeId) {
                          return context.nodeModel.getNodeById({
                            id: nodeId,
                            type: typeName,
                          });
                        }
                        const nodeIds = source?.[field.name]?.nodeIds;
                        if (nodeIds) {
                          return context.nodeModel.getNodesByIds({
                            ids: nodeIds,
                            type: typeName,
                          });
                        }
                        return null;
                      },
                    },
                  });
                }
                return acc;
              } else {
                const fieldTypeKind = getTypeKind(field.type);
                switch (fieldTypeKind) {
                  case "OBJECT":
                  case "LIST": {
                    if (!typeDefs?.[fieldTypeName]) {
                      foundTypes.push(fieldTypeName);
                    }
                    break;
                  }
                }
              }
              //@ts-ignore
              return Object.assign(acc, { [field.name]: getFieldType(field.type) });
            },
            {
              strapiId: {
                type: "Int",
                resolve: (source) => source?.strapiId || null,
              },
              ...(type.name === "UploadFile" && {
                file: {
                  type: "File",
                  resolve: (source: any, _: any, context: any) => {
                    const fileId = source?.file;
                    if (fileId) {
                      return context.nodeModel.getNodeById({
                        id: fileId,
                        type: "File",
                      });
                    }
                    return null;
                  },
                },
              }),
              ...(inlineImages?.[type.name] || []).reduce((acc, field) => {
                return {
                  ...acc,
                  [`${field}_images`]: {
                    type: "[StrapiUploadFile]",
                    resolve: async (source: any, _: any, context: any) => {
                      const files = source?.[`${field}_images`] || [];
                      return files.map((file: any) => ({
                        ...(file?.nodeId &&
                          context.nodeModel.getNodeById({
                            id: file.nodeId,
                            type: "StrapiUploadFile",
                          })),
                        ...file,
                      }));
                    },
                  },
                };
              }, {}),
            },
          ),
        });
        break;

      case "UNION":
        typeDefs[type.name] = schema.buildUnionType({
          name: `Strapi${type.name}`,
          resolveType: (value) => `Strapi${value.__typename}`,
          types: type.possibleTypes?.map((unionType) => {
            //@ts-ignore
            const unionTypeName = getTypeName(unionType);
            if (!typeDefs?.[unionTypeName]) {
              foundTypes.push(unionTypeName);
            }
            return `Strapi${unionType.name}`;
          }, {}),
        });

      default:
        break;
    }
  }

  return typeDefs;
};

export default async (
  pluginOptions: StrapiV5GraphQLPluginOptions,
  schema: NodePluginSchema,
  createNodeId: NodePluginArgs["createNodeId"],
) => {
  const entityTypes = getEntityTypes(pluginOptions);
  const entityTypeMap = getTypeMap(entityTypes);
  const typeMap = await getTypesMap(pluginOptions);
  const inlineImages = pluginOptions?.inlineImages?.typesToParse;
  const result = getTypeDefs(entityTypes, typeMap, schema, entityTypeMap, inlineImages);
  return Object.values(result);
};
