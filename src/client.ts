import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client";
import fetch from "cross-fetch";

const clients:Record<string, ApolloClient<unknown>> = {};

const client = (apiURL:string, headers?:Record<string, string>, token?:string): ApolloClient<unknown> => {
  if (!clients[apiURL]) {
    clients[apiURL] = new ApolloClient({
      link: new HttpLink({
        uri: `${apiURL}/graphql`,
        fetch,
        headers: {
          ...token && { authorization: `Bearer ${token}` },
          ...headers,
        },
      }),
      cache: new InMemoryCache(),
    });
  }
  return clients[apiURL];
};

export default client;