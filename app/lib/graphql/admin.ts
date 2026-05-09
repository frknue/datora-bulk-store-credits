export const SHOP_INFO_QUERY = `#graphql
  query {
    shop {
      currencyCode
      timezoneOffset
    }
  }
`;

export const GIFT_CARDS_QUERY = `#graphql
  query getGiftCards($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on GiftCard {
        id
        lastCharacters
        balance {
          amount
          currencyCode
        }
        initialValue {
          amount
          currencyCode
        }
        enabled
        expiresOn
      }
    }
  }
`;

export const SEARCH_GIFT_CARDS_QUERY = `#graphql
  query searchGiftCards($first: Int!, $query: String!) {
    giftCards(first: $first, query: $query) {
      edges {
        node {
          id
          lastCharacters
          balance {
            amount
            currencyCode
          }
          initialValue {
            amount
            currencyCode
          }
          enabled
          expiresOn
        }
      }
    }
  }
`;
