export function convertRowsToCsv(
  items: Record<string, unknown>[],
  delimiter: string,
): string {
  if (items.length === 0) {
    return "";
  }

  const headers = Object.keys(items[0]);
  const headerRow = headers.join(delimiter);

  const rows = items.map((item) => {
    return headers
      .map((header) => {
        const value = item[header];
        const stringValue = value === null || value === undefined ? "" : String(value);

        if (
          stringValue.includes(delimiter) ||
          stringValue.includes('"') ||
          stringValue.includes("\n")
        ) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }

        return stringValue;
      })
      .join(delimiter);
  });

  return [headerRow, ...rows].join("\n");
}
