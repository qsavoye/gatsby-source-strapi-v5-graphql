import type { UID } from "@strapi/types";
import { SchemaPluginOptions } from "@strapi/types/dist/struct";
import { PluginOptions } from "gatsby";

export interface StrapiV5GraphQLPluginOptions extends PluginOptions {
  apiURL: string;
  collectionTypes: string[];
  singleTypes: string[];
  locale: string[];
  preview: boolean;
  headers: Record<string, string>;
  token: string;
  cache: boolean;
  download: Array<string>;
  inlineImages: { typesToParse: Record<string, Array<string>> };
}

export interface StrapiContentTypeApi {
  uid: UID.ContentType;
  plugin: string;
  apiID: string;
  schema: {
    displayName: string;
    description: string;
    icon: string;
    collectionName: string;
    pluginOptions: SchemaPluginOptions;
    attributes: Record<string, { type: string }>;
  };
}

export interface StrapiGraphQLLocaleQueryResult {
  data?: {
    i18NLocales: Array<{
      code: string;
    }>;
  };
}

export interface StrapiGraphQLSchemaFieldResult {
  name: string;
  description: string | null;
  args: Array<{
    name: string;
    description: string | null;
    type: {
      kind: string;
      name: string | null;
      ofType: {
        kind: string;
        name: string | null;
        ofType: null;
      } | null;
    };
    defaultValue: string | null;
  }> | null;
  type: {
    kind: string;
    name: string | null;
    ofType: {
      kind: string;
      name: string | null;
      ofType: null;
    } | null;
  };
  isDeprecated: boolean;
  deprecationReason: string | null;
}

export interface StrapiGraphQLSchemaTypeResult {
  args: any;
  type: any;
  __typename: any;
  kind: string;
  name: string;
  description: string | null;
  fields: Array<StrapiGraphQLSchemaFieldResult> | null;
  inputFields: Array<{
    name: string;
    description: string | null;
    type: {
      kind: string;
      name: string | null;
      ofType: {
        kind: string;
        name: string | null;
        ofType: null;
      } | null;
    };
    defaultValue: string | null;
  }> | null;
  interfaces: Array<{
    kind: string;
    name: string | null;
    ofType: null;
  }> | null;
  enumValues: Array<{
    name: string;
    description: string | null;
    isDeprecated: boolean;
    deprecationReason: string | null;
  }> | null;
  possibleTypes: Array<{
    kind: string;
    name: string | null;
    ofType: null;
  }> | null;
}

export interface StrapiGraphQLSchemaResult {
  data: {
    __schema: {
      queryType: {
        name: string;
      };
      mutationType: {
        name: string;
      };
      subscriptionType: null;
      types: Array<StrapiGraphQLSchemaTypeResult>;
    };
  };
}
