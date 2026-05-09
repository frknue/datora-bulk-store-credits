export function formatTimezoneOffset(offset: string): string {
  if (offset.length === 5) {
    return offset.slice(0, 3) + ":" + offset.slice(3);
  }
  return offset;
}

export const timezoneLabels = [
  { label: "(UTC -10:00) - Hawaii-Aleutian Standard Time", value: "-10:00" },
  { label: "(UTC -09:00) - Alaska Standard Time", value: "-09:00" },
  { label: "(UTC -08:00) - Pacific Standard Time", value: "-08:00" },
  { label: "(UTC -07:00) - Mountain Standard Time", value: "-07:00" },
  { label: "(UTC -06:00) - Central Standard Time", value: "-06:00" },
  { label: "(UTC -05:00) - Eastern Standard Time", value: "-05:00" },
  { label: "(UTC -01:00) - Azores Time", value: "-01:00" },
  { label: "(UTC 00:00) - UTC", value: "00:00" },
  { label: "(UTC +01:00) - Central European Time", value: "+01:00" },
  { label: "(UTC +02:00) - Eastern European Time", value: "+02:00" },
  { label: "(UTC +03:00) - Moscow Time", value: "+03:00" },
  { label: "(UTC +04:00) - Gulf Standard Time", value: "+04:00" },
  { label: "(UTC +05:00) - Pakistan Standard Time", value: "+05:00" },
  { label: "(UTC +05:30) - Indian Standard Time", value: "+05:30" },
  { label: "(UTC +06:00) - Bangladesh Standard Time", value: "+06:00" },
  { label: "(UTC +07:00) - Indochina Time", value: "+07:00" },
  { label: "(UTC +08:00) - China Standard Time", value: "+08:00" },
  { label: "(UTC +09:00) - Japan Standard Time", value: "+09:00" },
  {
    label: "(UTC +10:00) - Australian Eastern Standard Time",
    value: "+10:00",
  },
  { label: "(UTC +11:00) - Solomon Islands Time", value: "+11:00" },
  { label: "(UTC +12:00) - New Zealand Standard Time", value: "+12:00" },
];
