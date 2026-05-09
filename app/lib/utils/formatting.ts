export function formatNumber(
  amount: number | string,
  decimalCount = 2,
  decimal = ",",
  thousands = ".",
): string {
  try {
    decimalCount = Math.abs(decimalCount);
    decimalCount = isNaN(decimalCount) ? 2 : decimalCount;
    const negativeSign = Number(amount) < 0 ? "-" : "";
    const i = parseInt(
      String(
        (amount = Math.abs(Number(amount) || 0).toFixed(
          decimalCount,
        ) as unknown as number),
      ),
    ).toString();
    const j = i.length > 3 ? i.length % 3 : 0;
    return (
      negativeSign +
      (j ? i.substring(0, j) + thousands : "") +
      i.substring(j).replace(/(\d{3})(?=\d)/g, "$1" + thousands) +
      (decimalCount
        ? decimal +
          Math.abs(Number(amount) - Number(i))
            .toFixed(decimalCount)
            .slice(2)
        : "")
    );
  } catch {
    return "0";
  }
}

export function getCurrencySymbol(currency: string): string {
  const symbolMap: Record<string, string> = {
    EUR: "€",
    USD: "$",
    GBP: "£",
  };
  return symbolMap[currency] || currency;
}

export function formatDateString(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
