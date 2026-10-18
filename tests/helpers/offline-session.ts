/** An offline session whose token is expired but refreshable — the WINDOWS #31 seed. */
export function expiredRefreshableSession(shop: string) {
  return {
    id: `offline_${shop}`,
    shop,
    state: "",
    isOnline: false,
    scope:
      "read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations,write_orders",
    expires: new Date(Date.now() - 60 * 60 * 1000),
    accessToken: "expired-offline-token",
    refreshToken: "refresh-token-shopify-will-reject",
    refreshTokenExpires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}
