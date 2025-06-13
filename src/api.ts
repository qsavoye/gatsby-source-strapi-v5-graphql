import { gql } from "@apollo/client";
import client from "./client";
import fetch from "cross-fetch";
import {
  StrapiV5GraphQLPluginOptions,
  StrapiContentTypeApi,
  StrapiGraphQLLocaleQueryResult,
  StrapiGraphQLSchemaResult,
  StrapiGraphQLSchemaTypeResult,
} from "./types";

const query = gql`
  query IntrospectionQuery {
    __schema {
      queryType {
        name
      }
      mutationType {
        name
      }
      subscriptionType {
        name
      }
      types {
        ...FullType
      }
      directives {
        name
        description
        locations
        args {
          ...InputValue
        }
      }
    }
  }
  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }
  fragment InputValue on __InputValue {
    name
    description
    type {
      ...TypeRef
    }
    defaultValue
  }
  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const getClient = ({
  apiURL,
  headers,
  token,
}: { apiURL?: string; headers?: Record<string, string>; token?: string } = {}) => {
  return client(apiURL || "", headers, token);
};

export const getSchema = async (pluginOptions: StrapiV5GraphQLPluginOptions) => {
  const { data } = (await getClient(pluginOptions).query({ query })) as StrapiGraphQLSchemaResult;
  return data?.__schema || {};
};

export const getTypes = async (pluginOptions: StrapiV5GraphQLPluginOptions) => {
  const { types } = await getSchema(pluginOptions);
  return types;
};

function clearAndUpper(text: string) {
  return text.replace(/-/, "").toUpperCase();
}

function toPascalCase(text: string) {
  return text.replace(/(^\w|-\w)/g, clearAndUpper);
}

export const getContentTypes = async ({
  apiURL,
  token,
}: { apiURL?: string; token?: string } = {}): Promise<{ [key: string]: string }> => {
  const options = { headers: { Authorization: `Bearer ${token}` } };
  const [{ data: contentTypes }] = await Promise.all([
    fetch(`${apiURL}/api/content-type-builder/content-types`, options).then(
      (res) => res.json() as Promise<{ data: StrapiContentTypeApi[] }>,
    ),
  ]);

  return contentTypes.reduce(
    (acc, type) =>
      Object.assign(acc, {
        [toPascalCase(type.apiID)]: type.uid,
      }),
    {},
  );
};

const getSpecifiedLocales = ({ locale }: { locale?: string[] } = {}) => {
  let locales: string[] = [];
  if (locale instanceof Array) {
    locales = locale;
    if (!locales.includes("all")) {
      return locale;
    }
  }
  return [];
};

const getAvailableLocales = async (pluginOptions: StrapiV5GraphQLPluginOptions) => {
  try {
    const { data } = (await getClient(pluginOptions).query({
      query: gql`
        query LocaleQuery {
          i18NLocales {
            code
          }
        }
      `,
    })) as StrapiGraphQLLocaleQueryResult;
    return (data?.i18NLocales || []).map((locale) => locale.code);
  } catch (err) {
    return [];
  }
};

export const getLocales = async (pluginOptions: StrapiV5GraphQLPluginOptions) => {
  const specified = getSpecifiedLocales(pluginOptions);
  const available = await getAvailableLocales(pluginOptions);
  if (specified?.length) {
    return specified.filter((locale) => available.includes(locale));
  }
  if (available?.length) {
    return available;
  }
  return ["all"];
};

export const getTypesMap = async (
  pluginOptions: StrapiV5GraphQLPluginOptions,
): Promise<Record<string, StrapiGraphQLSchemaTypeResult>> => {
  const types = await getTypes(pluginOptions);
  return types.reduce((acc, type) => Object.assign(acc, { [type.name]: type }), {});
};
