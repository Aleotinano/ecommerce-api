export function getProductPrice(variant, product) {
  if (variant?.price != null) {
    return variant.price;
  }
  if (product?.price != null) {
    return product.price;
  }
  return null;
}
